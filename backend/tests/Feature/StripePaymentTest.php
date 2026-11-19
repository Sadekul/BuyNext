<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Mail\OrderPlacedMail;
use App\Mail\PaymentNotCompletedMail;
use App\Models\AdminNotification;
use App\Models\Coupon;
use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Services\Payments\StripeGateway;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/**
 * Phase 8: card payments through Stripe Checkout. Stripe is always faked
 * (Http::fake): no test talks to the real API.
 *
 * The order used: lamp 20.00 × 1 + standard shipping 4.99 = 24.99 (2499 cents).
 */
class StripePaymentTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private const SECRET = 'sk_test_fake_secret_key';

    private const WEBHOOK_SECRET = 'whsec_test_fake_webhook_secret';

    private Product $lamp;

    private int $sessions = 0;

    private ?array $adminHeaders = null;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'buynest.stripe.secret_key' => self::SECRET,
            'buynest.stripe.webhook_secret' => self::WEBHOOK_SECRET,
            'buynest.stripe.checkout_minutes' => 30,
            'buynest.storefront_url' => 'https://shop.example.com',
        ]);
        $this->lamp = $this->product(['price' => '20.00', 'stock_quantity' => 5, 'discount_percent' => 0]);
    }

    /** What the fake Stripe answers (tests change these; Http::fake is registered once). */
    private $sessionAnswer = null;

    private $refundAnswer = null;

    /** Stripe answers: a new session per call, refunds, expiring sessions. */
    private function fakeStripe(): void
    {
        Http::fake([
            'api.stripe.com/v1/checkout/sessions/*/expire' => Http::response(['id' => 'cs_expired', 'status' => 'expired']),
            'api.stripe.com/v1/checkout/sessions' => function (Request $request) {
                if ($this->sessionAnswer) {
                    return value($this->sessionAnswer);
                }
                $this->sessions++;

                return Http::response([
                    'id' => "cs_test_{$this->sessions}",
                    'object' => 'checkout.session',
                    'url' => "https://checkout.stripe.com/c/pay/cs_test_{$this->sessions}",
                    'expires_at' => (int) $request['expires_at'],
                ]);
            },
            'api.stripe.com/v1/refunds' => fn () => $this->refundAnswer
                ? value($this->refundAnswer)
                : Http::response(['id' => 're_test_1', 'object' => 'refund', 'status' => 'succeeded']),
        ]);
    }

    private function cardOrder(array $overrides = [], array $headers = [])
    {
        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['payment_method' => 'card', ...$overrides], $headers);
    }

    private function webhook(array $event, ?string $signature = null)
    {
        $payload = json_encode($event);

        return $this->call('POST', '/api/v1/payments/stripe/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_STRIPE_SIGNATURE' => $signature ?? StripeGateway::signature($payload, self::WEBHOOK_SECRET),
        ], $payload);
    }

    private function sessionEvent(string $type, string $number, array $session = [], ?string $id = null): array
    {
        return [
            'id' => $id ?? 'evt_'.uniqid(),
            'object' => 'event',
            'type' => $type,
            'livemode' => false,
            'data' => ['object' => [
                'id' => 'cs_test_1',
                'object' => 'checkout.session',
                'amount_total' => 2499,
                'currency' => 'usd',
                'payment_status' => $type === 'checkout.session.expired' ? 'unpaid' : 'paid',
                'status' => $type === 'checkout.session.expired' ? 'expired' : 'complete',
                'payment_intent' => $type === 'checkout.session.expired' ? null : 'pi_test_1',
                'client_reference_id' => $number,
                'metadata' => ['order_number' => $number],
                ...$session,
            ]],
        ];
    }

    private function adminRequest(string $method, string $uri, array $body = [])
    {
        $this->adminHeaders ??= $this->adminHeaders();

        return $this->asAdmin($this->adminHeaders, $method, $uri, $body);
    }

    // ---- Paying for an order -------------------------------------------------

    public function test_a_card_order_gets_a_checkout_session_for_its_grand_total(): void
    {
        $this->fakeStripe();
        $this->travelTo(now()->startOfSecond());

        $response = $this->cardOrder()->assertCreated();
        $number = $response->json('data.number');
        $order = Order::sole();

        $response->assertJsonPath('data.status', 'pending_payment')->assertJsonPath('data.payment_status', 'unpaid')
            ->assertJsonPath('data.payment.provider', 'stripe')
            ->assertJsonPath('data.payment.url', 'https://checkout.stripe.com/c/pay/cs_test_1')
            ->assertJsonPath('data.payment.expires_at', now()->addMinutes(30)->toIso8601ZuluString())
            ->assertJsonPath('data.payment.can_pay', true)
            ->assertJsonMissingPath('data.payment.error')
            ->assertJsonMissingPath('data.payment.reference');
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity); // stock reserved as before
        $this->assertSame(['stripe', 'cs_test_1', 1], [$order->payment_provider, $order->payment_session_id, $order->payment_attempts]);

        Http::assertSentCount(1);
        Http::assertSent(fn (Request $request) => $request->url() === 'https://api.stripe.com/v1/checkout/sessions'
            && $request->method() === 'POST'
            && $request->hasHeader('Authorization', 'Bearer '.self::SECRET)
            && $request->hasHeader('Idempotency-Key', "order-{$order->id}-session-1")
            && $request->isForm()
            && str_contains($request->body(), 'line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2499')
            && $request['mode'] === 'payment'
            && $request['line_items[0][price_data][currency]'] === 'usd'
            && $request['line_items[0][price_data][unit_amount]'] === '2499'
            && $request['line_items[0][price_data][product_data][name]'] === "BuyNest order {$number}"
            && $request['line_items[0][quantity]'] === '1'
            && $request['customer_email'] === 'guest@example.com'
            && $request['client_reference_id'] === $number
            && $request['metadata[order_number]'] === $number
            && $request['expires_at'] === (string) now()->addMinutes(30)->getTimestamp()
            && $request['success_url'] === "https://shop.example.com/order-confirmation/{$number}?payment=success"
            && $request['cancel_url'] === "https://shop.example.com/order-confirmation/{$number}?payment=cancelled");
    }

    public function test_other_payment_methods_never_call_stripe(): void
    {
        $this->fakeStripe();

        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]])->assertCreated()
            ->assertJsonPath('data.payment', ['provider' => null, 'paid_at' => null, 'url' => null, 'expires_at' => null, 'can_pay' => false, 'method_label' => null]);
        Http::assertNothingSent();
    }

    public function test_stripe_down_leaves_the_order_unpaid_and_pay_now_retries(): void
    {
        $this->fakeStripe();
        $this->sessionAnswer = fn () => throw new ConnectionException('Connection refused');

        $response = $this->cardOrder()->assertCreated()
            ->assertJsonPath('data.payment.provider', 'stripe')
            ->assertJsonPath('data.payment.url', null)
            ->assertJsonPath('data.payment.error', 'Stripe could not be reached. Please try again in a moment.')
            ->assertJsonPath('data.payment.can_pay', true);
        $number = $response->json('data.number');
        $order = Order::sole();
        $this->assertSame(['pending_payment', 'unpaid', null], [$order->status, $order->payment_status, $order->payment_session_id]);
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity);

        // Stripe is back: Pay now opens a page, with a new idempotency key.
        $this->sessionAnswer = null;
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'GUEST@example.com'])->assertOk()
            ->assertJsonPath('data.number', $number)
            ->assertJsonPath('data.payment.url', 'https://checkout.stripe.com/c/pay/cs_test_1')
            ->assertJsonMissingPath('data.payment.error');
        Http::assertSent(fn (Request $request) => $request->hasHeader('Idempotency-Key', "order-{$order->id}-session-2"));
    }

    public function test_stripe_refusing_the_session_is_reported(): void
    {
        $this->fakeStripe();
        $this->sessionAnswer = fn () => Http::response(['error' => [
            'type' => 'invalid_request_error', 'message' => 'Amount must be at least $0.50 usd',
        ]], 400);

        $this->cardOrder()->assertCreated()->assertJsonPath('data.payment.url', null)
            ->assertJsonPath('data.payment.error', 'Amount must be at least $0.50 usd');
    }

    public function test_pay_now_rules(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->assertCreated()->json('data.number');

        // The open page is given back: no second session.
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.url', 'https://checkout.stripe.com/c/pay/cs_test_1');
        Http::assertSentCount(1);

        // The guest lookup's proof: wrong or missing email → the lookup's 404.
        $notFound = ['message' => 'We couldn\'t find an order with that number and email.'];
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'someone@example.com'])->assertNotFound()->assertExactJson($notFound);
        $this->postJson("/api/v1/orders/{$number}/pay")->assertNotFound()->assertExactJson($notFound);
        $this->postJson('/api/v1/orders/BN-999999/pay', ['email' => 'guest@example.com'])->assertNotFound();

        // The page expired: a new one.
        $this->travel(31)->minutes();
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.url', 'https://checkout.stripe.com/c/pay/cs_test_2');
        $this->assertSame('cs_test_2', Order::sole()->payment_session_id);

        // Not a card order / paid / cancelled → 422.
        $cod = $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]])->json('data.number');
        $this->postJson("/api/v1/orders/{$cod}/pay", ['email' => 'guest@example.com'])->assertUnprocessable()
            ->assertJsonValidationErrors(['order' => 'This order isn\'t paid by card.']);

        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertUnprocessable()
            ->assertJsonValidationErrors(['order' => 'This order has already been paid.']);

        $other = $this->cardOrder()->json('data.number');
        $this->adminRequest('PATCH', "/api/admin/v1/orders/{$other}", ['status' => 'cancelled'])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/orders/{$other}/pay", ['email' => 'guest@example.com'])->assertUnprocessable()
            ->assertJsonValidationErrors(['order' => 'This order was cancelled, so it can\'t be paid.']);
    }

    public function test_a_signed_in_customer_pays_their_own_order_without_the_email(): void
    {
        $this->fakeStripe();
        $customer = Customer::factory()->create();
        $mine = $this->bearer($this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token'));
        $number = $this->cardOrder(['email' => $customer->email], $mine)->assertCreated()->json('data.number');

        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/orders/{$number}/pay", [], $mine)->assertOk()->assertJsonPath('data.payment.can_pay', true);

        // Another customer's token (without the order's email) → 404.
        $other = Customer::factory()->create();
        $this->app['auth']->forgetGuards();
        $theirs = $this->bearer($this->postJson('/api/v1/auth/login', ['email' => $other->email, 'password' => 'Password123'])->json('data.tokens.access_token'));
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/orders/{$number}/pay", [], $theirs)->assertNotFound();

        // The order pages show it too.
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/orders/{$number}", $mine)->assertOk()
            ->assertJsonPath('data.payment.provider', 'stripe')->assertJsonPath('data.payment.can_pay', true)
            ->assertJsonPath('data.payment.url', 'https://checkout.stripe.com/c/pay/cs_test_1');
    }

    // ---- Webhook ------------------------------------------------------------

    public function test_a_paid_session_creates_the_invoice(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');
        Mail::fake(); // only the webhook's email from here

        $this->webhook($this->sessionEvent('checkout.session.completed', $number))->assertOk()
            ->assertExactJson(['received' => true, 'result' => 'paid']);

        $order = Order::sole();
        $this->assertSame(['processing', 'paid', 'pi_test_1'], [$order->status, $order->payment_status, $order->payment_reference]);
        $this->assertNotNull($order->paid_at);
        $invoice = Invoice::sole();
        $this->assertSame(['24.99', null, 'Paid by card through Stripe.'], [$invoice->amount, $invoice->admin_id, $invoice->note]);
        Mail::assertSent(InvoiceMail::class, fn ($mail) => $mail->hasTo('guest@example.com'));
        $this->assertStringContainsString('Paid by card through Stripe.', $order->history->last()->note);

        // Staff see the reference and the dashboard link; customers see paid_at, no Pay now.
        $this->adminRequest('GET', "/api/admin/v1/orders/{$number}")->assertOk()
            ->assertJsonPath('data.payment.reference', 'pi_test_1')
            ->assertJsonPath('data.payment.dashboard_url', 'https://dashboard.stripe.com/test/payments/pi_test_1')
            ->assertJsonPath('data.payment.can_pay', false)
            ->assertJsonPath('data.payment.url', null);
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.paid_at', $order->paid_at->toIso8601ZuluString())
            ->assertJsonPath('data.payment.can_pay', false)
            ->assertJsonMissingPath('data.payment.reference');
    }

    public function test_async_payment_succeeded_also_pays_and_unpaid_completion_waits(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');

        $this->webhook($this->sessionEvent('checkout.session.completed', $number, ['payment_status' => 'unpaid', 'payment_intent' => 'pi_test_1']))
            ->assertOk()->assertJsonPath('result', 'awaiting_payment');
        $this->assertSame('unpaid', Order::sole()->payment_status);

        $this->webhook($this->sessionEvent('checkout.session.async_payment_succeeded', $number))->assertOk()->assertJsonPath('result', 'paid');
        $this->assertSame('paid', Order::sole()->payment_status);
    }

    public function test_webhook_signatures(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');
        $event = $this->sessionEvent('checkout.session.completed', $number);
        $payload = json_encode($event);
        $invalid = ['message' => 'Invalid Stripe signature.'];

        // Wrong secret, missing header, garbage, stale (6 minutes old), from the future.
        $this->webhook($event, StripeGateway::signature($payload, 'whsec_wrong'))->assertStatus(400)->assertExactJson($invalid);
        $this->webhook($event, '')->assertStatus(400);
        $this->webhook($event, 'nonsense')->assertStatus(400);
        $this->webhook($event, StripeGateway::signature($payload, self::WEBHOOK_SECRET, now()->subMinutes(6)->getTimestamp()))->assertStatus(400);
        $this->webhook($event, StripeGateway::signature($payload, self::WEBHOOK_SECRET, now()->addMinutes(6)->getTimestamp()))->assertStatus(400);
        // A signature for a different body (tampered amount).
        $this->webhook([...$event, 'type' => 'checkout.session.expired'], StripeGateway::signature($payload, self::WEBHOOK_SECRET))->assertStatus(400);
        $this->assertSame('unpaid', Order::sole()->payment_status);
        $this->assertDatabaseCount('payment_events', 0); // phase 10 (part B): stripe_events became payment_events

        // Several v1 signatures (secret being rolled): one valid is enough. 4 minutes old is fine.
        $t = now()->subMinutes(4)->getTimestamp();
        $good = hash_hmac('sha256', "{$t}.{$payload}", self::WEBHOOK_SECRET);
        $this->webhook($event, "t={$t},v1=".str_repeat('0', 64).",v1={$good},v0=abc")->assertOk()->assertJsonPath('result', 'paid');

        // No webhook secret configured: everything is refused.
        config(['buynest.stripe.webhook_secret' => null]);
        $this->webhook($this->sessionEvent('checkout.session.completed', $number))->assertStatus(400);
    }

    public function test_a_duplicate_event_is_handled_once(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');
        $event = $this->sessionEvent('checkout.session.completed', $number, id: 'evt_same');

        $this->webhook($event)->assertOk()->assertJsonPath('result', 'paid');
        $this->webhook($event)->assertOk()->assertJsonPath('result', 'duplicate');
        // Same payment, new event id (Stripe sends completed + async): already paid, no-op.
        $this->webhook($this->sessionEvent('checkout.session.async_payment_succeeded', $number))->assertOk()->assertJsonPath('result', 'already_paid');

        $this->assertSame(1, Invoice::count());
        $this->assertSame(2, DB::table('payment_events')->where('provider', 'stripe')->count());
        $this->assertNotNull(DB::table('payment_events')->where('provider', 'stripe')->where('id', 'evt_same')->value('processed_at'));
        $this->assertSame(0, AdminNotification::count());
    }

    public function test_an_amount_mismatch_leaves_the_order_unpaid_and_tells_staff(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');

        $this->webhook($this->sessionEvent('checkout.session.completed', $number, ['amount_total' => 100]))->assertOk()
            ->assertJsonPath('result', 'amount_mismatch');
        $this->webhook($this->sessionEvent('checkout.session.completed', $number, ['currency' => 'eur']))->assertOk()
            ->assertJsonPath('result', 'amount_mismatch');

        $order = Order::sole();
        $this->assertSame(['pending_payment', 'unpaid', null], [$order->status, $order->payment_status, $order->payment_reference]);
        $this->assertSame(0, Invoice::count());
        $notification = AdminNotification::sole(); // one unread per order (no duplicates)
        $this->assertSame(['payment_problem', 'critical', 'orders.view', "/orders/{$number}"],
            [$notification->type, $notification->severity, $notification->permission, $notification->link]);
        $this->assertStringContainsString('$1.00 USD', $notification->body);
    }

    public function test_a_payment_for_a_cancelled_order_tells_staff(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');
        $this->adminRequest('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'cancelled'])->assertOk();
        // Cancelling closed the open payment page.
        Http::assertSent(fn (Request $request) => $request->url() === 'https://api.stripe.com/v1/checkout/sessions/cs_test_1/expire');
        $this->app['auth']->forgetGuards();

        $this->webhook($this->sessionEvent('checkout.session.completed', $number))->assertOk()->assertJsonPath('result', 'cancelled_order');
        $this->assertSame(['cancelled', 'unpaid'], [Order::sole()->status, Order::sole()->payment_status]);
        $this->assertSame('payment_problem', AdminNotification::sole()->type);
    }

    public function test_an_expired_session_cancels_the_order_once(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder(['coupon_code' => 'NEST10'])->assertCreated()->json('data.number');
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity);
        $this->assertSame(1, Coupon::where('code', 'NEST10')->value('times_used'));
        Mail::fake();

        $expired = $this->sessionEvent('checkout.session.expired', $number);
        $this->webhook($expired)->assertOk()->assertJsonPath('result', 'cancelled');

        $order = Order::sole();
        $this->assertSame(['cancelled', 'unpaid'], [$order->status, $order->payment_status]);
        $this->assertSame(5, $this->lamp->fresh()->stock_quantity);
        $this->assertSame(0, Coupon::where('code', 'NEST10')->value('times_used'));
        $last = $order->history->last();
        $this->assertSame(['cancelled', null, true], [$last->status, $last->admin_id, $last->customer_notified]);
        $this->assertStringContainsString('Payment not completed', $last->note);
        Mail::assertSent(PaymentNotCompletedMail::class, fn ($mail) => $mail->hasTo('guest@example.com')
            && str_contains($mail->render(), $number) && $mail->envelope()->subject === "Payment not completed for order {$number}");

        // Retried (same id) or sent again (new id): stock and coupons are given back once.
        $this->webhook($expired)->assertOk()->assertJsonPath('result', 'duplicate');
        $this->webhook($this->sessionEvent('checkout.session.expired', $number))->assertOk()->assertJsonPath('result', 'ignored');
        $this->assertSame(5, $this->lamp->fresh()->stock_quantity);
        Mail::assertSentCount(1);
        // The page had expired already: nothing asked Stripe to close it.
        Http::assertNotSent(fn (Request $request) => str_ends_with($request->url(), '/expire'));
    }

    public function test_an_old_session_expiring_after_pay_now_changes_nothing(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');
        $this->travel(31)->minutes();
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk(); // cs_test_2

        $this->webhook($this->sessionEvent('checkout.session.expired', $number))->assertOk()->assertJsonPath('result', 'superseded');
        $this->assertSame('pending_payment', Order::sole()->status);
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity);
    }

    public function test_other_events_and_unknown_orders_are_ignored(): void
    {
        $this->webhook(['id' => 'evt_1', 'object' => 'event', 'type' => 'customer.created', 'data' => ['object' => ['id' => 'cus_1']]])
            ->assertOk()->assertJsonPath('result', 'ignored');
        $this->webhook($this->sessionEvent('checkout.session.completed', 'BN-999999'))->assertOk()->assertJsonPath('result', 'unknown_order');
    }

    // ---- Refunds ------------------------------------------------------------

    private function stripePaidOrder(): array
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');
        $this->webhook($this->sessionEvent('checkout.session.completed', $number))->assertOk();

        return [$number, Order::sole()->items[0]->id];
    }

    public function test_a_credit_memo_refunds_the_card_through_stripe(): void
    {
        [$number, $item] = $this->stripePaidOrder();
        $order = Order::sole();

        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $item, 'quantity' => 1]], 'shipping_refund' => '4.99',
        ])->assertCreated()->assertJsonPath('data.total', '24.99')->assertJsonPath('data.refund_reference', 're_test_1');

        Http::assertSent(fn (Request $request) => $request->url() === 'https://api.stripe.com/v1/refunds'
            && $request->hasHeader('Authorization', 'Bearer '.self::SECRET)
            && $request->hasHeader('Idempotency-Key', "memo-order-{$order->id}-1-2499")
            && $request['payment_intent'] === 'pi_test_1' && $request['amount'] === '2499'
            && $request['metadata[order_number]'] === $number);
        $this->assertSame('re_test_1', CreditMemo::sole()->refund_reference);
        $this->assertSame(['closed', 'refunded'], [$order->fresh()->status, $order->fresh()->payment_status]);
        $this->assertStringContainsString('to the card through Stripe', $order->fresh()->history->last()->note);
    }

    public function test_stripe_refusing_the_refund_saves_nothing(): void
    {
        [$number, $item] = $this->stripePaidOrder();
        $this->refundAnswer = fn () => Http::response(['error' => [
            'type' => 'invalid_request_error', 'code' => 'charge_already_refunded', 'message' => 'Charge ch_1 has already been refunded.',
        ]], 400);

        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $item, 'quantity' => 1]], 'restock' => true,
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'Stripe refused the refund: Charge ch_1 has already been refunded.')
            ->assertJsonValidationErrors(['refund' => 'Stripe refused the refund: Charge ch_1 has already been refunded.']);

        $this->assertSame(0, CreditMemo::count());
        $this->assertSame(['processing', 'paid'], [Order::sole()->status, Order::sole()->payment_status]);
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity); // not restocked

        // Stripe unreachable: the same.
        $this->refundAnswer = fn () => throw new ConnectionException('timeout');
        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => $item, 'quantity' => 1]]])
            ->assertUnprocessable()->assertJsonPath('message', 'Stripe refused the refund: Stripe could not be reached. Please try again in a moment.');
        $this->assertSame(0, CreditMemo::count());
    }

    public function test_memos_on_orders_not_paid_through_stripe_work_as_before(): void
    {
        $this->fakeStripe();
        $number = $this->cardOrder()->json('data.number');
        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated(); // paid by hand
        $item = Order::sole()->items[0]->id;

        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => $item, 'quantity' => 1]]])
            ->assertCreated()->assertJsonPath('data.refund_reference', null);
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), '/refunds'));
    }

    // ---- Admin and store ----------------------------------------------------

    public function test_admin_created_card_orders_get_a_payment_link(): void
    {
        $this->fakeStripe();
        $this->travelTo(now()->startOfSecond());

        $response = $this->adminRequest('POST', '/api/admin/v1/orders', [
            'guest' => ['email' => 'phone@example.com', 'phone' => '+15550100100', 'first_name' => 'Pat', 'last_name' => 'Phone'],
            'items' => [['product_id' => $this->lamp->id, 'quantity' => 1]],
            'shipping_address' => ['first_name' => 'Pat', 'last_name' => 'Phone', 'line1' => '1 Road', 'city' => 'Town',
                'postal_code' => '29112', 'country' => 'United States'],
            'same_as_shipping' => true,
            'shipping_method' => 'standard',
            'payment_method' => 'card',
        ])->assertCreated();
        $number = $response->json('data.number');

        // Staff links stay open for Stripe's maximum (24 hours).
        $response->assertJsonPath('data.payment.url', 'https://checkout.stripe.com/c/pay/cs_test_1')
            ->assertJsonPath('data.payment.expires_at', now()->addDay()->toIso8601ZuluString())
            ->assertJsonPath('data.payment.reference', null);
        Http::assertSent(fn (Request $request) => $request['customer_email'] === 'phone@example.com'
            && $request['expires_at'] === (string) now()->addDay()->getTimestamp());

        $this->adminRequest('GET', "/api/admin/v1/orders/{$number}")->assertJsonPath('data.payment.url', 'https://checkout.stripe.com/c/pay/cs_test_1');

        // Expired: a new link on request (audited).
        $this->travel(25)->hours();
        $this->adminHeaders = null; // the sign-in expired too
        $this->adminRequest('GET', "/api/admin/v1/orders/{$number}")->assertJsonPath('data.payment.url', null)->assertJsonPath('data.payment.can_pay', true);
        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/payment-link")->assertOk()
            ->assertJsonPath('data.payment.url', 'https://checkout.stripe.com/c/pay/cs_test_2');
        $this->assertDatabaseHas('audit_log', ['action' => 'order.payment_link_created']);

        // Not a card order → 422.
        $cod = $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]])->json('data.number');
        $this->adminRequest('POST', "/api/admin/v1/orders/{$cod}/payment-link")->assertUnprocessable()->assertJsonValidationErrors('order');
        $this->adminRequest('POST', '/api/admin/v1/orders/BN-999999/payment-link')->assertNotFound();
    }

    public function test_the_store_says_how_cards_are_paid(): void
    {
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.card_payments', 'stripe');
        config(['buynest.stripe.secret_key' => null]);
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.card_payments', 'manual');
    }

    public function test_stripe_disabled_keeps_the_old_behaviour(): void
    {
        config(['buynest.stripe.secret_key' => null]);
        $this->fakeStripe();

        $response = $this->cardOrder()->assertCreated()
            ->assertJsonPath('data.payment', ['provider' => null, 'paid_at' => null, 'url' => null, 'expires_at' => null, 'can_pay' => false, 'method_label' => null]);
        $number = $response->json('data.number');
        $this->assertSame(['pending_payment', 'unpaid', 0], [Order::sole()->status, Order::sole()->payment_status, Order::sole()->payment_attempts]);

        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertUnprocessable()
            ->assertJsonValidationErrors('order');
        // Staff invoice and refund by hand.
        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => Order::sole()->items[0]->id, 'quantity' => 1]]])
            ->assertCreated();
        Http::assertNothingSent();
        Mail::assertSent(OrderPlacedMail::class, fn ($mail) => str_contains($mail->render(), 'Online payment is not connected yet'));
    }

    public function test_the_order_email_points_card_shoppers_to_the_payment_page(): void
    {
        $this->fakeStripe();
        $this->cardOrder()->assertCreated();
        Mail::assertSent(OrderPlacedMail::class, fn ($mail) => str_contains($mail->render(), 'secure payment page'));
    }

    public function test_the_gateway_encodes_nested_parameters(): void
    {
        $this->assertSame([
            'mode' => 'payment',
            'line_items[0][price_data][unit_amount]' => '1999',
            'line_items[0][quantity]' => '1',
            'metadata[order_number]' => 'BN-1',
            'flag' => 'true',
        ], StripeGateway::encode([
            'mode' => 'payment',
            'line_items' => [['price_data' => ['unit_amount' => 1999], 'quantity' => 1]],
            'metadata' => ['order_number' => 'BN-1'],
            'flag' => true,
            'skipped' => null,
        ]));
    }

    // ---- Email test command -------------------------------------------------

    public function test_the_mail_test_command(): void
    {
        $this->artisan('buynest:mail-test', ['to' => 'owner@example.com'])
            ->expectsOutputToContain('Sending a test email to owner@example.com')
            ->expectsOutputToContain('Sent.')
            ->assertSuccessful();
        $this->artisan('buynest:mail-test', ['to' => 'not-an-email'])->expectsOutputToContain('is not an email address')->assertFailed();
    }
}
