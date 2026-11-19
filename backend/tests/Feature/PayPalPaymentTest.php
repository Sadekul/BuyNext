<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Mail\PaymentNotCompletedMail;
use App\Models\AdminNotification;
use App\Models\CreditMemo;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 10 (part B): PayPal (Orders API v2, redirect approval). PayPal is
 * always a stand-in (Http::fake on a made-up base URL): no test talks to
 * the real API.
 *
 * The order used: lamp 20.00 × 1 + standard shipping 4.99 = 24.99.
 */
class PayPalPaymentTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const API = 'https://paypal.test';

    private Product $lamp;

    private int $orders = 0;

    private int $tokens = 0;

    /** What the stand-in answers (tests change these). */
    private $captureAnswer = null;

    private $getAnswer = null;

    private $refundAnswer = null;

    private $verifyAnswer = null;

    private ?array $adminHeaders = null;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'buynest.paypal.client_id' => 'test-client-id',
            'buynest.paypal.client_secret' => 'test-client-secret',
            'buynest.paypal.mode' => 'sandbox',
            'buynest.paypal.webhook_id' => 'WH-TEST-1',
            'buynest.paypal.api_url' => self::API,
            'buynest.storefront_url' => 'https://shop.example.com',
        ]);
        $this->lamp = $this->product(['price' => '20.00', 'stock_quantity' => 5]);
    }

    private function fakePayPal(): void
    {
        Http::fake(function (Request $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);

            return match (true) {
                $path === '/v1/oauth2/token' => Http::response(['access_token' => 'A21-token-'.(++$this->tokens), 'token_type' => 'Bearer', 'expires_in' => 32400]),
                $path === '/v2/checkout/orders' => $this->created(),
                str_ends_with($path, '/capture') => value($this->captureAnswer) ?? $this->completed(basename(dirname($path))),
                str_starts_with($path, '/v2/checkout/orders/') => value($this->getAnswer) ?? Http::response(['id' => basename($path), 'status' => 'PAYER_ACTION_REQUIRED']),
                str_ends_with($path, '/refund') => value($this->refundAnswer) ?? Http::response(['id' => 'REFUND-1', 'status' => 'COMPLETED']),
                $path === '/v1/notifications/verify-webhook-signature' => value($this->verifyAnswer) ?? Http::response(['verification_status' => 'SUCCESS']),
                default => Http::response(['name' => 'NOT_FOUND'], 404),
            };
        });
    }

    private function created()
    {
        $this->orders++;

        return Http::response([
            'id' => "PPORDER{$this->orders}",
            'status' => 'PAYER_ACTION_REQUIRED',
            'links' => [
                ['href' => self::API."/v2/checkout/orders/PPORDER{$this->orders}", 'rel' => 'self', 'method' => 'GET'],
                ['href' => "https://www.sandbox.paypal.com/checkoutnow?token=PPORDER{$this->orders}", 'rel' => 'payer-action', 'method' => 'GET'],
            ],
        ], 200);
    }

    /** A completed PayPal order with its capture. */
    private function completed(string $orderId, string $amount = '24.99', string $currency = 'USD', string $status = 'COMPLETED')
    {
        return Http::response([
            'id' => $orderId,
            'status' => 'COMPLETED',
            'purchase_units' => [['reference_id' => 'x', 'payments' => ['captures' => [[
                'id' => 'CAPTURE-'.$orderId, 'status' => $status, 'amount' => ['currency_code' => $currency, 'value' => $amount],
                'custom_id' => Order::latest('id')->value('number'),
            ]]]]],
        ], 201);
    }

    private function paypalOrder(array $overrides = [])
    {
        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['payment_method' => 'paypal', ...$overrides]);
    }

    private function capture(string $number, string $token, ?string $email = 'guest@example.com')
    {
        return $this->postJson("/api/v1/orders/{$number}/paypal/capture", ['token' => $token, 'email' => $email]);
    }

    private function webhook(array $event, array $headers = [])
    {
        return $this->call('POST', '/api/v1/payments/paypal/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_PAYPAL_AUTH_ALGO' => 'SHA256withRSA',
            'HTTP_PAYPAL_CERT_URL' => 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
            'HTTP_PAYPAL_TRANSMISSION_ID' => 'trans-'.uniqid(),
            'HTTP_PAYPAL_TRANSMISSION_SIG' => 'c2lnbmF0dXJl',
            'HTTP_PAYPAL_TRANSMISSION_TIME' => now()->toIso8601ZuluString(),
            ...$headers,
        ], json_encode($event));
    }

    private function captureEvent(string $number, string $amount = '24.99', ?string $id = null, string $captureId = 'CAPTURE-WH'): array
    {
        return [
            'id' => $id ?? 'WH-'.uniqid(),
            'event_type' => 'PAYMENT.CAPTURE.COMPLETED',
            'resource' => [
                'id' => $captureId, 'status' => 'COMPLETED', 'amount' => ['currency_code' => 'USD', 'value' => $amount], 'custom_id' => $number,
                'supplementary_data' => ['related_ids' => ['order_id' => 'PPORDER1']],
            ],
        ];
    }

    private function adminRequest(string $method, string $uri, array $body = [])
    {
        $this->adminHeaders ??= $this->adminHeaders();

        return $this->asAdmin($this->adminHeaders, $method, $uri, $body);
    }

    // ---- Switch ---------------------------------------------------------------

    public function test_without_credentials_paypal_orders_wait_for_staff_as_before(): void
    {
        config(['buynest.paypal.client_id' => null, 'buynest.paypal.client_secret' => null]);
        Http::fake();

        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.paypal_payments', 'manual');
        $order = $this->paypalOrder()->assertCreated()
            ->assertJsonPath('data.status', 'pending_payment')
            ->assertJsonPath('data.payment', ['provider' => null, 'paid_at' => null, 'url' => null, 'expires_at' => null, 'can_pay' => false, 'method_label' => null]);
        $this->postJson('/api/v1/orders/'.$order->json('data.number').'/pay', ['email' => 'guest@example.com'])
            ->assertStatus(422)->assertJsonPath('errors.order.0', 'Online PayPal payments aren\'t available right now. We\'ll contact you about the payment.');
        Http::assertNothingSent();

        config(['buynest.paypal.client_id' => 'id', 'buynest.paypal.client_secret' => 'secret']);
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.paypal_payments', 'paypal');
    }

    // ---- Creating and capturing -----------------------------------------------

    public function test_a_paypal_order_gets_an_approval_link_for_its_amount_due(): void
    {
        $this->fakePayPal();
        $this->travelTo(now()->startOfSecond());

        $response = $this->paypalOrder()->assertCreated();
        $order = Order::sole();
        $response->assertJsonPath('data.payment.provider', 'paypal')
            ->assertJsonPath('data.payment.url', 'https://www.sandbox.paypal.com/checkoutnow?token=PPORDER1')
            ->assertJsonPath('data.payment.expires_at', now()->addHours(3)->toIso8601ZuluString())
            ->assertJsonPath('data.payment.can_pay', true)
            ->assertJsonPath('data.payment_status', 'unpaid');
        $this->assertSame('PPORDER1', $order->payment_session_id);

        Http::assertSent(function (Request $request) use ($order) {
            if (! str_ends_with($request->url(), '/v2/checkout/orders')) {
                return false;
            }
            $unit = $request['purchase_units'][0];
            $context = $request['payment_source']['paypal']['experience_context'];

            return $request['intent'] === 'CAPTURE'
                && $unit['amount'] === ['currency_code' => 'USD', 'value' => '24.99']
                && $unit['custom_id'] === $order->number
                && $context['return_url'] === "https://shop.example.com/order-confirmation/{$order->number}?payment=success&provider=paypal"
                && $context['cancel_url'] === "https://shop.example.com/order-confirmation/{$order->number}?payment=cancelled&provider=paypal"
                && $request->header('PayPal-Request-Id') === ["order-{$order->id}-paypal-1"]
                && $request->header('Authorization') === ['Bearer A21-token-1'];
        });
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/v1/oauth2/token')
            && $request->header('Authorization') === ['Basic '.base64_encode('test-client-id:test-client-secret')]
            && $request['grant_type'] === 'client_credentials');

        // The token is cached: a second order doesn't ask for a new one.
        $this->paypalOrder()->assertCreated();
        $this->assertSame(1, $this->tokens);
    }

    public function test_paypal_unreachable_still_creates_the_order_and_pay_now_retries(): void
    {
        $down = true;
        Http::fake(['paypal.test/v2/checkout/orders' => function () use (&$down) {
            return $down ? Http::response(['name' => 'INTERNAL_SERVER_ERROR', 'message' => 'oops'], 500) : $this->created();
        }, '*' => Http::response(['access_token' => 'tok', 'expires_in' => 3600])]);

        $number = $this->paypalOrder()->assertCreated()
            ->assertJsonPath('data.payment.url', null)
            ->assertJsonPath('data.payment.error', 'PayPal is having trouble right now. Please try again in a moment.')
            ->json('data.number');
        $this->assertSame('unpaid', Order::sole()->payment_status);

        $down = false;
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.url', 'https://www.sandbox.paypal.com/checkoutnow?token=PPORDER1');
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/v2/checkout/orders')
            && $request->header('PayPal-Request-Id') === ['order-'.Order::sole()->id.'-paypal-2']);
    }

    public function test_capturing_after_the_approval_marks_the_order_paid(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');

        $this->capture($number, 'PPORDER1')->assertOk()
            ->assertJsonPath('result', 'paid')
            ->assertJsonPath('data.payment_status', 'paid')
            ->assertJsonPath('data.status', 'processing')
            ->assertJsonPath('data.payment.provider', 'paypal')
            ->assertJsonPath('data.payment.can_pay', false);

        $order = Order::sole();
        $this->assertSame('CAPTURE-PPORDER1', $order->payment_reference);
        $this->assertNotNull($order->paid_at);
        $this->assertSame('Paid through PayPal.', Invoice::sole()->note);
        $this->assertStringContainsString('Paid through PayPal.', $order->history()->reorder('id', 'desc')->value('note'));
        Mail::assertSent(InvoiceMail::class, fn ($mail) => $mail->hasTo('guest@example.com'));
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/v2/checkout/orders/PPORDER1/capture')
            && $request->header('PayPal-Request-Id') === ['capture-PPORDER1']);

        // Back again (refresh): already paid, nothing new.
        $this->capture($number, 'PPORDER1')->assertOk()->assertJsonPath('result', 'already_paid');
        $this->assertSame(1, Invoice::count());

        // The admin sees the capture and its PayPal page.
        $this->adminRequest('GET', "/api/admin/v1/orders/{$number}")->assertOk()
            ->assertJsonPath('data.payment.reference', 'CAPTURE-PPORDER1')
            ->assertJsonPath('data.payment.dashboard_url', 'https://www.sandbox.paypal.com/activity/payment/CAPTURE-PPORDER1');
    }

    public function test_capture_checks_the_shopper_the_token_and_the_amount(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');

        $this->capture($number, 'PPORDER1', 'someone@example.com')->assertNotFound();
        $this->capture($number, 'PPORDER-OTHER')->assertStatus(422)
            ->assertJsonPath('errors.payment.0', 'This PayPal payment doesn\'t belong to this order.');

        // PayPal captured a different amount: left unpaid, staff told.
        $this->captureAnswer = fn () => $this->completed('PPORDER1', '20.00');
        $this->capture($number, 'PPORDER1')->assertStatus(422)
            ->assertJsonPath('errors.payment.0', 'We couldn\'t confirm this payment. Our team has been told and will contact you.');
        $this->assertSame('unpaid', Order::sole()->payment_status);
        $this->assertSame(0, Invoice::count());
        $this->assertSame('payment_problem', AdminNotification::sole()->type);
        $this->assertSame('critical', AdminNotification::sole()->severity);
    }

    public function test_a_declined_payment_and_an_already_captured_order(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');

        $this->captureAnswer = fn () => Http::response(['name' => 'UNPROCESSABLE_ENTITY', 'details' => [['issue' => 'INSTRUMENT_DECLINED',
            'description' => 'The instrument presented was either declined by the processor or bank']]], 422);
        $this->capture($number, 'PPORDER1')->assertStatus(422)->assertJsonPath('errors.payment.0',
            'PayPal declined the payment: The instrument presented was either declined by the processor or bank. You can try again with Pay now.');
        $this->assertSame('unpaid', Order::sole()->payment_status);

        // A retry finds it was captured meanwhile: PayPal says so, we read the order instead.
        $this->captureAnswer = fn () => Http::response(['name' => 'UNPROCESSABLE_ENTITY', 'details' => [['issue' => 'ORDER_ALREADY_CAPTURED']]], 422);
        $this->getAnswer = fn () => $this->completed('PPORDER1');
        $this->capture($number, 'PPORDER1')->assertOk()->assertJsonPath('result', 'paid');
        $this->assertSame('paid', Order::sole()->payment_status);
    }

    public function test_a_cancelled_order_cant_be_captured(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');
        $this->postJson("/api/v1/orders/{$number}/cancel", ['email' => 'guest@example.com'])->assertOk();
        $this->assertNull(Order::sole()->payment_url);

        $this->capture($number, 'PPORDER1')->assertStatus(422)->assertJsonPath('errors.payment.0', 'This order was cancelled, so it can\'t be paid.');
        Http::assertNotSent(fn (Request $request) => str_ends_with($request->url(), '/capture'));
    }

    // ---- Webhooks ---------------------------------------------------------------

    public function test_webhooks_are_verified_with_paypal(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');
        $event = $this->captureEvent($number);

        $this->verifyAnswer = fn () => Http::response(['verification_status' => 'FAILURE']);
        $this->webhook($event)->assertStatus(400)->assertJson(['message' => 'Invalid PayPal signature.']);
        $this->webhook($event, ['HTTP_PAYPAL_TRANSMISSION_SIG' => ''])->assertStatus(400);
        $this->verifyAnswer = fn () => Http::response(['name' => 'INTERNAL_SERVER_ERROR'], 503);
        $this->webhook($event)->assertStatus(503);
        config(['buynest.paypal.webhook_id' => null]);
        $this->verifyAnswer = null;
        $this->webhook($event)->assertStatus(400);
        $this->assertSame('unpaid', Order::sole()->payment_status);
        $this->assertDatabaseCount('payment_events', 0);

        config(['buynest.paypal.webhook_id' => 'WH-TEST-1']);
        $this->webhook($event)->assertOk()->assertJson(['received' => true, 'result' => 'paid']);
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/v1/notifications/verify-webhook-signature')
            && $request['webhook_id'] === 'WH-TEST-1' && $request['webhook_event']['id'] === $event['id']
            && $request['auth_algo'] === 'SHA256withRSA' && $request['transmission_sig'] === 'c2lnbmF0dXJl');
    }

    public function test_a_missed_return_trip_is_paid_by_the_webhook_once(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');
        $event = $this->captureEvent($number, id: 'WH-SAME');

        $this->webhook($event)->assertOk()->assertJsonPath('result', 'paid');
        $this->webhook($event)->assertOk()->assertJsonPath('result', 'duplicate');
        $this->webhook($this->captureEvent($number))->assertOk()->assertJsonPath('result', 'already_paid');

        $this->assertSame(1, Invoice::count());
        $this->assertSame('CAPTURE-WH', Order::sole()->payment_reference);
        $this->assertSame(2, DB::table('payment_events')->where('provider', 'paypal')->count());
        $this->assertSame(0, AdminNotification::count());

        // Amount mismatch through the webhook: unpaid order stays unpaid.
        $other = $this->paypalOrder()->json('data.number');
        $this->webhook($this->captureEvent($other, '1.00'))->assertOk()->assertJsonPath('result', 'amount_mismatch');
        $this->assertSame('unpaid', Order::where('number', $other)->value('payment_status'));
        $unknown = $this->captureEvent('BN-999999');
        $unknown['resource']['supplementary_data']['related_ids']['order_id'] = 'PPORDER-NONE';
        $this->webhook($unknown)->assertOk()->assertJsonPath('result', 'unknown_order');
        $this->webhook(['id' => 'WH-X', 'event_type' => 'BILLING.SUBSCRIPTION.CREATED', 'resource' => []])->assertOk()->assertJsonPath('result', 'ignored');
    }

    public function test_an_approved_order_is_captured_by_the_webhook(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');

        $this->webhook(['id' => 'WH-APPROVED', 'event_type' => 'CHECKOUT.ORDER.APPROVED', 'resource' => [
            'id' => 'PPORDER1', 'status' => 'APPROVED', 'purchase_units' => [['custom_id' => $number]],
        ]])->assertOk()->assertJsonPath('result', 'paid');
        $this->assertSame('paid', Order::sole()->payment_status);
        Mail::assertSent(InvoiceMail::class);

        // An approval of an older PayPal order (Pay now made a new one) is ignored.
        $other = $this->paypalOrder()->json('data.number');
        $this->webhook(['id' => 'WH-OLD', 'event_type' => 'CHECKOUT.ORDER.APPROVED', 'resource' => [
            'id' => 'PPORDER-OLD', 'status' => 'APPROVED', 'purchase_units' => [['custom_id' => $other]],
        ]])->assertOk()->assertJsonPath('result', 'ignored');
    }

    public function test_refunds_made_outside_buynest_are_flagged(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');
        $this->capture($number, 'PPORDER1')->assertOk();

        // Our own refund (a credit memo) comes back as a webhook: nothing to do.
        $item = Order::sole()->items->first();
        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $item->id, 'quantity' => 1]], 'shipping_refund' => '0.00', 'adjustment' => '0.00',
        ])->assertCreated();
        $refundResource = fn (string $id) => ['id' => $id, 'status' => 'COMPLETED', 'amount' => ['value' => '20.00', 'currency_code' => 'USD'],
            'links' => [['rel' => 'up', 'href' => self::API.'/v2/payments/captures/CAPTURE-PPORDER1']]];
        $this->webhook(['id' => 'WH-R1', 'event_type' => 'PAYMENT.CAPTURE.REFUNDED', 'resource' => $refundResource('REFUND-1')])
            ->assertOk()->assertJsonPath('result', 'ignored');
        $this->assertSame(0, AdminNotification::count());

        $this->webhook(['id' => 'WH-R2', 'event_type' => 'PAYMENT.CAPTURE.REFUNDED', 'resource' => $refundResource('REFUND-DASHBOARD')])
            ->assertOk()->assertJsonPath('result', 'refund_noted');
        $notification = AdminNotification::sole();
        $this->assertSame('payment_problem', $notification->type);
        $this->assertSame("PayPal payment refunded for order {$number}", $notification->title);
    }

    // ---- Expiry -------------------------------------------------------------------

    public function test_unpaid_paypal_orders_expire_after_three_hours_once(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity);

        $this->travel(2)->hours();
        $this->artisan('buynest:payments:expire-paypal')->assertSuccessful();
        $this->assertSame('pending_payment', Order::sole()->status);

        $this->travel(61)->minutes();
        $this->artisan('buynest:payments:expire-paypal')->expectsOutputToContain('cancelled 1')->assertSuccessful();
        $order = Order::sole();
        $this->assertSame('cancelled', $order->status);
        $this->assertSame(5, $this->lamp->fresh()->stock_quantity);
        $this->assertStringContainsString('the PayPal payment window expired', $order->history()->reorder('id', 'desc')->value('note'));
        Mail::assertSent(PaymentNotCompletedMail::class, fn ($mail) => $mail->hasTo('guest@example.com'));
        Http::assertSent(fn (Request $request) => $request->method() === 'GET' && str_ends_with($request->url(), '/v2/checkout/orders/PPORDER1'));

        // Once only.
        $this->artisan('buynest:payments:expire-paypal')->expectsOutputToContain('No expired PayPal payments.')->assertSuccessful();
        $this->assertSame(5, $this->lamp->fresh()->stock_quantity);
        Mail::assertSentCount(2); // the order confirmation + "Payment not completed"
        $this->assertNotNull($number);
    }

    public function test_an_expired_order_paid_at_paypal_is_recorded_instead_of_cancelled(): void
    {
        $this->fakePayPal();
        $this->paypalOrder();
        $this->getAnswer = fn () => $this->completed('PPORDER1');

        $this->travel(4)->hours();
        $this->artisan('buynest:payments:expire-paypal')->expectsOutputToContain('paid 1')->assertSuccessful();
        $this->assertSame('paid', Order::sole()->payment_status);
        $this->assertSame('processing', Order::sole()->status);

        // PayPal unreachable: the order is left for the next run.
        $second = $this->paypalOrder()->json('data.number');
        $this->getAnswer = fn () => Http::response(['name' => 'INTERNAL_SERVER_ERROR'], 503);
        $this->travel(4)->hours();
        $this->artisan('buynest:payments:expire-paypal')->expectsOutputToContain('skipped 1')->assertSuccessful();
        $this->assertSame('pending_payment', Order::where('number', $second)->value('status'));
    }

    // ---- Refunds --------------------------------------------------------------------

    public function test_refunds_go_back_through_paypal_first(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');
        $this->capture($number, 'PPORDER1')->assertOk();
        $item = Order::sole()->items->first();
        $memo = fn () => $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $item->id, 'quantity' => 1]], 'shipping_refund' => '4.99', 'adjustment' => '0.00', 'restock' => true,
        ]);

        // PayPal refuses: nothing is saved.
        $this->refundAnswer = fn () => Http::response(['name' => 'UNPROCESSABLE_ENTITY', 'details' => [['issue' => 'CAPTURE_FULLY_REFUNDED',
            'description' => 'The capture has already been fully refunded']]], 422);
        $memo()->assertStatus(422)->assertJsonPath('errors.refund.0', 'PayPal refused the refund: The capture has already been fully refunded');
        $this->assertSame(0, CreditMemo::count());
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity);
        $this->assertSame('paid', Order::sole()->payment_status);

        $this->refundAnswer = null;
        $memo()->assertCreated()->assertJsonPath('data.refund_reference', 'REFUND-1')->assertJsonPath('data.other_refund', '24.99');
        $this->assertSame('refunded', Order::sole()->payment_status);
        $this->assertStringContainsString('refunded through PayPal.', Order::sole()->history()->reorder('id', 'desc')->value('note'));
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/v2/payments/captures/CAPTURE-PPORDER1/refund')
            && $request['amount'] === ['value' => '24.99', 'currency_code' => 'USD']
            && $request->header('PayPal-Request-Id') === ['memo-order-'.Order::sole()->id.'-1-2499']);
    }

    // ---- Pay now and staff links -------------------------------------------------

    public function test_pay_now_and_admin_payment_links_work_for_paypal(): void
    {
        $this->fakePayPal();
        $number = $this->paypalOrder()->json('data.number');

        // The open link is given back; once it is about to expire, a new PayPal order is made.
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.url', 'https://www.sandbox.paypal.com/checkoutnow?token=PPORDER1');
        $this->travel(179)->minutes();
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.url', 'https://www.sandbox.paypal.com/checkoutnow?token=PPORDER2');
        $this->assertSame('PPORDER2', Order::sole()->payment_session_id);
        // The old approval can't be captured any more.
        $this->capture($number, 'PPORDER1')->assertStatus(422);

        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/payment-link")->assertOk()
            ->assertJsonPath('data.payment.url', 'https://www.sandbox.paypal.com/checkoutnow?token=PPORDER2');

        // A card order still says "not PayPal" for the PayPal capture.
        $card = $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['payment_method' => 'card'])->json('data.number');
        $this->capture($card, 'PPORDER1')->assertStatus(422)->assertJsonPath('errors.payment.0', 'This order isn\'t paid with PayPal.');
    }
}
