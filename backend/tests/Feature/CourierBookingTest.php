<?php

namespace Tests\Feature;

use App\Mail\OrderStatusMail;
use App\Mail\ShipmentMail;
use App\Models\Admin;
use App\Models\AdminNotification;
use App\Models\AuditLog;
use App\Models\BdArea;
use App\Models\Order;
use App\Models\Product;
use App\Models\Shipment;
use App\Services\Couriers\PathaoGateway;
use App\Services\Couriers\SteadfastGateway;
use App\Services\OrderDocuments;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Concerns\BangladeshAddresses;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 18: courier bookings with Steadfast and Pathao, against stand-ins
 * (Http::fake, no stray requests): booking, its rules, the webhooks, status
 * updates (delivered COD → delivered, invoiced, paid), sync, bulk booking,
 * what customers see, and permissions.
 *
 * Lamp ৳1,000.00 (1.5 kg); standard delivery 60 inside Dhaka → COD due ৳1,060.00.
 */
class CourierBookingTest extends TestCase
{
    use BangladeshAddresses, PlacesOrders, RefreshDatabase;

    private const STEADFAST = 'https://steadfast.test/api/v1';

    private const PATHAO = 'https://pathao.test';

    private Product $lamp;

    private ?array $headers = null;

    /** @var list<Request> */
    private array $sent = [];

    /** Next Steadfast create_order answer (null: success). */
    private ?array $steadfastBooking = null;

    /** consignment id => Steadfast status_by_cid answer. */
    private array $steadfastStatus = [];

    private int $steadfastHttpStatus = 200;

    private int $pathaoTokens = 0;

    private int $pathao401 = 0;

    private bool $pathaoDown = false;

    private string $pathaoStatus = 'Pending';

    private int $consignments = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'buynest.store.currency' => 'BDT',
            'buynest.couriers.steadfast' => ['api_key' => 'sf-key', 'secret_key' => 'sf-secret', 'api_url' => self::STEADFAST, 'webhook_token' => 'sf-hook'],
            'buynest.couriers.pathao' => ['client_id' => 'pt-client', 'client_secret' => 'pt-secret', 'username' => 'shop@example.com', 'password' => 'pt-pass',
                'store_id' => '777', 'mode' => 'sandbox', 'api_url' => self::PATHAO, 'webhook_secret' => 'pt-hook'],
        ]);
        app(Settings::class)->put(['free_shipping_threshold' => '100000.00', 'enabled_payment_methods' => ['cod']]);
        $this->zoneRates();
        $this->lamp = $this->product(['price' => '1000.00', 'stock_quantity' => 50, 'name' => 'Desk Lamp', 'weight' => 1500]);
        Http::preventStrayRequests();
        Http::fake(fn (Request $request) => $this->answer($request));
    }

    /** The stand-in couriers. Anything else is a stray request (an exception). */
    private function answer(Request $request)
    {
        $this->sent[] = $request;
        $url = $request->url();
        if (str_starts_with($url, self::STEADFAST)) {
            $path = substr(parse_url($url, PHP_URL_PATH), strlen('/api/v1'));
            if ($this->steadfastHttpStatus >= 500) {
                return Http::response('down', $this->steadfastHttpStatus);
            }

            return match (true) {
                $path === '/create_order' => Http::response($this->steadfastBooking ?? ['status' => 200, 'message' => 'Consignment has been created successfully.',
                    'consignment' => ['consignment_id' => 5000 + (++$this->consignments), 'invoice' => $request['invoice'], 'tracking_code' => 'SF'.$this->consignments.'X',
                        'status' => 'in_review']], $this->steadfastBooking ? 422 : 200),
                str_starts_with($path, '/status_by_cid/') => Http::response($this->steadfastStatus[substr($path, 15)] ?? ['status' => 200, 'delivery_status' => 'in_review']),
                $path === '/get_balance' => Http::response(['status' => 200, 'current_balance' => 12500.5]),
                default => Http::response(['status' => 404], 404),
            };
        }
        if (str_starts_with($url, self::PATHAO)) {
            $path = parse_url($url, PHP_URL_PATH);
            if ($this->pathaoDown) {
                return Http::response('down', 503);
            }
            if ($path === '/aladdin/api/v1/issue-token') {
                $this->pathaoTokens++;

                return Http::response(['token_type' => 'Bearer', 'expires_in' => 432000, 'access_token' => "tok-{$this->pathaoTokens}", 'refresh_token' => 'r']);
            }
            if ($this->pathao401 > 0) {
                $this->pathao401--;

                return Http::response(['message' => 'Unauthenticated.'], 401);
            }
            $list = fn (array $rows) => Http::response(['code' => 200, 'type' => 'success', 'data' => ['data' => $rows]]);

            return match (true) {
                $path === '/aladdin/api/v1/city-list' => $list([['city_id' => 1, 'city_name' => 'Dhaka'], ['city_id' => 2, 'city_name' => 'Chattogram']]),
                $path === '/aladdin/api/v1/cities/1/zone-list' => $list([['zone_id' => 10, 'zone_name' => 'Dhanmondi'], ['zone_id' => 11, 'zone_name' => 'Gulshan']]),
                $path === '/aladdin/api/v1/cities/2/zone-list' => $list([['zone_id' => 20, 'zone_name' => 'Agrabad']]),
                $path === '/aladdin/api/v1/zones/10/area-list' => $list([['area_id' => 100, 'area_name' => 'Road 5', 'home_delivery_available' => true, 'pickup_available' => false]]),
                $path === '/aladdin/api/v1/orders' && blank($request['recipient_area'] ?? null) && ($request['recipient_zone'] ?? null) === 11 => Http::response(['code' => 422, 'type' => 'error', 'message' => 'Please fix the given errors', 'errors' => ['recipient_zone' => ['The selected zone does not serve this area.']]], 422),
                $path === '/aladdin/api/v1/orders' => Http::response(['code' => 200, 'type' => 'success', 'data' => ['consignment_id' => 'DL'.(++$this->consignments).'PT',
                    'merchant_order_id' => $request['merchant_order_id'], 'order_status' => 'Pending', 'delivery_fee' => 60]]),
                (bool) preg_match('#^/aladdin/api/v1/orders/([^/]+)/info$#', $path, $m) => Http::response(['code' => 200, 'data' => ['consignment_id' => $m[1],
                    'order_status' => $this->pathaoStatus, 'order_status_slug' => $this->pathaoStatus]]),
                default => Http::response(['code' => 404], 404),
            };
        }

        return null;
    }

    private function admin(string $method, string $uri, array $body = [])
    {
        $this->headers ??= $this->adminHeaders();

        return $this->asAdmin($this->headers, $method, $uri, $body);
    }

    private function codOrder(array $overrides = [], ?BdArea $area = null): Order
    {
        $number = $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], [
            'payment_method' => 'cod', 'phone' => '01712 345678', 'email' => 'rahim@example.com', 'shipping_address' => $this->bdAddress($area), ...$overrides,
        ])->assertCreated()->json('data.number');

        return Order::where('number', $number)->firstOrFail();
    }

    private function book(Order $order, array $body = ['courier' => 'steadfast'])
    {
        return $this->admin('POST', "/api/admin/v1/orders/{$order->number}/courier-booking", $body);
    }

    /** The requests sent to $path (a suffix of the URL). @return list<Request> */
    private function sentTo(string $path, ?string $method = null): array
    {
        return array_values(array_filter($this->sent, fn (Request $r) => str_ends_with(parse_url($r->url(), PHP_URL_PATH), $path)
            && ($method === null || $r->method() === $method)));
    }

    private function steadfastHook(array $payload, ?string $token = 'sf-hook')
    {
        return $this->postJson('/api/v1/couriers/steadfast/webhook', $payload, $token === null ? [] : ['Authorization' => "Bearer {$token}"]);
    }

    private function pathaoHook(array $payload, ?string $secret = 'pt-hook')
    {
        return $this->postJson('/api/v1/couriers/pathao/webhook', $payload, $secret === null ? [] : ['X-PATHAO-Signature' => $secret]);
    }

    public function test_couriers_not_set_up(): void
    {
        config(['buynest.couriers.steadfast' => ['api_url' => self::STEADFAST], 'buynest.couriers.pathao' => ['api_url' => self::PATHAO, 'mode' => 'sandbox']]);
        $this->admin('GET', '/api/admin/v1/couriers')->assertOk()
            ->assertJsonPath('data.0', ['key' => 'steadfast', 'label' => 'Steadfast', 'configured' => false, 'mode' => null, 'balance' => null,
                'webhook_url' => url('/api/v1/couriers/steadfast/webhook')])
            ->assertJsonPath('data.1.configured', false)->assertJsonPath('data.1.mode', 'sandbox')
            ->assertJsonPath('settings.courier_auto_sync', true)->assertJsonPath('settings.courier_default', null);
        $order = $this->codOrder();
        $this->book($order)->assertUnprocessable()->assertJsonPath('errors.courier.0', 'Set up Steadfast first (Settings → Couriers).');
        $this->admin('GET', '/api/admin/v1/couriers/pathao/cities')->assertUnprocessable()->assertJsonPath('errors.courier.0', 'Set up Pathao first (Settings → Couriers).');
        $this->admin('GET', "/api/admin/v1/orders/{$order->number}/courier-booking")->assertOk()->assertJsonPath('data.couriers', [])
            ->assertJsonPath('data.problem', 'Set up a courier first (Settings → Couriers).');
        $this->steadfastHook(['consignment_id' => 1, 'status' => 'delivered'])->assertNotFound();
        $this->pathaoHook(['consignment_id' => 'X', 'order_status' => 'Delivered'])->assertNotFound();
        $this->assertSame([], $this->sent);
        $this->assertSame('processing', $order->fresh()->status);
    }

    public function test_couriers_list_never_shows_secrets_and_checks_the_balance(): void
    {
        $response = $this->admin('GET', '/api/admin/v1/couriers?balance=1')->assertOk()
            ->assertJsonPath('data.0.configured', true)->assertJsonPath('data.0.balance', '৳12,500.50')
            ->assertJsonPath('data.1.configured', true)->assertJsonPath('data.1.balance', null);
        foreach (['sf-key', 'sf-secret', 'sf-hook', 'pt-secret', 'pt-pass', 'pt-hook'] as $secret) {
            $this->assertStringNotContainsString($secret, $response->getContent());
        }
        $this->admin('GET', '/api/admin/v1/couriers?balance=1')->assertJsonPath('data.0.balance', '৳12,500.50');
        $this->assertCount(1, $this->sentTo('/get_balance'), 'the balance is cached for 5 minutes');
        $this->assertSame('sf-key', $this->sentTo('/get_balance')[0]->header('Api-Key')[0]);
    }

    public function test_settings_are_saved_and_validated(): void
    {
        $this->admin('PUT', '/api/admin/v1/couriers/settings', ['courier_default' => 'fedex'])->assertUnprocessable()->assertJsonValidationErrors('courier_default');
        $this->admin('PUT', '/api/admin/v1/couriers/settings', ['courier_note_template' => str_repeat('x', 201)])->assertUnprocessable();
        $this->admin('PUT', '/api/admin/v1/couriers/settings', ['courier_default' => 'pathao', 'courier_auto_sync' => false,
            'courier_note_template' => ' Handle with care ', 'courier_pathao_item_type' => 'document', 'courier_pathao_delivery_type' => 'on_demand'])
            ->assertOk()->assertJsonPath('data', ['courier_default' => 'pathao', 'courier_auto_sync' => false, 'courier_note_template' => 'Handle with care',
                'courier_pathao_item_type' => 'document', 'courier_pathao_delivery_type' => 'on_demand']);
        $this->admin('GET', '/api/admin/v1/couriers')->assertJsonPath('settings.courier_default', 'pathao');
        $this->assertTrue(AuditLog::where('action', 'settings.updated')->where('summary', 'like', 'Courier settings%')->exists());
    }

    public function test_steadfast_booking(): void
    {
        app(Settings::class)->put(['courier_note_template' => 'Handle with care']);
        $order = $this->codOrder();
        $this->admin('GET', "/api/admin/v1/orders/{$order->number}/courier-booking")->assertOk()
            ->assertJsonPath('data.cod_amount', '1060.00')->assertJsonPath('data.weight_kg', 1.5)->assertJsonPath('data.phone', '01712345678')
            ->assertJsonPath('data.note', 'Handle with care')->assertJsonPath('data.problem', null)
            ->assertJsonPath('data.couriers', [['key' => 'steadfast', 'label' => 'Steadfast', 'mode' => null], ['key' => 'pathao', 'label' => 'Pathao', 'mode' => 'sandbox']]);

        $response = $this->book($order)->assertCreated()
            ->assertJsonPath('data.carrier', 'steadfast')->assertJsonPath('data.tracking_number', 'SF1X')
            ->assertJsonPath('data.tracking_url', 'https://steadfast.com.bd/t/SF1X')
            ->assertJsonPath('data.delivery_status', 'booked')->assertJsonPath('data.delivery_status_label', 'Booked')
            ->assertJsonPath('data.courier.consignment_id', '5001')->assertJsonPath('data.courier.tracking_code', 'SF1X')
            ->assertJsonPath('data.courier.courier_status', 'in_review')->assertJsonPath('data.courier.cod_amount', '1060.00')
            ->assertJsonPath('data.courier.courier_fee', null)->assertJsonPath('data.courier.booked_via_api', true)
            ->assertJsonPath('data.events.0.source', 'booking')->assertJsonPath('data.note', 'Handle with care');
        $this->assertNotNull($response->json('data.courier.last_synced_at'));

        $request = $this->sentTo('/create_order')[0];
        $this->assertSame(['sf-key'], $request->header('Api-Key'));
        $this->assertSame(['sf-secret'], $request->header('Secret-Key'));
        $this->assertSame($order->number, $request['invoice']);
        $this->assertSame('Rahim Uddin', $request['recipient_name']);
        $this->assertSame('01712345678', $request['recipient_phone']);
        $this->assertSame('House 12, Road 5, Dhanmondi, Dhaka, Dhaka', $request['recipient_address']);
        $this->assertEquals(1060, $request['cod_amount']);
        $this->assertSame('Handle with care', $request['note']);

        $order->refresh();
        $this->assertSame('shipped', $order->status);
        $this->assertSame('unpaid', $order->payment_status);
        Mail::assertSent(ShipmentMail::class, fn ($mail) => $mail->hasTo('rahim@example.com'));
        $this->assertTrue(AuditLog::where('action', 'shipment.booked')->exists());
        $this->admin('GET', "/api/admin/v1/orders/{$order->number}")->assertJsonPath('data.delivery_status', 'booked')
            ->assertJsonPath('data.shipments.0.courier.key', 'steadfast');
        $this->admin('GET', '/api/admin/v1/orders?delivery_status=booked')->assertJsonCount(1, 'data');
        $this->admin('GET', '/api/admin/v1/orders?delivery_status=delivered')->assertJsonCount(0, 'data');
        $this->admin('GET', '/api/admin/v1/shipments?carrier=steadfast&delivery_status=booked')->assertJsonCount(1, 'data');
    }

    public function test_pathao_booking(): void
    {
        $order = $this->codOrder();
        $this->admin('GET', "/api/admin/v1/orders/{$order->number}/courier-booking")
            ->assertJsonPath('data.pathao_match', ['city_id' => 1, 'zone_id' => 10, 'area_id' => null]);
        $this->book($order, ['courier' => 'pathao', 'pathao' => ['city_id' => 1]])->assertUnprocessable()->assertJsonValidationErrors('pathao.zone_id');

        $this->book($order, ['courier' => 'pathao', 'cod_amount' => '1000.40', 'weight_kg' => 12, 'note' => 'Call first', 'notify_customer' => false,
            'pathao' => ['city_id' => 1, 'zone_id' => 10, 'area_id' => 100]])
            ->assertCreated()->assertJsonPath('data.tracking_number', 'DL1PT')
            ->assertJsonPath('data.tracking_url', 'https://merchant.pathao.com/tracking?consignment_id=DL1PT')
            ->assertJsonPath('data.courier.consignment_id', 'DL1PT')->assertJsonPath('data.courier.courier_fee', '60.00')
            ->assertJsonPath('data.courier.cod_amount', '1000.40');

        $request = $this->sentTo('/aladdin/api/v1/orders', 'POST')[0];
        $this->assertSame(['Bearer tok-1'], $request->header('Authorization'));
        $this->assertSame(777, $request['store_id']);
        $this->assertSame($order->number, $request['merchant_order_id']);
        $this->assertSame('01712345678', $request['recipient_phone']);
        $this->assertSame([1, 10, 100], [$request['recipient_city'], $request['recipient_zone'], $request['recipient_area']]);
        $this->assertSame([48, 2], [$request['delivery_type'], $request['item_type']]);
        $this->assertSame(1001, $request['amount_to_collect'], 'whole taka, rounded up');
        $this->assertEquals(10, $request['item_weight'], 'clamped to 10 kg');
        $this->assertSame(1, $request['item_quantity']);
        $this->assertSame('Call first', $request['special_instruction']);
        $token = $this->sentTo('/issue-token')[0];
        $this->assertSame('password', $token['grant_type']);
        Mail::assertNotSent(ShipmentMail::class);
    }

    public function test_a_courier_error_saves_nothing(): void
    {
        $order = $this->codOrder();
        $this->steadfastBooking = ['status' => 400, 'message' => 'Validation error', 'errors' => ['recipient_phone' => ['The recipient phone is not a valid number.']]];
        $this->book($order)->assertUnprocessable()
            ->assertJsonPath('errors.courier.0', 'Steadfast refused the booking: The recipient phone is not a valid number');
        $this->assertSame('processing', $order->fresh()->status);
        $this->assertSame(0, Shipment::count());

        // A retried booking after a timeout: Steadfast already has the invoice.
        $this->steadfastBooking = ['status' => 400, 'errors' => ['invoice' => ['The invoice has already been taken.']]];
        $this->book($order)->assertUnprocessable()->assertJsonPath('errors.courier.0', fn ($m) => str_contains($m, 'Steadfast already has a parcel for order '.$order->number));

        // Pathao's validation error, and a courier that can't be reached.
        $this->book($order, ['courier' => 'pathao', 'pathao' => ['city_id' => 1, 'zone_id' => 11]])->assertUnprocessable()
            ->assertJsonPath('errors.courier.0', 'Pathao refused the booking: The selected zone does not serve this area');
        $this->steadfastBooking = null;
        $this->steadfastHttpStatus = 503;
        $this->book($order)->assertUnprocessable()->assertJsonPath('errors.courier.0', 'Steadfast is having trouble right now. Please try again in a moment.');
        $this->assertSame(0, Shipment::count());
        $this->assertSame('processing', $order->fresh()->status);
    }

    public function test_double_booking_is_refused(): void
    {
        $order = $this->codOrder();
        $this->book($order)->assertCreated();
        $this->book($order)->assertUnprocessable()->assertJsonPath('errors.order.0', 'This order is already booked with Steadfast (5001).');
        $this->book($order, ['courier' => 'pathao', 'pathao' => ['city_id' => 1, 'zone_id' => 10]])->assertUnprocessable()
            ->assertJsonPath('errors.order.0', 'This order is already booked with Steadfast (5001).');
        $this->assertCount(1, $this->sentTo('/create_order'));
        // A manually shipped order can't be booked either.
        $other = $this->codOrder();
        $this->admin('POST', "/api/admin/v1/orders/{$other->number}/shipments", ['carrier' => 'redx', 'tracking_number' => 'RX1'])->assertCreated()
            ->assertJsonPath('data.tracking_url', 'https://redx.com.bd/track-parcel/?trackingId=RX1')->assertJsonPath('data.delivery_status', 'shipped');
        $this->book($other)->assertUnprocessable()->assertJsonPath('errors.order.0', 'This order has already been shipped.');
    }

    public function test_a_store_not_in_taka_is_refused(): void
    {
        $order = $this->codOrder();
        config(['buynest.store.currency' => 'USD']);
        $this->book($order)->assertUnprocessable()->assertJsonPath('errors.courier.0', 'Couriers collect taka: switch the store currency to taka first.');
        $this->assertSame([], $this->sentTo('/create_order'));
    }

    public function test_unconfirmed_cod_needs_an_override_and_a_bangladeshi_mobile_is_required(): void
    {
        app(Settings::class)->put(['cod_require_confirmation' => true]);
        $order = $this->codOrder();
        $this->admin('GET', "/api/admin/v1/orders/{$order->number}/courier-booking")->assertJsonPath('data.awaits_confirmation', true)
            ->assertJsonPath('data.problem', null);
        $this->book($order)->assertUnprocessable()->assertJsonPath('errors.order.0', OrderDocuments::UNCONFIRMED);
        $this->book($order, ['courier' => 'steadfast', 'confirmation_override' => 'Customer confirmed on WhatsApp'])->assertCreated();
        $this->assertSame('override', $order->confirmationLogs()->first()->outcome);

        // A phone a courier can't call (an order from before the Bangladesh checks, or typed by staff).
        $foreign = $this->codOrder();
        $foreign->forceFill(['phone' => '+15550100100'])->save();
        $this->book($foreign, ['courier' => 'steadfast', 'confirmation_override' => 'Known customer'])->assertUnprocessable()
            ->assertJsonPath('errors.phone.0', 'A courier needs the customer\'s Bangladeshi mobile number.');
    }

    public function test_a_prepaid_order_books_with_nothing_to_collect(): void
    {
        $order = $this->codOrder();
        $order->forceFill(['payment_method' => 'bank_transfer', 'cod_due' => null])->save();
        app(OrderDocuments::class)->invoice($order, null, null, false);
        $this->admin('GET', "/api/admin/v1/orders/{$order->number}/courier-booking")->assertJsonPath('data.cod_amount', '0.00');
        $this->book($order)->assertCreated()->assertJsonPath('data.courier.cod_amount', '0.00');
        $this->assertEquals(0, $this->sentTo('/create_order')[0]['cod_amount']);
        $this->book($this->codOrder(), ['courier' => 'steadfast', 'cod_amount' => '5000.00'])->assertUnprocessable()->assertJsonValidationErrors('cod_amount');
    }

    public function test_pathao_token_is_cached_and_refreshed_on_401(): void
    {
        $this->admin('GET', '/api/admin/v1/couriers/pathao/cities')->assertOk()
            ->assertJsonPath('data', [['id' => 1, 'name' => 'Dhaka'], ['id' => 2, 'name' => 'Chattogram']]);
        $this->admin('GET', '/api/admin/v1/couriers/pathao/cities/1/zones')->assertOk()->assertJsonPath('data.0', ['id' => 10, 'name' => 'Dhanmondi']);
        $this->assertSame(1, $this->pathaoTokens);
        $this->assertSame('tok-1', Cache::get(PathaoGateway::TOKEN_CACHE_KEY));

        $this->pathao401 = 1;
        $this->admin('GET', '/api/admin/v1/couriers/pathao/cities/2/zones')->assertOk()->assertJsonPath('data.0.name', 'Agrabad');
        $this->assertSame(2, $this->pathaoTokens);
        $this->assertSame('tok-2', Cache::get(PathaoGateway::TOKEN_CACHE_KEY));

        $this->admin('GET', '/api/admin/v1/couriers/pathao/zones/10/areas')->assertOk()
            ->assertJsonPath('data', [['id' => 100, 'name' => 'Road 5', 'home_delivery_available' => true, 'pickup_available' => false]]);
        // Twice refused: the request fails cleanly.
        $this->pathao401 = 2;
        $this->admin('GET', '/api/admin/v1/couriers/pathao/zones/11/areas')->assertStatus(502);
        $this->pathaoDown = true;
        $this->admin('GET', '/api/admin/v1/couriers/pathao/zones/12/areas')->assertStatus(502)
            ->assertJsonPath('message', 'Pathao is having trouble right now. Please try again in a moment.');
        foreach ($this->sent as $request) {
            $this->assertStringNotContainsString('pt-pass', $request->url());
        }
    }

    public function test_pathao_match_never_guesses(): void
    {
        $order = $this->codOrder([], $this->debidwar());
        $this->admin('GET', "/api/admin/v1/orders/{$order->number}/courier-booking")->assertOk()
            ->assertJsonPath('data.pathao_match', ['city_id' => null, 'zone_id' => null, 'area_id' => null])
            ->assertJsonPath('data.address_line', fn ($line) => str_contains($line, 'Debidwar, Cumilla'));
        // Pathao unreachable: no match, the dialog still opens.
        $this->pathaoDown = true;
        Cache::flush();
        $this->admin('GET', "/api/admin/v1/orders/{$this->codOrder()->number}/courier-booking")->assertOk()
            ->assertJsonPath('data.pathao_match.city_id', null);
    }

    public static function steadfastStatuses(): array
    {
        return [['pending', 'booked'], ['in_review', 'booked'], ['hold', 'on_hold'], ['delivered', 'delivered'], ['delivered_approval_pending', 'delivered'],
            ['partial_delivered', 'partly_delivered'], ['partial_delivered_approval_pending', 'partly_delivered'], ['cancelled', 'cancelled'],
            ['cancelled_approval_pending', 'cancelled'], ['unknown', 'on_hold'], ['unknown_approval_pending', 'on_hold'], ['IN_REVIEW', 'booked'],
            ['something_new', 'in_transit']];
    }

    #[DataProvider('steadfastStatuses')]
    public function test_steadfast_status_mapping(string $raw, string $ours): void
    {
        $this->assertSame($ours, app(SteadfastGateway::class)->normalise($raw));
    }

    public static function pathaoStatuses(): array
    {
        return [['Pending', 'booked'], ['Pickup Requested', 'booked'], ['Assigned for Pickup', 'booked'], ['Picked', 'picked_up'], ['pickup_success', 'picked_up'],
            ['At the Sorting HUB', 'in_transit'], ['In Transit', 'in_transit'], ['Received at Last Mile HUB', 'in_transit'],
            ['Assigned for Delivery', 'out_for_delivery'], ['Delivered', 'delivered'], ['Partial Delivery', 'partly_delivered'], ['On Hold', 'on_hold'],
            ['Delivery Failed', 'on_hold'], ['Pickup Failed', 'on_hold'], ['Return', 'returned'], ['Returned', 'returned'], ['Paid Return', 'returned'],
            ['Exchange', 'returned'], ['Pickup Cancelled', 'cancelled'], ['cancelled', 'cancelled'], ['Something New', 'in_transit']];
    }

    #[DataProvider('pathaoStatuses')]
    public function test_pathao_status_mapping(string $raw, string $ours): void
    {
        $this->assertSame($ours, app(PathaoGateway::class)->normalise($raw));
    }

    public function test_webhook_secrets(): void
    {
        $order = $this->codOrder();
        $this->book($order)->assertCreated();
        $payload = ['notification_type' => 'delivery_status', 'consignment_id' => 5001, 'invoice' => $order->number, 'status' => 'hold', 'tracking_message' => 'Customer not home'];
        $this->steadfastHook($payload, null)->assertUnauthorized();
        $this->steadfastHook($payload, 'wrong')->assertUnauthorized();
        $this->assertSame('booked', Shipment::first()->delivery_status);
        $this->steadfastHook($payload)->assertOk()->assertExactJson(['status' => 'success', 'message' => 'Webhook received successfully.']);
        $this->assertSame('on_hold', Shipment::first()->delivery_status);

        $this->pathaoHook(['consignment_id' => 'DL1PT', 'order_status' => 'Delivered'], 'wrong')->assertUnauthorized();
        $this->pathaoHook(['event' => 'webhook_integration'])->assertStatus(202)->assertHeader('X-Pathao-Merchant-Webhook-Integration-Secret', 'pt-hook');
        // An unknown consignment: answered as received, nothing changes.
        $this->pathaoHook(['consignment_id' => 'NOPE', 'event' => 'order.delivered', 'order_status' => 'Delivered'])->assertStatus(202);
        $this->steadfastHook([...$payload, 'consignment_id' => 99999, 'status' => 'delivered'])->assertOk();
        $this->assertSame('shipped', $order->fresh()->status);

        // Production refuses API calls without the sign-in service's key, but the couriers post straight to the API.
        config(['buynest.require_bff_key' => true, 'buynest.bff_key' => 'bff-key']);
        $this->steadfastHook([...$payload, 'status' => 'in_review'])->assertOk();
        $this->pathaoHook(['event' => 'webhook_integration'])->assertStatus(202);
        $this->postJson('/api/v1/orders/lookup', ['number' => $order->number, 'email' => 'rahim@example.com'])->assertForbidden();
    }

    public function test_webhook_is_idempotent_and_keeps_tracking_messages(): void
    {
        $order = $this->codOrder();
        $this->book($order)->assertCreated();
        $payload = ['notification_type' => 'delivery_status', 'consignment_id' => 5001, 'invoice' => $order->number, 'status' => 'hold',
            'tracking_message' => 'Customer not home', 'delivery_charge' => 60];
        $this->steadfastHook($payload)->assertOk();
        $this->steadfastHook($payload)->assertOk();
        $shipment = Shipment::first();
        $this->assertSame(2, $shipment->events()->count(), 'booking + one hold');
        $this->assertSame(6000, $shipment->courier_fee_cents);
        $this->assertSame(1, AdminNotification::where('type', 'courier_update')->count(), 'on hold: once per day');

        $this->steadfastHook(['notification_type' => 'tracking_update', 'consignment_id' => 5001, 'tracking_message' => 'Out with rider Karim'])->assertOk();
        $this->steadfastHook(['notification_type' => 'tracking_update', 'consignment_id' => 5001, 'tracking_message' => 'Out with rider Karim'])->assertOk();
        $this->assertSame(3, $shipment->events()->count());
        $this->assertSame('on_hold', $shipment->fresh()->delivery_status);
    }

    public function test_delivered_cod_parcel_delivers_invoices_and_pays_the_order(): void
    {
        $order = $this->codOrder();
        $this->book($order)->assertCreated();
        Mail::fake();
        $this->steadfastHook(['notification_type' => 'delivery_status', 'consignment_id' => 5001, 'invoice' => $order->number, 'status' => 'delivered',
            'cod_amount' => 1060, 'delivery_charge' => 60, 'tracking_message' => 'Delivered to customer'])->assertOk();

        $order->refresh();
        $this->assertSame('delivered', $order->status);
        $this->assertSame('paid', $order->payment_status);
        $this->assertSame('1060.00', $order->cod_collected);
        $this->assertSame('0.00', $order->cod_due);
        $this->assertSame(1, $order->invoices()->count());
        $this->assertSame('1060.00', $order->invoices()->first()->amount);
        Mail::assertSent(OrderStatusMail::class, fn ($mail) => $mail->hasTo('rahim@example.com') && $mail->order->status === 'delivered');
        $shipment = Shipment::first();
        $this->assertSame(106000, $shipment->collected_cents);

        $detail = $this->admin('GET', "/api/admin/v1/orders/{$order->number}")->assertOk()
            ->assertJsonPath('data.shipments.0.courier.collected', '1060.00')->assertJsonPath('data.shipments.0.delivery_status_label', 'Delivered');
        $history = collect($detail->json('data.history'));
        $this->assertTrue($history->contains(fn ($entry) => $entry['note'] === 'Delivered — reported by Steadfast.' && $entry['admin_name'] === 'Steadfast'));
        $this->assertTrue(AuditLog::where('action', 'order.cash_collected')->whereNull('admin_id')->exists());

        // The same webhook again (or a late "in review"): nothing collected twice, the order stays delivered.
        $this->steadfastHook(['notification_type' => 'delivery_status', 'consignment_id' => 5001, 'status' => 'delivered', 'cod_amount' => 1060])->assertOk();
        $this->steadfastHook(['notification_type' => 'delivery_status', 'consignment_id' => 5001, 'status' => 'in_review'])->assertOk();
        $this->assertSame(1, $order->invoices()->count());
        $this->assertSame('delivered', $shipment->fresh()->delivery_status);
        $this->assertSame('delivered', $order->fresh()->status);
    }

    public function test_pathao_delivered_with_less_cash_is_a_short_collection(): void
    {
        $order = $this->codOrder();
        $this->book($order, ['courier' => 'pathao', 'pathao' => ['city_id' => 1, 'zone_id' => 10]])->assertCreated();
        $this->pathaoHook(['consignment_id' => 'DL1PT', 'merchant_order_id' => $order->number, 'event' => 'order.delivered', 'order_status' => 'Delivered',
            'collected_amount' => 1000, 'delivery_fee' => 60])->assertStatus(202)->assertHeader('X-Pathao-Merchant-Webhook-Integration-Secret', 'pt-hook');
        $order->refresh();
        $this->assertSame('delivered', $order->status);
        $this->assertSame('partially_paid', $order->payment_status);
        $this->assertSame('60.00', $order->cod_due);
        $this->assertSame(1, AdminNotification::where('type', 'cod_short_collection')->count());
    }

    public function test_partly_delivered_returned_and_cancelled_notify_staff_and_leave_the_order(): void
    {
        foreach (['partial_delivered' => 'delivered part of the parcel', 'cancelled' => 'reports the parcel cancelled'] as $status => $title) {
            $order = $this->codOrder();
            $consignment = $this->book($order)->assertCreated()->json('data.courier.consignment_id');
            $this->steadfastHook(['notification_type' => 'delivery_status', 'consignment_id' => $consignment, 'status' => $status, 'cod_amount' => 500])->assertOk();
            $this->assertSame('shipped', $order->fresh()->status);
            $this->assertSame('unpaid', $order->fresh()->payment_status);
            $this->assertTrue(AdminNotification::where('type', 'courier_update')->where('title', 'like', "%{$title}%")->exists(), $status);
        }
        $order = $this->codOrder();
        $this->book($order, ['courier' => 'pathao', 'pathao' => ['city_id' => 1, 'zone_id' => 10]])->assertCreated();
        $this->pathaoStatus = 'Returned';
        $shipment = Shipment::where('carrier', 'pathao')->first();
        $this->admin('POST', "/api/admin/v1/shipments/{$shipment->number}/sync")->assertOk()
            ->assertJsonPath('data.delivery_status', 'returned')->assertJsonPath('data.courier.courier_status', 'Returned')
            ->assertJsonPath('data.events.1.source', 'sync');
        $this->assertSame('shipped', $order->fresh()->status);
        $this->assertTrue(AdminNotification::where('title', "Order {$order->number}: Pathao reports the parcel returned")->exists());
    }

    public function test_customers_see_the_tracker_but_not_the_courier_details(): void
    {
        $order = $this->codOrder();
        $this->book($order)->assertCreated();
        $this->steadfastHook(['notification_type' => 'delivery_status', 'consignment_id' => 5001, 'status' => 'hold', 'delivery_charge' => 60,
            'tracking_message' => 'Customer not home'])->assertOk();

        $response = $this->postJson('/api/v1/orders/lookup', ['number' => $order->number, 'email' => 'rahim@example.com'])->assertOk()
            ->assertJsonPath('data.shipments.0.delivery_status', 'on_hold')->assertJsonPath('data.shipments.0.delivery_status_label', 'On hold')
            ->assertJsonPath('data.shipments.0.tracking_url', 'https://steadfast.com.bd/t/SF1X')
            ->assertJsonPath('data.shipments.0.events.1', ['delivery_status' => 'on_hold', 'label' => 'On hold', 'message' => 'Customer not home',
                'occurred_at' => Shipment::first()->events()->latest('id')->first()->occurred_at->toIso8601ZuluString()]);
        $shipment = $response->json('data.shipments.0');
        $this->assertArrayNotHasKey('courier', $shipment);
        $this->assertArrayNotHasKey('courier_status', $shipment['events'][0]);
        $this->assertArrayNotHasKey('source', $shipment['events'][0]);
        $this->assertStringNotContainsString('courier_fee', $response->getContent());
        $this->assertStringNotContainsString('"hold"', $response->getContent());

        $this->postJson('/api/v1/orders/lookup', ['number' => $order->number, 'email' => 'rahim@example.com'], ['Accept-Language' => 'bn'])
            ->assertJsonPath('data.shipments.0.delivery_status_label', 'স্থগিত')->assertJsonPath('data.shipments.0.events.0.label', 'বুক করা হয়েছে');
    }

    public function test_sync_command(): void
    {
        $steadfast = $this->codOrder();
        $this->book($steadfast)->assertCreated();
        $pathao = $this->codOrder();
        $this->book($pathao, ['courier' => 'pathao', 'pathao' => ['city_id' => 1, 'zone_id' => 10]])->assertCreated();
        $old = $this->codOrder();
        $this->book($old)->assertCreated();
        Shipment::where('order_id', $old->id)->update(['created_at' => now()->subDays(31)]);
        $this->sent = [];

        $this->artisan('buynest:couriers:sync --dry-run')->expectsOutputToContain('Would check 2 parcels.')->assertSuccessful();
        $this->assertSame([], $this->sent);

        // Steadfast is down; Pathao still answers.
        $this->steadfastHttpStatus = 503;
        $this->pathaoStatus = 'Picked';
        $this->artisan('buynest:couriers:sync')
            ->expectsOutputToContain('Checked 2 parcels: 1 updated, 0 unchanged, 1 failed, 0 skipped. Not reached or not set up: steadfast.')->assertSuccessful();
        $this->assertSame('picked_up', Shipment::where('carrier', 'pathao')->first()->delivery_status);

        $this->steadfastHttpStatus = 200;
        $this->steadfastStatus['5001'] = ['status' => 200, 'delivery_status' => 'delivered'];
        $this->artisan('buynest:couriers:sync --limit=1')->expectsOutputToContain('Checked 1 parcels: 1 updated')->assertSuccessful();
        $this->assertSame('delivered', $steadfast->fresh()->status, 'never asked before: first in line');
        $this->artisan('buynest:couriers:sync')->expectsOutputToContain('Checked 1 parcels: 0 updated, 1 unchanged')->assertSuccessful();
    }

    public function test_bulk_steadfast_booking(): void
    {
        $good = $this->codOrder();
        $bad = $this->codOrder();
        $bad->forceFill(['phone' => '+15550100100'])->save();
        $this->admin('POST', '/api/admin/v1/orders/courier-bookings', ['courier' => 'pathao', 'numbers' => [$good->number]])->assertUnprocessable()
            ->assertJsonValidationErrors('courier');
        $this->admin('POST', '/api/admin/v1/orders/courier-bookings', ['courier' => 'steadfast', 'numbers' => [$good->number, $bad->number, 'BN-999999']])
            ->assertOk()
            ->assertJsonPath('data.booked', [['number' => $good->number, 'consignment_id' => '5001', 'tracking_code' => 'SF1X']])
            ->assertJsonPath('data.failed', [['number' => $bad->number, 'message' => 'A courier needs the customer\'s Bangladeshi mobile number.'],
                ['number' => 'BN-999999', 'message' => 'Order not found.']]);
        $this->assertSame('shipped', $good->fresh()->status);
        $this->assertSame('processing', $bad->fresh()->status);
    }

    public function test_refresh_status_and_manual_shipments(): void
    {
        $order = $this->codOrder();
        $this->admin('POST', "/api/admin/v1/orders/{$order->number}/shipments", ['carrier' => 'paperfly'])->assertCreated()->assertJsonPath('data.courier', null);
        $shipment = Shipment::first();
        $this->admin('POST', "/api/admin/v1/shipments/{$shipment->number}/sync")->assertUnprocessable()->assertJsonValidationErrors('shipment');
        $this->admin('POST', '/api/admin/v1/shipments/SHP-999999/sync')->assertNotFound();

        $booked = $this->codOrder();
        $this->book($booked)->assertCreated();
        $number = Shipment::where('order_id', $booked->id)->value('number');
        $this->steadfastStatus['5001'] = ['status' => 200, 'delivery_status' => 'unknown'];
        $this->admin('POST', "/api/admin/v1/shipments/{$number}/sync")->assertOk()->assertJsonPath('data.delivery_status', 'on_hold')
            ->assertJsonPath('data.events.1.message', 'The courier needs to check this parcel.');
        $this->steadfastHttpStatus = 503;
        $this->admin('POST', "/api/admin/v1/shipments/{$number}/sync")->assertStatus(502);
    }

    public function test_permissions(): void
    {
        $order = $this->codOrder();
        $viewer = $this->signInAdmin(Admin::factory()->role(['orders.view'])->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/couriers')->assertOk();
        $this->asAdmin($viewer, 'POST', "/api/admin/v1/orders/{$order->number}/courier-booking", ['courier' => 'steadfast'])->assertForbidden()
            ->assertJsonPath('permission', 'shipments.create');
        $this->asAdmin($viewer, 'GET', "/api/admin/v1/orders/{$order->number}/courier-booking")->assertForbidden();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/orders/courier-bookings', ['courier' => 'steadfast', 'numbers' => [$order->number]])->assertForbidden();
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/couriers/pathao/cities')->assertForbidden();
        $this->asAdmin($viewer, 'PUT', '/api/admin/v1/couriers/settings', ['courier_auto_sync' => false])->assertForbidden();
        $this->assertSame('processing', $order->fresh()->status);
        $this->assertSame([], $this->sent);
    }
}
