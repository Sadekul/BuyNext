<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Mail\PaymentNotCompletedMail;
use App\Models\AdminNotification;
use App\Models\AuditLog;
use App\Models\CreditMemo;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Product;
use App\Services\Checkout;
use App\Services\GiftCards;
use App\Services\Payments\SslCommerzGateway;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 12: SSLCommerz (bKash, Nagad, cards) in a taka store. SSLCommerz is
 * always a stand-in (Http::fake on a made-up base URL): no test talks to the
 * real API.
 *
 * The order used: lamp ৳1,250.00 × 1 + standard shipping free shipping (over ৳50.00) = ৳1,250.00.
 */
class SslCommerzPaymentTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private const API = 'https://sslcommerz.test';

    private Product $lamp;

    private int $sessions = 0;

    /** What the stand-in answers (tests change these). */
    private $sessionAnswer = null;

    /** val_id => validation answer (array), or a closure. */
    private array $validations = [];

    private $validationAnswer = null;

    /** tran_id => list of transactions for the query API. */
    private array $transactions = [];

    private $queryAnswer = null;

    private $refundAnswer = null;

    private ?array $adminHeaders = null;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'buynest.store.currency' => 'BDT',
            'buynest.sslcommerz.store_id' => 'buynesttest',
            'buynest.sslcommerz.store_password' => 'test-store-password',
            'buynest.sslcommerz.mode' => 'sandbox',
            'buynest.sslcommerz.api_url' => self::API,
            'buynest.storefront_url' => 'https://shop.example.com',
        ]);
        app(Settings::class)->put(['enabled_payment_methods' => ['card', 'paypal', 'cod', 'sslcommerz']]);
        $this->lamp = $this->product(['price' => '1250.00', 'stock_quantity' => 5]);
    }

    private function fakeSslCommerz(): void
    {
        Http::fake(function (Request $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

            return match (true) {
                $path === '/gwprocess/v4/api.php' => value($this->sessionAnswer) ?? $this->sessionPage(),
                $path === '/validator/api/validationserverAPI.php' => value($this->validationAnswer)
                    ?? Http::response($this->validations[$query['val_id'] ?? ''] ?? ['status' => 'INVALID_TRANSACTION']),
                $path === '/validator/api/merchantTransIDvalidationAPI.php' && isset($query['refund_amount']) => value($this->refundAnswer)
                    ?? Http::response(['APIConnect' => 'DONE', 'bank_tran_id' => $query['bank_tran_id'], 'status' => 'success', 'refund_ref_id' => 'RF-1']),
                $path === '/validator/api/merchantTransIDvalidationAPI.php' => value($this->queryAnswer)
                    ?? Http::response(['APIConnect' => 'DONE', 'no_of_trans_found' => count($this->transactions[$query['tran_id'] ?? ''] ?? []),
                        'element' => $this->transactions[$query['tran_id'] ?? ''] ?? []]),
                default => Http::response(['status' => 'FAILED'], 404),
            };
        });
    }

    private function sessionPage()
    {
        $this->sessions++;

        return Http::response(['status' => 'SUCCESS', 'sessionkey' => "SESSION{$this->sessions}",
            'GatewayPageURL' => "https://sandbox.sslcommerz.com/EasyCheckOut/testcde{$this->sessions}"]);
    }

    /** A VALID payment of $tranId as the validation / query APIs answer it. */
    private function payment(string $tranId, string $valId = 'VAL-1', string $amount = '1250.00', string $currency = 'BDT', string $risk = '0',
        string $cardType = 'BKASH-BKash'): array
    {
        return [
            'status' => 'VALID', 'tran_id' => $tranId, 'val_id' => $valId, 'amount' => $amount, 'store_amount' => $amount,
            'currency' => $currency, 'currency_type' => $currency, 'currency_amount' => $amount, 'bank_tran_id' => 'BANK-'.$valId,
            'card_type' => $cardType, 'card_brand' => 'MOBILEBANKING', 'card_issuer' => 'BKash Mobile Banking', 'risk_level' => $risk,
            'risk_title' => $risk === '1' ? 'Risky' : 'Safe', 'value_a' => explode('-', $tranId, 3)[0].'-'.explode('-', $tranId, 3)[1],
        ];
    }

    private function sslOrder(array $overrides = [])
    {
        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], [
            'payment_method' => 'sslcommerz',
            'phone' => '+8801711000000',
            'shipping_address' => [
                'first_name' => 'Rahim', 'last_name' => 'Uddin', 'line1' => 'House 12, Road 5', 'line2' => null,
                'city' => 'Dhaka', 'state' => null, 'postal_code' => '1207', 'country' => 'Bangladesh',
            ],
            ...$overrides,
        ]);
    }

    private function returnTrip(string $result, string $tranId, ?string $valId = null, string $status = 'VALID')
    {
        return $this->postJson('/api/v1/payments/sslcommerz/return', array_filter(['result' => $result, 'tran_id' => $tranId, 'val_id' => $valId,
            'status' => $status]));
    }

    private function ipn(array $post)
    {
        return $this->call('POST', '/api/v1/payments/sslcommerz/ipn', $post, [], [], ['HTTP_ACCEPT' => 'application/json']);
    }

    private function adminRequest(string $method, string $uri, array $body = [])
    {
        $this->adminHeaders ??= $this->adminHeaders();

        return $this->asAdmin($this->adminHeaders, $method, $uri, $body);
    }

    /** Sent session requests' form fields. */
    private function sessionRequests(): array
    {
        return Http::recorded(fn (Request $request) => str_ends_with(parse_url($request->url(), PHP_URL_PATH), '/gwprocess/v4/api.php'))
            ->map(fn ($pair) => $pair[0]->data())->values()->all();
    }

    // ---- Store currency and switches ----------------------------------------------

    public function test_a_taka_store_offers_sslcommerz_and_hides_paypal(): void
    {
        $this->fakeSslCommerz();
        $this->getJson('/api/v1/store')->assertOk()
            ->assertJsonPath('data.currency', ['code' => 'BDT', 'symbol' => '৳', 'decimals' => 2])
            ->assertJsonPath('data.currencies.base', 'BDT')
            ->assertJsonPath('data.sslcommerz_payments', 'sslcommerz')
            ->assertJsonPath('data.paypal_payments', 'unavailable')
            ->assertJsonPath('data.payment_methods', ['card', 'cod', 'sslcommerz']);

        // PayPal can't be chosen in taka.
        $this->sslOrder(['payment_method' => 'paypal'])->assertStatus(422)
            ->assertJsonPath('errors.payment_method.0', 'PayPal doesn\'t accept BDT, so it isn\'t available in this store.');

        // Without the store id and password: staff take the payment (manual), like other methods.
        config(['buynest.sslcommerz.store_id' => null]);
        $this->getJson('/api/v1/store')->assertJsonPath('data.sslcommerz_payments', 'manual');
        $this->sslOrder()->assertCreated()->assertJsonPath('data.status', 'pending_payment')->assertJsonPath('data.payment.url', null)
            ->assertJsonPath('data.currency', 'BDT');
        Http::assertNothingSent();

        // In a dollar store SSLCommerz is unavailable and refused.
        config(['buynest.store.currency' => 'USD', 'buynest.sslcommerz.store_id' => 'buynesttest']);
        $this->getJson('/api/v1/store')->assertJsonPath('data.sslcommerz_payments', 'unavailable')->assertJsonPath('data.paypal_payments', 'manual')
            ->assertJsonPath('data.payment_methods', ['card', 'paypal', 'cod']);
        $this->sslOrder()->assertStatus(422)
            ->assertJsonPath('errors.payment_method.0', 'bKash, Nagad and cards (SSLCommerz) need the store currency BDT.');
    }

    public function test_admin_settings_show_the_store_currency_and_provider_states(): void
    {
        $this->adminRequest('GET', '/api/admin/v1/settings')->assertOk()
            ->assertJsonPath('meta.currency', 'BDT')
            ->assertJsonPath('meta.store_currency', ['code' => 'BDT', 'symbol' => '৳', 'decimals' => 2])
            ->assertJsonPath('meta.currency_docs', 'docs/CURRENCY.md')
            ->assertJsonPath('meta.payment_providers.sslcommerz', ['status' => 'sandbox', 'message' => 'Sandbox'])
            ->assertJsonPath('meta.payment_providers.paypal', ['status' => 'unavailable', 'message' => 'Not available in BDT'])
            ->assertJsonPath('meta.payment_providers.stripe.status', 'not_configured')
            ->assertJsonPath('meta.payment_methods.3', ['id' => 'sslcommerz', 'label' => 'bKash, Nagad, cards (SSLCommerz)']);

        config(['buynest.sslcommerz.store_password' => null]);
        $this->adminRequest('GET', '/api/admin/v1/settings')->assertJsonPath('meta.payment_providers.sslcommerz',
            ['status' => 'not_configured', 'message' => 'Not configured: set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD']);
        config(['buynest.store.currency' => 'USD']);
        $this->adminRequest('GET', '/api/admin/v1/settings')->assertJsonPath('meta.payment_providers.sslcommerz.status', 'unavailable')
            ->assertJsonPath('meta.payment_providers.sslcommerz.message', 'Needs the store currency BDT');
    }

    // ---- Session ------------------------------------------------------------------

    public function test_placing_an_order_opens_a_session_for_the_amount_due_after_the_gift_card(): void
    {
        $this->fakeSslCommerz();
        [, $code] = app(GiftCards::class)->create(25000, []); // ৳250.00, in taka

        $response = $this->sslOrder(['gift_card_code' => $code])->assertCreated()
            ->assertJsonPath('data.currency', 'BDT')
            ->assertJsonPath('data.totals.amount_due', '1000.00')
            ->assertJsonPath('data.payment.provider', 'sslcommerz')
            ->assertJsonPath('data.payment.url', 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde1')
            ->assertJsonPath('data.payment.can_pay', true)
            ->assertJsonPath('data.payment.method_label', null);
        $number = $response->json('data.number');

        $fields = $this->sessionRequests()[0];
        $this->assertSame('buynesttest', $fields['store_id']);
        $this->assertSame('test-store-password', $fields['store_passwd']);
        $this->assertSame('1000.00', $fields['total_amount']);
        $this->assertSame('BDT', $fields['currency']);
        $this->assertSame("{$number}-1", $fields['tran_id']);
        $this->assertSame('https://shop.example.com/api/payments/sslcommerz/return/success', $fields['success_url']);
        $this->assertSame('https://shop.example.com/api/payments/sslcommerz/return/fail', $fields['fail_url']);
        $this->assertSame('https://shop.example.com/api/payments/sslcommerz/return/cancel', $fields['cancel_url']);
        $this->assertSame('https://shop.example.com/api/payments/sslcommerz/ipn', $fields['ipn_url']);
        $this->assertSame(['Rahim Uddin', 'guest@example.com', 'House 12, Road 5', 'Dhaka', '1207', 'Bangladesh', '+8801711000000'],
            [$fields['cus_name'], $fields['cus_email'], $fields['cus_add1'], $fields['cus_city'], $fields['cus_postcode'], $fields['cus_country'], $fields['cus_phone']]);
        $this->assertSame(['YES', 'Rahim Uddin', 'Dhaka', 'Bangladesh'], [$fields['shipping_method'], $fields['ship_name'], $fields['ship_city'], $fields['ship_country']]);
        $this->assertSame([$this->lamp->name, 'general', '1', $number], [$fields['product_name'], $fields['product_profile'], (string) $fields['num_of_item'], $fields['value_a']]);

        $order = Order::sole();
        $this->assertSame(['pending_payment', 'unpaid', 'sslcommerz', "{$number}-1", 1, 'BDT'],
            [$order->status, $order->payment_status, $order->payment_provider, $order->payment_session_id, $order->payment_attempts, $order->currency]);
    }

    public function test_sslcommerz_needs_a_phone_number(): void
    {
        $this->fakeSslCommerz();
        $body = $this->checkoutBody([['product_id' => $this->lamp->id, 'quantity' => 1]], ['payment_method' => 'sslcommerz', 'phone' => null]);
        $body['shipping_address']['country'] = 'Bangladesh';

        try {
            app(Checkout::class)->place($body, null);
            $this->fail('An SSLCommerz order without a phone number was placed.');
        } catch (ValidationException $e) {
            $this->assertSame(['phone' => ['SSLCommerz needs a phone number for the payment. Add one to place this order.']], $e->errors());
        }
        $this->assertSame(0, Order::count());
        Http::assertNothingSent();
    }

    public function test_a_gateway_error_leaves_the_order_unpaid_with_pay_now(): void
    {
        $this->fakeSslCommerz();
        $this->sessionAnswer = fn () => Http::response(['status' => 'FAILED', 'failedreason' => 'Store Credential Error Or Store is De-active']);

        $number = $this->sslOrder()->assertCreated()
            ->assertJsonPath('data.status', 'pending_payment')
            ->assertJsonPath('data.payment.url', null)
            ->assertJsonPath('data.payment.error', 'SSLCommerz could not start the payment (Store Credential Error Or Store is De-active). Please try again in a moment.')
            ->json('data.number');
        $this->assertSame(['unpaid', null], [Order::sole()->payment_status, Order::sole()->payment_url]);

        // Pay now tries again: a new attempt.
        $this->sessionAnswer = null;
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.url', 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde1');
        $this->assertSame("{$number}-2", Order::sole()->payment_session_id);

        // SSLCommerz down altogether.
        $this->sessionAnswer = fn () => Http::response('Bad gateway', 502);
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.url', null)
            ->assertJsonPath('data.payment.error', 'SSLCommerz is having trouble right now. Please try again in a moment.');
        $this->assertSame('unpaid', Order::sole()->payment_status);
    }

    // ---- Return trip --------------------------------------------------------------

    public function test_the_return_trip_validates_val_id_and_never_trusts_the_posted_status(): void
    {
        $this->fakeSslCommerz();
        $number = $this->sslOrder()->json('data.number');

        // The browser says VALID, SSLCommerz doesn't know the val_id: nothing is recorded.
        $this->returnTrip('success', "{$number}-1", 'FORGED-VAL')->assertOk()
            ->assertJsonPath('data', ['order_number' => $number, 'result' => 'invalid', 'confirmation' => 'failed']);
        $this->assertSame('unpaid', Order::sole()->payment_status);
        $this->assertSame(0, Invoice::count());
        Http::assertSent(fn (Request $request) => str_contains($request->url(), 'validationserverAPI.php') && str_contains($request->url(), 'val_id=FORGED-VAL'));

        // A real payment: validated, invoiced, emailed.
        $this->validations['VAL-1'] = $this->payment("{$number}-1");
        $this->returnTrip('success', "{$number}-1", 'VAL-1')->assertOk()
            ->assertJsonPath('data', ['order_number' => $number, 'result' => 'paid', 'confirmation' => 'success']);
        $order = Order::sole();
        $this->assertSame(['processing', 'paid', 'sslcommerz', 'BANK-VAL-1'], [$order->status, $order->payment_status, $order->payment_provider, $order->payment_reference]);
        $this->assertSame(['VAL-1', 'BKASH-BKash', '0'], [$order->payment_details['val_id'], $order->payment_details['card_type'], $order->payment_details['risk_level']]);
        $this->assertSame('1250.00', Invoice::sole()->amount);
        $this->assertStringContainsString('Paid with bKash through SSLCommerz.', $order->history->last()->note);
        $this->assertStringContainsString('payment of ৳1,250.00 recorded', $order->history->last()->note);
        Mail::assertSent(InvoiceMail::class, fn ($mail) => $mail->hasTo('guest@example.com') && str_contains($mail->render(), '৳1,250.00'));

        // The order answers show who took it and how.
        $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.provider', 'sslcommerz')->assertJsonPath('data.payment.method_label', 'bKash')
            ->assertJsonPath('data.payment.can_pay', false)->assertJsonMissingPath('data.payment.sslcommerz');
        $this->adminRequest('GET', "/api/admin/v1/orders/{$number}")->assertOk()
            ->assertJsonPath('data.payment.reference', 'BANK-VAL-1')
            ->assertJsonPath('data.payment.sslcommerz.val_id', 'VAL-1')
            ->assertJsonPath('data.payment.sslcommerz.tran_id', "{$number}-1")
            ->assertJsonPath('data.payment.sslcommerz.attempts', 1)
            ->assertJsonPath('data.payment.sslcommerz.can_check', false);

        // The same return trip again (a reload): nothing new, no second call.
        $calls = count(Http::recorded());
        $this->returnTrip('success', "{$number}-1", 'VAL-1')->assertJsonPath('data.result', 'already_paid')->assertJsonPath('data.confirmation', 'success');
        $this->assertCount($calls, Http::recorded());
        $this->assertSame(1, Invoice::count());
    }

    public function test_amount_currency_or_transaction_mismatches_are_refused(): void
    {
        $this->fakeSslCommerz();
        $number = $this->sslOrder()->json('data.number');

        $this->validations['VAL-LOW'] = $this->payment("{$number}-1", 'VAL-LOW', amount: '1254.98');
        $this->returnTrip('success', "{$number}-1", 'VAL-LOW')->assertJsonPath('data.result', 'mismatch')->assertJsonPath('data.confirmation', 'failed');
        $this->validations['VAL-USD'] = $this->payment("{$number}-1", 'VAL-USD', currency: 'USD');
        $this->returnTrip('success', "{$number}-1", 'VAL-USD')->assertJsonPath('data.result', 'mismatch');
        // A payment for another order's transaction (or an attempt that never existed).
        $this->validations['VAL-OTHER'] = $this->payment('BN-999999-1', 'VAL-OTHER');
        $this->returnTrip('success', "{$number}-1", 'VAL-OTHER')->assertJsonPath('data.result', 'mismatch');
        $this->validations['VAL-FUTURE'] = $this->payment("{$number}-7", 'VAL-FUTURE');
        $this->returnTrip('success', "{$number}-1", 'VAL-FUTURE')->assertJsonPath('data.result', 'mismatch');

        $this->assertSame(['unpaid', 0], [Order::sole()->payment_status, Invoice::count()]);
        $this->assertSame('payment_problem', AdminNotification::firstOrFail()->type);
        $this->assertStringContainsString('doesn\'t match the amount due', Order::sole()->history->last()->note);

        // Unknown transactions and malformed requests.
        $this->returnTrip('success', 'BN-999999-1', 'VAL-1')->assertOk()
            ->assertJsonPath('data', ['order_number' => null, 'result' => 'unknown_order', 'confirmation' => 'failed']);
        $this->postJson('/api/v1/payments/sslcommerz/return', ['result' => 'paid', 'tran_id' => 'nope'])->assertStatus(422)
            ->assertJsonValidationErrors(['result', 'tran_id']);
    }

    public function test_a_risky_payment_is_held_for_review_until_staff_invoice_it(): void
    {
        $this->fakeSslCommerz();
        $number = $this->sslOrder()->json('data.number');
        $this->validations['VAL-RISK'] = $this->payment("{$number}-1", 'VAL-RISK', risk: '1', cardType: 'VISA-Dutch Bangla');

        $this->returnTrip('success', "{$number}-1", 'VAL-RISK')->assertJsonPath('data.result', 'review')->assertJsonPath('data.confirmation', 'success');
        $order = Order::sole();
        $this->assertSame(['pending_payment', 'review', 0], [$order->status, $order->payment_status, Invoice::count()]);
        $this->assertSame("Payment on hold for order {$number}", AdminNotification::sole()->title);
        Mail::assertNotSent(InvoiceMail::class);
        $this->adminRequest('GET', '/api/admin/v1/orders?payment_status=review')->assertOk()->assertJsonPath('data.0.number', $number)
            ->assertJsonPath('data.0.payment.method_label', 'Visa card')->assertJsonPath('data.0.payment.sslcommerz.risk_level', '1');
        // The shopper can't pay again or cancel it themselves.
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertStatus(422)
            ->assertJsonPath('errors.order.0', 'This order\'s payment was received and is being checked.');

        // Staff approve it: the invoice.
        $this->adminRequest('PATCH', "/api/admin/v1/orders/{$number}", ['payment_status' => 'paid'])->assertOk()
            ->assertJsonPath('data.payment_status', 'paid')->assertJsonPath('data.status', 'processing');
        $this->assertSame(1, Invoice::count());
    }

    public function test_fail_and_cancel_return_trips(): void
    {
        $this->fakeSslCommerz();
        $number = $this->sslOrder()->json('data.number');

        $this->returnTrip('fail', "{$number}-1", null, 'FAILED')->assertOk()
            ->assertJsonPath('data', ['order_number' => $number, 'result' => 'failed', 'confirmation' => 'failed']);
        $this->returnTrip('cancel', "{$number}-1", null, 'CANCELLED')->assertOk()
            ->assertJsonPath('data', ['order_number' => $number, 'result' => 'cancelled', 'confirmation' => 'cancelled']);
        // Again (a reload): no second note.
        $this->returnTrip('cancel', "{$number}-1", null, 'CANCELLED')->assertOk();

        $order = Order::sole();
        $this->assertSame(['pending_payment', 'unpaid'], [$order->status, $order->payment_status]);
        $notes = $order->history->pluck('note')->all();
        $this->assertCount(1, array_filter($notes, fn ($note) => str_contains((string) $note, 'payment failed')));
        $this->assertCount(1, array_filter($notes, fn ($note) => str_contains((string) $note, 'payment cancelled')));
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), 'validationserverAPI.php'));
        // Pay now still works.
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()->assertJsonPath('data.payment.can_pay', true);
    }

    // ---- IPN ----------------------------------------------------------------------

    public function test_the_ipn_is_validated_idempotent_and_catches_a_missed_return_trip(): void
    {
        $this->fakeSslCommerz();
        $number = $this->sslOrder()->json('data.number');
        $this->validations['VAL-IPN'] = $this->payment("{$number}-1", 'VAL-IPN', cardType: 'NAGAD-Nagad');
        $post = ['tran_id' => "{$number}-1", 'val_id' => 'VAL-IPN', 'status' => 'VALID', 'amount' => '1250.00', 'currency' => 'BDT',
            'verify_key' => 'amount,currency,status,tran_id,val_id'];
        $post['verify_sign'] = SslCommerzGateway::sign($post, 'test-store-password');

        // A wrong signature is refused before anything else.
        $this->ipn([...$post, 'verify_sign' => md5('forged')])->assertStatus(400)->assertJsonPath('message', 'Invalid SSLCommerz notification.');
        $this->ipn(['status' => 'VALID'])->assertStatus(400);
        // SSLCommerz can't be reached to validate it: 503, so it retries.
        $this->validationAnswer = fn () => Http::response('down', 503);
        $this->ipn($post)->assertStatus(503);
        $this->assertSame('unpaid', Order::sole()->payment_status);

        $this->validationAnswer = null;
        $this->ipn($post)->assertOk()->assertJsonPath('received', true)->assertJsonPath('result', 'paid');
        $this->assertSame(['paid', 'Nagad'], [Order::sole()->payment_status, Order::sole()->payment_details['card_type'] === 'NAGAD-Nagad' ? 'Nagad' : null]);
        $this->ipn($post)->assertOk()->assertJsonPath('result', 'duplicate');
        // The shopper's return trip arrives afterwards: already paid.
        $this->returnTrip('success', "{$number}-1", 'VAL-IPN')->assertJsonPath('data.result', 'already_paid')->assertJsonPath('data.confirmation', 'success');
        $this->assertSame(1, Invoice::count());
        Mail::assertSent(InvoiceMail::class, 1);

        // A posted VALID status whose val_id SSLCommerz doesn't vouch for records nothing.
        $other = $this->sslOrder()->json('data.number');
        $this->ipn(['tran_id' => "{$other}-1", 'val_id' => 'NOT-REAL', 'status' => 'VALID'])->assertOk()->assertJsonPath('result', 'invalid');
        // ...also when SSLCommerz's answer carries an empty tran_id, as the real validation API does.
        $this->validations['NOT-REAL-2'] = ['status' => 'INVALID_TRANSACTION', 'tran_id' => '', 'val_id' => 'NOT-REAL-2'];
        $this->ipn(['tran_id' => "{$other}-1", 'val_id' => 'NOT-REAL-2', 'status' => 'VALID'])->assertOk()->assertJsonPath('result', 'invalid');
        // A FAILED IPN only adds a note, once.
        $this->ipn(['tran_id' => "{$other}-1", 'status' => 'FAILED'])->assertOk()->assertJsonPath('result', 'noted');
        $this->ipn(['tran_id' => "{$other}-1", 'status' => 'FAILED'])->assertOk()->assertJsonPath('result', 'duplicate');
        $order = Order::where('number', $other)->first();
        $this->assertSame('unpaid', $order->payment_status);
        $this->assertSame("SSLCommerz reported attempt {$other}-1 as FAILED.", $order->history->last()->note);
    }

    // ---- Expiry, Pay now, Check payment ------------------------------------------------

    public function test_expiry_asks_sslcommerz_before_cancelling(): void
    {
        $this->fakeSslCommerz();
        [$card, $code] = app(GiftCards::class)->create(10000, []);
        $paid = $this->sslOrder()->json('data.number');
        $unpaid = $this->sslOrder(['gift_card_code' => $code])->json('data.number');
        $this->assertSame(3, $this->lamp->fresh()->stock_quantity);
        $this->assertSame('0.00', $card->fresh()->balance);
        $this->transactions["{$paid}-1"] = [$this->payment("{$paid}-1", 'VAL-LATE')];

        $this->travel(2)->hours();
        $this->artisan('buynest:payments:expire-sslcommerz')->expectsOutputToContain('No expired SSLCommerz payments.')->assertSuccessful();

        // SSLCommerz can't be reached: nothing is cancelled, asked again next run.
        $this->travel(61)->minutes();
        $this->queryAnswer = fn () => Http::response('down', 500);
        $this->artisan('buynest:payments:expire-sslcommerz')->expectsOutputToContain('skipped 2')->assertSuccessful();

        $this->queryAnswer = null;
        $this->artisan('buynest:payments:expire-sslcommerz')->expectsOutputToContain('paid 1, cancelled 1')->assertSuccessful();
        $this->assertSame(['processing', 'paid'], [Order::where('number', $paid)->value('status'), Order::where('number', $paid)->value('payment_status')]);
        $cancelled = Order::where('number', $unpaid)->first();
        $this->assertSame(['cancelled', 'unpaid'], [$cancelled->status, $cancelled->payment_status]);
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity); // restocked once
        $this->assertSame('100.00', $card->fresh()->balance); // the gift card got its amount back
        Mail::assertSent(PaymentNotCompletedMail::class, fn ($mail) => $mail->hasTo('guest@example.com') && str_contains($mail->render(), '৳'));
        Http::assertSent(fn (Request $request) => str_contains($request->url(), 'merchantTransIDvalidationAPI.php') && str_contains($request->url(), "tran_id={$unpaid}-1"));

        $this->artisan('buynest:payments:expire-sslcommerz')->expectsOutputToContain('No expired SSLCommerz payments.')->assertSuccessful();
        $this->assertSame(4, $this->lamp->fresh()->stock_quantity);
    }

    public function test_pay_now_and_payment_links_start_new_attempts_and_older_attempts_still_count(): void
    {
        $this->fakeSslCommerz();
        $number = $this->sslOrder()->json('data.number');

        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertOk()
            ->assertJsonPath('data.payment.url', 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde2');
        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/payment-link")->assertOk()
            ->assertJsonPath('data.payment.url', 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde3')
            ->assertJsonPath('data.payment.sslcommerz.attempts', 3);
        $this->assertSame(["{$number}-1", "{$number}-2", "{$number}-3"], array_column($this->sessionRequests(), 'tran_id'));
        $this->assertSame('order.payment_link_created', AuditLog::where('action', 'order.payment_link_created')->value('action'));
        $this->assertTrue(Order::sole()->payment_expires_at->isAfter(now()->addHours(23))); // staff links: 24 hours

        // The shopper paid on the first page after all: accepted; later attempts are then ignored.
        $this->validations['VAL-OLD'] = $this->payment("{$number}-1", 'VAL-OLD');
        $this->returnTrip('success', "{$number}-1", 'VAL-OLD')->assertJsonPath('data.result', 'paid');
        $this->validations['VAL-NEW'] = $this->payment("{$number}-3", 'VAL-NEW');
        $this->returnTrip('success', "{$number}-3", 'VAL-NEW')->assertJsonPath('data.result', 'already_paid');
        $this->assertSame(1, Invoice::count());
        $this->assertSame("Order {$number} was paid again through SSLCommerz", AdminNotification::sole()->title);
        $this->postJson("/api/v1/orders/{$number}/pay", ['email' => 'guest@example.com'])->assertStatus(422)
            ->assertJsonPath('errors.order.0', 'This order has already been paid.');
    }

    public function test_check_payment_records_a_payment_staff_ask_about(): void
    {
        $this->fakeSslCommerz();
        $number = $this->sslOrder()->json('data.number');

        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/payment/check")->assertOk()
            ->assertJsonPath('result', ['found' => false, 'status' => 'not_found', 'message' => 'SSLCommerz has no completed payment for this order (1 attempt checked).'])
            ->assertJsonPath('data.payment_status', 'unpaid');

        $this->transactions["{$number}-1"] = [['status' => 'FAILED', 'tran_id' => "{$number}-1"], $this->payment("{$number}-1", 'VAL-CHK')];
        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/payment/check")->assertOk()
            ->assertJsonPath('result.found', true)->assertJsonPath('result.status', 'paid')
            ->assertJsonPath('result.message', 'Payment found and recorded: ৳1,250.00 (BKASH-BKash). The order was invoiced.')
            ->assertJsonPath('data.payment_status', 'paid')->assertJsonPath('data.payment.method_label', 'bKash');
        $this->assertSame(2, AuditLog::where('action', 'order.payment_checked')->count());

        $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/payment/check")->assertStatus(422)
            ->assertJsonPath('errors.order.0', 'This order has already been paid.');
        $cod = $this->sslOrder(['payment_method' => 'cod'])->json('data.number');
        $this->adminRequest('POST', "/api/admin/v1/orders/{$cod}/payment/check")->assertStatus(422)
            ->assertJsonPath('errors.order.0', 'This order isn\'t paid through SSLCommerz.');
        $this->adminRequest('POST', '/api/admin/v1/orders/BN-1/payment/check')->assertNotFound();
    }

    // ---- Refunds ------------------------------------------------------------------

    public function test_refunds_go_back_through_sslcommerz_first(): void
    {
        $this->fakeSslCommerz();
        $number = $this->sslOrder()->json('data.number');
        $this->validations['VAL-1'] = $this->payment("{$number}-1");
        $this->returnTrip('success', "{$number}-1", 'VAL-1')->assertJsonPath('data.result', 'paid');
        $item = Order::sole()->items->first();
        $memo = fn () => $this->adminRequest('POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $item->id, 'quantity' => 1]], 'shipping_refund' => '0.00', 'adjustment' => '-1000.00',
        ]);

        // Refused: nothing is saved.
        $this->refundAnswer = fn () => Http::response(['APIConnect' => 'DONE', 'status' => 'failed', 'errorReason' => 'Refund amount exceeds the balance']);
        $memo()->assertStatus(422)->assertJsonPath('errors.refund.0', 'SSLCommerz refused the refund: Refund amount exceeds the balance.');
        $this->assertSame(0, CreditMemo::count());

        // Processing counts as accepted, with a note.
        $this->refundAnswer = fn () => Http::response(['APIConnect' => 'DONE', 'status' => 'processing', 'refund_ref_id' => 'RF-PROC']);
        $memo()->assertCreated()->assertJsonPath('data.refund_reference', 'RF-PROC')->assertJsonPath('data.currency', 'BDT')
            ->assertJsonPath('data.total', '250.00');
        $notes = Order::sole()->history->pluck('note')->implode("\n");
        $this->assertStringContainsString('SSLCommerz accepted the refund of ৳250.00 and is still processing it (refund RF-PROC).', $notes);
        $this->assertStringContainsString('৳250.00 refunded through SSLCommerz.', $notes);
        Http::assertSent(fn (Request $request) => str_contains($request->url(), 'refund_amount=250.00') && str_contains($request->url(), 'bank_tran_id=BANK-VAL-1')
            && str_contains($request->url(), 'refe_id='.$number.'-CM1'));

        // Success (another order).
        $this->refundAnswer = null;
        $second = $this->sslOrder()->json('data.number');
        $this->validations['VAL-2'] = $this->payment("{$second}-1", 'VAL-2');
        $this->returnTrip('success', "{$second}-1", 'VAL-2')->assertJsonPath('data.result', 'paid');
        $this->adminRequest('POST', "/api/admin/v1/orders/{$second}/credit-memos", [
            'items' => [['order_item_id' => Order::where('number', $second)->first()->items->first()->id, 'quantity' => 1]],
            'shipping_refund' => '0.00', 'adjustment' => '0.00',
        ])->assertCreated()->assertJsonPath('data.refund_reference', 'RF-1')->assertJsonPath('data.total', '1250.00');
        $this->assertSame('refunded', Order::where('number', $second)->value('payment_status'));
        $this->assertSame(2, CreditMemo::count());
    }
}
