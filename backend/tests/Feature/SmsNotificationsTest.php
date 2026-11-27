<?php

namespace Tests\Feature;

use App\Mail\CodConfirmedMail;
use App\Mail\OrderStatusMail;
use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\Order;
use App\Models\Product;
use App\Models\SmsMessage;
use App\Services\Settings;
use App\Services\Sms\Sms;
use App\Services\Sms\SmsText;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\BangladeshAddresses;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 20: SMS order notifications in a taka store, against stand-ins
 * (Http::fake, no stray requests): off by default, each event once at the
 * right moment, "don't notify" respected, Bangla, segment counting,
 * templates, the providers, the one-tap confirmation link, the admin API,
 * the dev SMS inbox and the retry command.
 *
 * Lamp ৳1,000.00; standard delivery 60 inside Dhaka → total ৳1,060.
 */
class SmsNotificationsTest extends TestCase
{
    use BangladeshAddresses, PlacesOrders, RefreshDatabase;

    private const SSL = 'https://sms-ssl.test';

    private const BULK = 'https://sms-bulk.test/api';

    private const SSLCOMMERZ = 'https://sslcommerz.test';

    private Product $lamp;

    private ?array $headers = null;

    /** @var list<Request> */
    private array $sent = [];

    private ?array $sslAnswer = null;

    private array $validations = [];

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'buynest.store.currency' => 'BDT',
            'buynest.storefront_url' => 'https://shop.example.com',
            'buynest.sms.ssl_wireless' => ['api_token' => 'ssl-token', 'sid' => 'BUYNEST', 'api_url' => self::SSL],
            'buynest.sms.bulksmsbd' => ['api_key' => 'bulk-key', 'sender_id' => '8809601', 'api_url' => self::BULK],
            'buynest.sslcommerz.store_id' => 'buynesttest',
            'buynest.sslcommerz.store_password' => 'test-store-password',
            'buynest.sslcommerz.api_url' => self::SSLCOMMERZ,
        ]);
        app(Settings::class)->put(['free_shipping_threshold' => '100000.00', 'enabled_payment_methods' => ['cod', 'sslcommerz']]);
        $this->zoneRates();
        $this->lamp = $this->product(['price' => '1000.00', 'stock_quantity' => 10, 'name' => 'Desk Lamp']);
        Http::preventStrayRequests();
        Http::fake(fn (Request $request) => $this->answer($request));
    }

    /** The stand-in providers. Anything else is a stray request (an exception). */
    private function answer(Request $request)
    {
        $url = $request->url();
        if (str_starts_with($url, self::SSL) || str_starts_with($url, self::BULK)) {
            $this->sent[] = $request;
        }

        return match (true) {
            $url === self::SSL.'/api/v3/send-sms' => Http::response($this->sslAnswer ?? ['status' => 'SUCCESS', 'status_code' => 200, 'error_message' => '',
                'smsinfo' => [['sms_status' => 'SUCCESS', 'status_message' => 'Success', 'msisdn' => $request['msisdn'], 'csms_id' => $request['csms_id'], 'reference_id' => 'REF-'.$request['csms_id']]]]),
            $url === self::BULK.'/smsapi' => Http::response($request['number'] === '8801999999999'
                ? ['response_code' => 1001, 'error_message' => 'Invalid Number']
                : ['response_code' => 202, 'success_message' => 'SMS Submitted Successfully']),
            str_starts_with($url, self::SSLCOMMERZ.'/gwprocess') => Http::response(['status' => 'SUCCESS', 'sessionkey' => 'S1', 'GatewayPageURL' => 'https://sandbox.sslcommerz.com/pay/1']),
            str_starts_with($url, self::SSLCOMMERZ.'/validator/api/validationserverAPI.php') => Http::response(
                $this->validations[(function () use ($url) {
                    parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

                    return $query['val_id'] ?? '';
                })()] ?? ['status' => 'INVALID_TRANSACTION']),
            default => throw new \RuntimeException("Stray request: {$url}"),
        };
    }

    private function admin(string $method, string $uri, array $body = [])
    {
        $this->headers ??= $this->adminHeaders();

        return $this->asAdmin($this->headers, $method, $uri, $body);
    }

    private function on(array $settings = []): void
    {
        app(Settings::class)->put(['sms_enabled' => true, ...$settings]);
    }

    private function codOrder(array $overrides = [], array $headers = []): string
    {
        $this->app['auth']->forgetGuards();

        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], [
            'payment_method' => 'cod', 'phone' => '01712 345678', 'shipping_address' => $this->bdAddress(), ...$overrides,
        ], $headers)->assertCreated()->json('data.number');
    }

    private function texts(?string $number = null): array
    {
        return SmsMessage::when($number, fn ($q) => $q->whereHas('order', fn ($o) => $o->where('number', $number)))
            ->orderBy('id')->pluck('event')->all();
    }

    private function text(string $number, string $event): SmsMessage
    {
        return SmsMessage::where('event', $event)->whereHas('order', fn ($o) => $o->where('number', $number))->firstOrFail();
    }

    private function tokenOf(string $number): string
    {
        preg_match('#https://shop\.example\.com/c/([A-Za-z0-9_-]+)#', $this->text($number, 'cod_confirm_request')->body, $m);

        return $m[1];
    }

    public function test_off_by_default_nothing_is_sent(): void
    {
        $number = $this->codOrder();
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'shipped'])->assertOk();
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered'])->assertOk();
        $other = $this->codOrder();
        $this->admin('PATCH', "/api/admin/v1/orders/{$other}", ['status' => 'cancelled'])->assertOk();

        $this->assertSame(0, SmsMessage::count());
        $this->assertSame([], $this->sent);
        $this->getJson('/api/v1/store')->assertOk()->assertJsonMissingPath('data.sms_updates');
        $this->assertNull(Order::where('number', $number)->value('sms_confirm_token_hash'));
    }

    public function test_order_placed_once_through_the_log_driver(): void
    {
        $this->on();
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.sms_updates', true);
        $number = $this->codOrder();

        $text = $this->text($number, 'order_placed');
        $this->assertSame("BuyNest: order {$number} received, total Tk 1,060. We'll text you when it ships.", $text->body);
        $this->assertSame(['+8801712345678', 'en', 'gsm', 1, 'log', 'sent', "log-{$text->id}", 1],
            [$text->to, $text->locale, $text->encoding, $text->segments, $text->provider, $text->status, $text->provider_message_id, $text->attempts]);
        $this->assertNotNull($text->sent_at);

        // Once per order and event.
        app(Sms::class)->placed(Order::where('number', $number)->first());
        $this->assertSame(['order_placed'], $this->texts());
        $this->assertSame([], $this->sent);
    }

    public function test_a_number_that_is_not_a_bangladeshi_mobile_is_skipped(): void
    {
        $this->on();
        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['phone' => '+15550100100'])->assertCreated();
        $this->assertSame(0, SmsMessage::count());
    }

    public function test_an_order_waiting_for_an_online_payment_is_texted_when_paid(): void
    {
        $this->on();
        $this->app['auth']->forgetGuards();
        $number = $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], [
            'payment_method' => 'sslcommerz', 'phone' => '01712345678', 'shipping_address' => $this->bdAddress(),
        ])->assertCreated()->assertJsonPath('data.status', 'pending_payment')->json('data.number');
        $this->assertSame([], $this->texts());

        $this->validations["VAL-{$number}-1"] = ['status' => 'VALID', 'tran_id' => "{$number}-1", 'val_id' => "VAL-{$number}-1", 'amount' => '1060.00',
            'currency' => 'BDT', 'currency_type' => 'BDT', 'bank_tran_id' => "BANK-{$number}", 'card_type' => 'BKASH-BKash', 'risk_level' => '0'];
        $this->postJson('/api/v1/payments/sslcommerz/return', ['result' => 'success', 'tran_id' => "{$number}-1", 'val_id' => "VAL-{$number}-1"])
            ->assertJsonPath('data.result', 'paid');
        $this->assertSame(['order_placed'], $this->texts($number));
    }

    public function test_shipped_delivered_and_cancelled_follow_the_notify_choice(): void
    {
        $this->on();
        // Not notified: no text.
        $quiet = $this->codOrder();
        $this->admin('POST', "/api/admin/v1/orders/{$quiet}/shipments", ['carrier' => 'steadfast', 'tracking_number' => 'SF1', 'notify_customer' => false])->assertCreated();
        $this->admin('PATCH', "/api/admin/v1/orders/{$quiet}", ['status' => 'delivered', 'notify_customer' => false])->assertOk();
        $this->assertSame(['order_placed'], $this->texts($quiet));

        $number = $this->codOrder();
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'steadfast', 'tracking_number' => 'SF2X'])->assertCreated();
        $this->assertSame("BuyNest: order {$number} is on its way with Steadfast. Track: https://steadfast.com.bd/t/SF2X", $this->text($number, 'order_shipped')->body);
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered'])->assertOk();
        // A note on the delivered order texts nothing more.
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['note' => 'Customer happy.'])->assertOk();
        $this->assertSame(['order_placed', 'order_shipped', 'order_delivered'], $this->texts($number));
        $this->assertSame("BuyNest: order {$number} was delivered. Thank you for shopping with us!", $this->text($number, 'order_delivered')->body);

        // No tracking: the "Track:" sentence is left out.
        $plain = $this->codOrder();
        $this->admin('PATCH', "/api/admin/v1/orders/{$plain}", ['status' => 'shipped'])->assertOk();
        $this->assertSame("BuyNest: order {$plain} is on its way with Other.", $this->text($plain, 'order_shipped')->body);

        $cancelQuiet = $this->codOrder();
        $this->admin('PATCH', "/api/admin/v1/orders/{$cancelQuiet}", ['status' => 'cancelled', 'notify_customer' => false])->assertOk();
        $this->assertSame(['order_placed'], $this->texts($cancelQuiet));
        $cancelled = $this->codOrder();
        $this->admin('PATCH', "/api/admin/v1/orders/{$cancelled}", ['status' => 'cancelled'])->assertOk();
        $this->assertSame(['order_placed', 'order_cancelled'], $this->texts($cancelled));

        // The customer's own cancel texts too.
        $own = $this->codOrder();
        $this->postJson("/api/v1/orders/{$own}/cancel", ['email' => 'guest@example.com'])->assertOk();
        $this->assertSame(['order_placed', 'order_cancelled'], $this->texts($own));
        $this->assertSame([], $this->sent);
    }

    public function test_events_can_be_switched_off_one_by_one(): void
    {
        $this->on(['sms_events' => ['order_shipped']]);
        $number = $this->codOrder();
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'shipped'])->assertOk();
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered'])->assertOk();
        $this->assertSame(['order_shipped'], $this->texts($number));
    }

    public function test_a_bangla_customer_gets_bangla_with_bangla_digits(): void
    {
        $this->on();
        $number = $this->codOrder([], ['Accept-Language' => 'bn']);
        $text = $this->text($number, 'order_placed');
        $this->assertSame("BuyNest: আপনার অর্ডার {$number} পেয়েছি, মোট ৳১,০৬০। পাঠানোর সময় আমরা SMS করে জানাব।", $text->body);
        $this->assertSame(['bn', 'unicode', 2], [$text->locale, $text->encoding, $text->segments]);

        app(Settings::class)->put(['bangla_digits' => false]);
        $other = $this->codOrder([], ['Accept-Language' => 'bn']);
        $this->assertStringContainsString('মোট ৳1,060।', $this->text($other, 'order_placed')->body);
    }

    public function test_segment_counting(): void
    {
        $this->assertSame(['encoding' => 'gsm', 'segments' => 1, 'length' => 160], SmsText::measure(str_repeat('a', 160)));
        $this->assertSame(['encoding' => 'gsm', 'segments' => 2, 'length' => 161], SmsText::measure(str_repeat('a', 161)));
        $this->assertSame(['encoding' => 'gsm', 'segments' => 3, 'length' => 307], SmsText::measure(str_repeat('a', 306).'b'));
        // An extension character takes two places.
        $this->assertSame(['encoding' => 'gsm', 'segments' => 1, 'length' => 4], SmsText::measure('€ 5'));
        $this->assertSame(['encoding' => 'unicode', 'segments' => 1, 'length' => 70], SmsText::measure(str_repeat('ক', 70)));
        $this->assertSame(['encoding' => 'unicode', 'segments' => 2, 'length' => 71], SmsText::measure(str_repeat('ক', 71)));
        $this->assertSame(['encoding' => 'unicode', 'segments' => 3, 'length' => 135], SmsText::measure(str_repeat('a', 134).'৳'));
    }

    public function test_templates_and_variables(): void
    {
        $this->assertSame('Hi Rahim, order BN-1.', Sms::render('Hi {name}, order {order}{nope}.', ['name' => 'Rahim', 'order' => 'BN-1']));
        $this->assertSame('Shipped with Pathao.', Sms::render('Shipped with {courier}. Track: {tracking_url}', ['courier' => 'Pathao', 'tracking_url' => null]));
        $this->assertSame('পাঠানো হয়েছে।', Sms::render('পাঠানো হয়েছে। ট্র্যাক করুন: {tracking_url}', []));
        $this->assertSame('Please confirm BN-1', Sms::render('Please confirm {order}: {confirm_url}', ['order' => 'BN-1']));

        $this->on(['sms_templates' => ['order_placed' => ['en' => 'Hi {name}, {store} got {order} ({total}). {order_url}']]]);
        $number = $this->codOrder();
        $this->assertSame("Hi Rahim, BuyNest got {$number} (Tk 1,060). https://shop.example.com/track-order?order={$number}", $this->text($number, 'order_placed')->body);
    }

    public function test_ssl_wireless_request_success_error_and_retry(): void
    {
        $this->on(['sms_provider' => 'ssl_wireless']);
        $number = $this->codOrder();
        $text = $this->text($number, 'order_placed');
        $this->assertSame(['sent', 'ssl_wireless', "REF-{$text->id}"], [$text->status, $text->provider, $text->provider_message_id]);
        $this->assertCount(1, $this->sent);
        $request = $this->sent[0];
        $this->assertSame('POST', $request->method());
        $this->assertSame(['api_token' => 'ssl-token', 'sid' => 'BUYNEST', 'msisdn' => '8801712345678', 'sms' => $text->body, 'csms_id' => (string) $text->id], $request->data());

        $this->sslAnswer = ['status' => 'FAILED', 'status_code' => 4003, 'error_message' => 'Invalid SID', 'smsinfo' => []];
        $failed = $this->text($this->codOrder(), 'order_placed');
        $this->assertSame(['failed', 'SSL Wireless refused the text: Invalid SID', 1], [$failed->status, $failed->error, $failed->attempts]);

        // The command retries it (dry run first), with a new reference.
        $this->sslAnswer = null;
        $this->artisan('buynest:sms:retry --dry-run')->expectsOutputToContain('Would retry 1 texts.')->assertSuccessful();
        $this->assertSame('failed', $failed->fresh()->status);
        $this->artisan('buynest:sms:retry')->expectsOutputToContain('1 sent')->assertSuccessful();
        $this->assertSame(['sent', 2, null], [$failed->fresh()->status, $failed->fresh()->attempts, $failed->fresh()->error]);
        $this->assertSame("{$failed->id}-2", end($this->sent)['csms_id']);
    }

    public function test_bulksmsbd_request_and_error(): void
    {
        $this->on(['sms_provider' => 'bulksmsbd']);
        $number = $this->codOrder([], ['Accept-Language' => 'bn']);
        $this->assertSame('sent', $this->text($number, 'order_placed')->status);
        $data = $this->sent[0]->data();
        $this->assertSame(['bulk-key', 'unicode', '8801712345678', '8809601'], [$data['api_key'], $data['type'], $data['number'], $data['senderid']]);
        $this->assertSame(self::BULK.'/smsapi', $this->sent[0]->url());

        $failed = $this->text($this->codOrder(['phone' => '01999999999']), 'order_placed');
        $this->assertSame(['failed', 'BulkSMSBD refused the text: Invalid Number'], [$failed->status, $failed->error]);
        $this->assertSame('text', $this->admin('POST', '/api/admin/v1/sms/test', ['to' => '01812345678'])->assertCreated()
            ->assertJsonPath('data.status', 'sent') ? end($this->sent)->data()['type'] : null);
    }

    public function test_a_provider_that_cannot_be_reached_leaves_a_failed_row_and_never_blocks_the_order(): void
    {
        $this->on(['sms_provider' => 'ssl_wireless']);
        Http::fake([self::SSL.'/*' => fn () => throw new ConnectionException('down')]);
        $number = $this->codOrder();
        $this->assertSame('processing', Order::where('number', $number)->value('status'));
        $this->assertSame(['failed', 'SSL Wireless could not be reached. Please try again in a moment.'],
            [$this->text($number, 'order_placed')->status, $this->text($number, 'order_placed')->error]);
    }

    public function test_settings_api_validation_and_providers(): void
    {
        $this->admin('GET', '/api/admin/v1/sms')->assertOk()
            ->assertJsonPath('data.settings.sms_enabled', false)
            ->assertJsonPath('data.settings.sms_provider', 'log')
            ->assertJsonPath('data.settings.sms_events', Sms::EVENTS)
            ->assertJsonPath('data.settings.sms_templates.order_placed', ['en' => null, 'bn' => null])
            ->assertJsonPath('data.settings.sms_confirm_link', true)
            ->assertJsonPath('data.providers', [['key' => 'log', 'label' => 'Test mode (log only)', 'configured' => true],
                ['key' => 'ssl_wireless', 'label' => 'SSL Wireless', 'configured' => true], ['key' => 'bulksmsbd', 'label' => 'BulkSMSBD', 'configured' => true]])
            ->assertJsonPath('data.stats', ['sent_today' => 0, 'failed_today' => 0, 'sent_30d' => 0])
            ->assertJsonPath('data.defaults.templates.order_placed.en', Sms::DEFAULT_TEMPLATES['order_placed']['en'])
            ->assertJsonMissing(['api_token' => 'ssl-token']);

        config(['buynest.sms.bulksmsbd.api_key' => null]);
        $this->admin('PUT', '/api/admin/v1/sms/settings', ['sms_provider' => 'bulksmsbd'])->assertUnprocessable()->assertJsonValidationErrors('sms_provider');
        $this->admin('PUT', '/api/admin/v1/sms/settings', ['sms_enabled' => true, 'sms_events' => []])->assertUnprocessable()->assertJsonValidationErrors('sms_events');
        $this->admin('PUT', '/api/admin/v1/sms/settings', ['sms_templates' => ['order_placed' => ['en' => str_repeat('a', 481)], 'nope' => ['en' => 'x']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['sms_templates.order_placed.en']);
        $this->admin('PUT', '/api/admin/v1/sms/settings', ['sms_templates' => ['nope' => ['en' => 'x']]])->assertUnprocessable()->assertJsonValidationErrors('sms_templates.nope');

        $this->admin('PUT', '/api/admin/v1/sms/settings', ['sms_enabled' => true, 'sms_provider' => 'ssl_wireless', 'sms_events' => ['order_shipped', 'order_placed'],
            'sms_templates' => ['order_placed' => ['bn' => '{store}: অর্ডার {order}']], 'sms_confirm_link' => false])->assertOk()
            ->assertJsonPath('data.settings.sms_enabled', true)
            ->assertJsonPath('data.settings.sms_events', ['order_placed', 'order_shipped'])
            ->assertJsonPath('data.settings.sms_templates.order_placed', ['en' => null, 'bn' => '{store}: অর্ডার {order}'])
            ->assertJsonPath('data.settings.sms_confirm_link', false);
        // Partial: only what was sent changes; an empty text goes back to the default.
        $this->admin('PUT', '/api/admin/v1/sms/settings', ['sms_templates' => ['order_placed' => ['bn' => '']]])->assertOk()
            ->assertJsonPath('data.settings.sms_templates.order_placed', ['en' => null, 'bn' => null])
            ->assertJsonPath('data.settings.sms_provider', 'ssl_wireless');
        $this->assertTrue(AuditLog::where('action', 'settings.updated')->where('summary', 'like', 'SMS settings changed:%')->exists());
    }

    public function test_test_send_log_filters_and_retry(): void
    {
        $this->admin('POST', '/api/admin/v1/sms/test', ['to' => '12345'])->assertUnprocessable()->assertJsonValidationErrors('to');
        $this->admin('POST', '/api/admin/v1/sms/test', ['to' => '+880 1812-345678', 'body' => 'Hello'])->assertCreated()
            ->assertJsonPath('data.to', '+8801812345678')->assertJsonPath('data.event', null)->assertJsonPath('data.status', 'sent')
            ->assertJsonPath('data.provider', 'log')->assertJsonPath('data.body', 'Hello')->assertJsonPath('data.order', null);
        $this->assertTrue(AuditLog::where('action', 'sms.test_sent')->exists());

        $this->on(['sms_provider' => 'ssl_wireless']);
        $this->sslAnswer = ['status' => 'FAILED', 'error_message' => 'Low balance'];
        $number = $this->codOrder();
        $failed = $this->text($number, 'order_placed');

        $this->admin('GET', '/api/admin/v1/sms/messages?status=failed')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.order', ['number' => $number])->assertJsonPath('data.0.error', 'SSL Wireless refused the text: Low balance');
        $this->admin('GET', '/api/admin/v1/sms/messages?event=test')->assertOk()->assertJsonCount(1, 'data');
        $this->admin('GET', '/api/admin/v1/sms/messages?search=01712345678')->assertOk()->assertJsonCount(1, 'data');
        $this->admin('GET', '/api/admin/v1/sms/messages?search='.strtolower($number))->assertOk()->assertJsonCount(1, 'data');
        $this->admin('GET', '/api/admin/v1/sms/messages?status=nope')->assertUnprocessable();
        $this->admin('GET', "/api/admin/v1/orders/{$number}")->assertOk()
            ->assertJsonPath('data.sms.0', ['id' => $failed->id, 'event' => 'order_placed', 'status' => 'failed', 'to' => '+8801712345678',
                'sent_at' => null, 'error' => 'SSL Wireless refused the text: Low balance']);

        $this->sslAnswer = null;
        $this->admin('POST', "/api/admin/v1/sms/messages/{$failed->id}/retry")->assertOk()->assertJsonPath('data.status', 'sent')->assertJsonPath('data.attempts', 2);
        $this->admin('POST', "/api/admin/v1/sms/messages/{$failed->id}/retry")->assertUnprocessable();
        $this->admin('POST', '/api/admin/v1/sms/messages/999999/retry')->assertNotFound();
        $failed->refresh()->forceFill(['status' => 'failed', 'attempts' => 5])->save();
        $this->admin('POST', "/api/admin/v1/sms/messages/{$failed->id}/retry")->assertUnprocessable();
        $this->admin('GET', '/api/admin/v1/sms')->assertOk()->assertJsonPath('data.stats.sent_today', 1)->assertJsonPath('data.stats.failed_today', 1);
    }

    public function test_permissions(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role(['orders.view'])->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/sms/messages')->assertOk();
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/sms')->assertForbidden()->assertJsonPath('permission', 'settings.view');
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/sms/messages/1/retry')->assertForbidden()->assertJsonPath('permission', 'orders.edit');
        $settings = $this->signInAdmin(Admin::factory()->role(['settings.view'])->create());
        $this->asAdmin($settings, 'GET', '/api/admin/v1/sms')->assertOk();
        $this->asAdmin($settings, 'PUT', '/api/admin/v1/sms/settings', ['sms_enabled' => true])->assertForbidden();
        $this->asAdmin($settings, 'POST', '/api/admin/v1/sms/test', ['to' => '01712345678'])->assertForbidden();
        $this->asAdmin($settings, 'GET', '/api/admin/v1/sms/messages')->assertForbidden();
        $this->assertSame(0, SmsMessage::count());
    }

    public function test_confirmation_link_get_changes_nothing_then_confirm(): void
    {
        app(Settings::class)->put(['cod_require_confirmation' => true]);
        $this->on();
        $number = $this->codOrder();
        $this->assertSame(['cod_confirm_request'], $this->texts($number));
        $token = $this->tokenOf($number);
        $this->assertSame("BuyNest: please confirm your order {$number} (Tk 1,060, cash on delivery): https://shop.example.com/c/{$token}",
            $this->text($number, 'cod_confirm_request')->body);
        $this->assertSame(hash('sha256', $token), Order::where('number', $number)->value('sms_confirm_token_hash'));

        $summary = ['number' => $number, 'total' => '1060.00', 'items_count' => 1, 'placed_at' => Order::where('number', $number)->first()->placed_at->toIso8601ZuluString()];
        $this->getJson("/api/v1/order-confirmations/{$token}")->assertOk()->assertExactJson(['data' => [...$summary, 'status' => 'pending']]);
        $this->getJson("/api/v1/order-confirmations/{$token}")->assertOk();
        $order = Order::where('number', $number)->first();
        $this->assertSame(['pending', 0], [$order->confirmation_status, $order->confirmation_attempts]);

        $this->postJson("/api/v1/order-confirmations/{$token}", ['action' => 'nope'])->assertUnprocessable()->assertJsonValidationErrors('action');
        $this->postJson("/api/v1/order-confirmations/{$token}", ['action' => 'confirm'])->assertOk()->assertExactJson(['data' => [...$summary, 'status' => 'confirmed']]);
        $order->refresh();
        $this->assertSame('confirmed', $order->confirmation_status);
        $this->assertSame(['confirmed', null, 'Confirmed by the customer from the SMS link.'],
            [$order->confirmationLogs()->first()->outcome, $order->confirmationLogs()->first()->admin_id, $order->confirmationLogs()->first()->note]);
        $this->assertSame('Customer (SMS link)', $order->history()->reorder()->latest('id')->first()->actor);
        Mail::assertSent(CodConfirmedMail::class, 1);
        $this->assertSame(['cod_confirm_request', 'order_confirmed'], $this->texts($number));
        $this->assertTrue(AuditLog::where('action', 'order.confirmation')->whereNull('admin_id')->exists());

        // Single purpose: it shows the result and can't be used again.
        $this->postJson("/api/v1/order-confirmations/{$token}", ['action' => 'cancel'])->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->getJson("/api/v1/order-confirmations/{$token}")->assertOk()->assertJsonPath('data.status', 'confirmed');
        $this->assertSame('processing', $order->fresh()->status);
    }

    public function test_confirmation_link_cancel_restocks_emails_and_texts(): void
    {
        app(Settings::class)->put(['cod_require_confirmation' => true]);
        $this->on();
        $number = $this->codOrder();
        $this->assertSame(9, $this->lamp->refresh()->stock_quantity);

        $this->postJson("/api/v1/order-confirmations/{$this->tokenOf($number)}", ['action' => 'cancel', 'reason' => 'Ordered twice'])->assertOk()
            ->assertJsonPath('data.status', 'cancelled');
        $order = Order::where('number', $number)->first();
        $this->assertSame(['cancelled', 'cancelled'], [$order->status, $order->confirmation_status]);
        $this->assertSame(10, $this->lamp->refresh()->stock_quantity);
        $this->assertSame('Cancelled by the customer from the SMS link: Ordered twice', $order->history()->reorder()->latest('id')->first()->note);
        $this->assertSame('Customer (SMS link)', $order->history()->reorder()->latest('id')->first()->actor);
        Mail::assertSent(OrderStatusMail::class, 1);
        $this->assertSame(['cod_confirm_request', 'order_cancelled'], $this->texts($number));
    }

    public function test_staff_phone_confirmation_texts_unless_told_not_to(): void
    {
        app(Settings::class)->put(['cod_require_confirmation' => true]);
        $this->on();
        $number = $this->codOrder();
        $this->admin('POST', "/api/admin/v1/orders/{$number}/confirmation", ['outcome' => 'confirmed'])->assertOk();
        $this->assertSame(['cod_confirm_request', 'order_confirmed'], $this->texts($number));
        $this->getJson("/api/v1/order-confirmations/{$this->tokenOf($number)}")->assertOk()->assertJsonPath('data.status', 'confirmed');

        $quiet = $this->codOrder();
        $this->admin('POST', "/api/admin/v1/orders/{$quiet}/confirmation", ['outcome' => 'confirmed', 'notify_customer' => false])->assertOk();
        $this->assertSame(['cod_confirm_request'], $this->texts($quiet));
    }

    public function test_confirmation_link_after_shipping_expiry_and_unknown_tokens(): void
    {
        app(Settings::class)->put(['cod_require_confirmation' => true]);
        $this->on();
        $shipped = $this->codOrder();
        $this->admin('PATCH', "/api/admin/v1/orders/{$shipped}", ['status' => 'shipped', 'confirmation_override' => 'Customer called us'])->assertOk();
        $token = $this->tokenOf($shipped);
        $this->getJson("/api/v1/order-confirmations/{$token}")->assertOk()->assertJsonPath('data.status', 'not_waiting');
        $this->postJson("/api/v1/order-confirmations/{$token}", ['action' => 'cancel'])->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->assertSame('shipped', Order::where('number', $shipped)->value('status'));

        $late = $this->codOrder();
        $token = $this->tokenOf($late);
        $this->travel(73)->hours();
        $this->getJson("/api/v1/order-confirmations/{$token}")->assertOk()->assertJsonPath('data.status', 'expired');
        $this->postJson("/api/v1/order-confirmations/{$token}", ['action' => 'confirm'])->assertNotFound()->assertJsonStructure(['message']);
        $this->assertSame('pending', Order::where('number', $late)->value('confirmation_status'));

        $this->getJson('/api/v1/order-confirmations/'.str_repeat('x', 43))->assertNotFound()->assertJsonStructure(['message']);
        $this->postJson('/api/v1/order-confirmations/short', ['action' => 'confirm'])->assertNotFound();
        $this->getJson('/api/v1/order-confirmations/'.str_repeat('x', 43), ['Accept-Language' => 'bn'])->assertNotFound()
            ->assertJsonPath('message', 'এই নিশ্চিতকরণ লিংকটি সঠিক নয়। অনুগ্রহ করে আপনার SMS-এর লিংকটি দেখুন।');
    }

    public function test_without_the_link_setting_the_request_has_no_link(): void
    {
        app(Settings::class)->put(['cod_require_confirmation' => true]);
        $this->on(['sms_confirm_link' => false]);
        $number = $this->codOrder();
        $this->assertSame("BuyNest: please confirm your order {$number} (Tk 1,060, cash on delivery)", $this->text($number, 'cod_confirm_request')->body);
        $this->assertNull(Order::where('number', $number)->value('sms_confirm_token_hash'));
    }

    public function test_confirmation_link_is_throttled(): void
    {
        for ($i = 0; $i < 20; $i++) {
            $this->getJson('/api/v1/order-confirmations/'.str_repeat('y', 43))->assertNotFound();
        }
        $this->getJson('/api/v1/order-confirmations/'.str_repeat('y', 43))->assertTooManyRequests();
    }

    public function test_dev_sms_inbox_only_in_local_and_testing(): void
    {
        $this->on();
        $this->codOrder();
        $this->get('/dev/sms')->assertOk()->assertSee('+8801712345678')->assertSee('order_placed');
        $this->getJson('/dev/sms/latest?to=01712345678')->assertOk()->assertJsonPath('data.event', 'order_placed')->assertJsonPath('data.status', 'sent');
        $this->getJson('/dev/sms/latest?to=01812345678')->assertNotFound();

        $this->app['env'] = 'production';
        $this->get('/dev/sms')->assertNotFound();
        $this->getJson('/dev/sms/latest?to=01712345678')->assertNotFound();
    }

    public function test_old_rows_are_pruned(): void
    {
        $row = fn (string $provider, int $days) => SmsMessage::create(['to' => '+8801712345678', 'body' => 'x', 'locale' => 'en', 'segments' => 1,
            'encoding' => 'gsm', 'provider' => $provider, 'status' => 'sent', 'created_at' => now()->subDays($days)]);
        $keepLog = $row('log', 10);
        $row('log', 91);
        $keepReal = $row('ssl_wireless', 200);
        $row('ssl_wireless', 400);
        $this->artisan('model:prune', ['--model' => [SmsMessage::class]])->assertSuccessful();
        $this->assertSame([$keepLog->id, $keepReal->id], SmsMessage::orderBy('id')->pluck('id')->all());
    }
}
