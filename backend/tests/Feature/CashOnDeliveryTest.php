<?php

namespace Tests\Feature;

use App\Mail\CodConfirmedMail;
use App\Mail\OrderPlacedMail;
use App\Mail\OrderStatusMail;
use App\Models\AdminNotification;
use App\Models\BdArea;
use App\Models\Order;
use App\Models\Product;
use App\Services\PackingSlips;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\BangladeshAddresses;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 14 (§4–§6): cash on delivery the Bangladeshi way in a taka store:
 * fee, limit, zones, the advance delivery charge through the SSLCommerz
 * stand-in, collection, phone confirmation, packing slips and the courier CSV.
 *
 * Lamp ৳1,000.00; standard delivery 60 inside Dhaka, 100 suburbs, 120 outside.
 */
class CashOnDeliveryTest extends TestCase
{
    use BangladeshAddresses, PlacesOrders, RefreshDatabase;

    private const API = 'https://sslcommerz.test';

    private Product $lamp;

    private array $validations = [];

    private ?array $headers = null;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'buynest.store.currency' => 'BDT',
            'buynest.sslcommerz.store_id' => 'buynesttest',
            'buynest.sslcommerz.store_password' => 'test-store-password',
            'buynest.sslcommerz.api_url' => self::API,
            'buynest.storefront_url' => 'https://shop.example.com',
        ]);
        app(Settings::class)->put(['free_shipping_threshold' => '100000.00', 'enabled_payment_methods' => ['cod', 'sslcommerz']]);
        $this->zoneRates();
        $this->lamp = $this->product(['price' => '1000.00', 'stock_quantity' => 10, 'name' => 'Desk Lamp', 'weight' => 1500]);
        Http::fake(function (Request $request) {
            $path = parse_url($request->url(), PHP_URL_PATH);
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

            return match (true) {
                $path === '/gwprocess/v4/api.php' => Http::response(['status' => 'SUCCESS', 'sessionkey' => 'S1', 'GatewayPageURL' => 'https://sandbox.sslcommerz.com/pay/1']),
                $path === '/validator/api/validationserverAPI.php' => Http::response($this->validations[$query['val_id'] ?? ''] ?? ['status' => 'INVALID_TRANSACTION']),
                $path === '/validator/api/merchantTransIDvalidationAPI.php' && isset($query['refund_amount']) => Http::response(['APIConnect' => 'DONE',
                    'status' => 'success', 'refund_ref_id' => 'RF-1']),
                $path === '/validator/api/merchantTransIDvalidationAPI.php' => Http::response(['APIConnect' => 'DONE', 'no_of_trans_found' => 0, 'element' => []]),
                default => Http::response(['status' => 'FAILED'], 404),
            };
        });
    }

    private function admin(string $method, string $uri, array $body = [])
    {
        $this->headers ??= $this->adminHeaders();

        return $this->asAdmin($this->headers, $method, $uri, $body);
    }

    private function codOrder(?BdArea $area = null, array $overrides = [], array $headers = [])
    {
        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], [
            'payment_method' => 'cod', 'phone' => '01712 345678', 'shipping_address' => $this->bdAddress($area), ...$overrides,
        ], $headers);
    }

    private function cart(?BdArea $area, string $method = 'cod')
    {
        return $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $this->lamp->id, 'quantity' => 1]], 'country' => $area ? 'BD' : 'Germany',
            'area_id' => $area?->id, 'district_id' => $area?->district_id, 'payment_method' => $method])->assertOk();
    }

    private function payment(string $tranId, string $amount): array
    {
        return ['status' => 'VALID', 'tran_id' => $tranId, 'val_id' => 'VAL-'.$tranId, 'amount' => $amount, 'currency' => 'BDT', 'currency_type' => 'BDT',
            'bank_tran_id' => 'BANK-'.$tranId, 'card_type' => 'BKASH-BKash', 'risk_level' => '0'];
    }

    public function test_defaults_change_nothing(): void
    {
        $this->cart($this->dhanmondi())->assertJsonPath('data.totals.cod_fee', '0.00')->assertJsonPath('data.totals.total', '1060.00')
            ->assertJsonPath('data.cod', ['available' => true, 'reason' => null, 'message' => null, 'fee' => '0.00', 'max_order_total' => null,
                'advance' => 'none', 'advance_amount' => '0.00']);
        $this->codOrder()->assertCreated()->assertJsonPath('data.status', 'processing')->assertJsonPath('data.payment_status', 'unpaid')
            ->assertJsonPath('data.cod', ['fee' => '0.00', 'advance_amount' => '0.00', 'advance_paid' => '0.00', 'cod_due' => '1060.00'])
            ->assertJsonPath('data.confirmation_status', null)->assertJsonPath('data.payment.url', null);
    }

    public function test_fee_limit_and_zones(): void
    {
        app(Settings::class)->put(['cod_fee' => '20.00', 'cod_max_order_total' => '1050.00', 'cod_zones' => ['inside_dhaka', 'dhaka_suburbs']]);
        $this->cart($this->dhanmondi())->assertJsonPath('data.totals.cod_fee', '20.00')->assertJsonPath('data.totals.total', '1080.00')
            ->assertJsonPath('data.cod.available', false)->assertJsonPath('data.cod.reason', 'limit')
            ->assertJsonPath('data.cod.message', 'Cash on delivery is available for orders up to ৳1,050.00.');
        $this->cart($this->dhanmondi(), 'sslcommerz')->assertJsonPath('data.totals.cod_fee', '0.00')->assertJsonPath('data.totals.total', '1060.00');
        $this->codOrder()->assertUnprocessable()->assertJsonPath('errors.payment_method.0', 'Cash on delivery is available for orders up to ৳1,050.00.');

        app(Settings::class)->put(['cod_max_order_total' => '5000.00']);
        $this->cart($this->debidwar())->assertJsonPath('data.cod.reason', 'zone');
        // A Bangladesh address without its area yet: COD waits for it.
        $this->postJson('/api/v1/cart/validate', ['items' => [['product_id' => $this->lamp->id, 'quantity' => 1]], 'country' => 'BD', 'payment_method' => 'cod'])
            ->assertOk()->assertJsonPath('data.cod.reason', 'area_required');
        // Another country has no delivery zone: the (Bangladesh) zones don't apply to it, as before phase 14.
        $this->cart(null)->assertJsonPath('data.delivery_zone', null)->assertJsonPath('data.cod.available', true)->assertJsonPath('data.cod.reason', null);
        $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], [
            'payment_method' => 'cod', 'phone' => '+49 30 1234567',
            'shipping_address' => ['first_name' => 'Ana', 'last_name' => 'Lee', 'line1' => 'Hauptstraße 1', 'city' => 'Berlin', 'state' => 'Berlin', 'postal_code' => '10115', 'country' => 'Germany'],
        ])->assertCreated()->assertJsonPath('data.delivery.zone_code', null)->assertJsonPath('data.totals.cod_fee', '20.00');
        $this->codOrder($this->debidwar())->assertUnprocessable()->assertJsonPath('errors.payment_method.0', 'Cash on delivery isn\'t available in your area.');
        $this->codOrder($this->debidwar(), [], ['Accept-Language' => 'bn'])->assertUnprocessable()
            ->assertJsonPath('errors.payment_method.0', 'আপনার এলাকায় ক্যাশ অন ডেলিভারি নেই।');

        $this->codOrder($this->savar())->assertCreated()->assertJsonPath('data.totals.total', '1120.00')->assertJsonPath('data.totals.cod_fee', '20.00')
            ->assertJsonPath('data.cod.cod_due', '1120.00');
    }

    public function test_settings_are_checked(): void
    {
        $this->admin('PATCH', '/api/admin/v1/settings', ['cod' => ['zones' => ['nowhere']]])->assertUnprocessable()->assertJsonValidationErrors('cod.zones.0');
        $this->admin('PATCH', '/api/admin/v1/settings', ['checkout' => ['default_country' => 'Mars']])->assertUnprocessable()
            ->assertJsonValidationErrors('checkout.default_country');
        $this->admin('PATCH', '/api/admin/v1/settings', ['checkout' => ['default_country' => 'BD'], 'cod' => ['fee' => '15', 'max_order_total' => '20000',
            'zones' => ['inside_dhaka'], 'require_confirmation' => true, 'advance' => 'delivery_charge']])->assertOk()
            ->assertJsonPath('data.checkout.default_country', 'Bangladesh')
            ->assertJsonPath('data.cod', ['max_order_total' => '20000.00', 'fee' => '15.00', 'advance' => 'delivery_charge', 'zones' => ['inside_dhaka'], 'require_confirmation' => true]);
        $this->getJson('/api/v1/store')->assertJsonPath('data.default_country', 'Bangladesh')
            ->assertJsonPath('data.cod', ['fee' => '15.00', 'max_order_total' => '20000.00', 'advance' => 'delivery_charge', 'zones' => ['inside_dhaka'], 'require_confirmation' => true]);

        config(['buynest.sslcommerz.store_id' => null]);
        $this->admin('PATCH', '/api/admin/v1/settings', ['cod' => ['advance' => 'delivery_charge']])->assertUnprocessable()
            ->assertJsonValidationErrors('cod.advance');
        $this->admin('PATCH', '/api/admin/v1/settings', ['cod' => ['advance' => 'none']])->assertOk();
    }

    public function test_the_advance_delivery_charge_goes_through_sslcommerz(): void
    {
        app(Settings::class)->put(['cod_advance' => 'delivery_charge', 'cod_fee' => '20.00']);
        $this->cart($this->dhanmondi())->assertJsonPath('data.cod.advance_amount', '80.00');
        $placed = $this->codOrder()->assertCreated()->assertJsonPath('data.status', 'pending_payment')
            ->assertJsonPath('data.payment.url', 'https://sandbox.sslcommerz.com/pay/1')
            ->assertJsonPath('data.cod', ['fee' => '20.00', 'advance_amount' => '80.00', 'advance_paid' => '0.00', 'cod_due' => '1000.00']);
        $number = $placed->json('data.number');
        Http::assertSent(fn (Request $request) => str_ends_with(parse_url($request->url(), PHP_URL_PATH), '/gwprocess/v4/api.php')
            && $request->data()['total_amount'] === '80.00');
        Mail::assertSent(OrderPlacedMail::class);

        $this->validations["VAL-{$number}-1"] = $this->payment("{$number}-1", '80.00');
        $this->postJson('/api/v1/payments/sslcommerz/return', ['result' => 'success', 'tran_id' => "{$number}-1", 'val_id' => "VAL-{$number}-1"])
            ->assertJsonPath('data.result', 'paid');
        $order = Order::where('number', $number)->first();
        $this->assertSame(['processing', 'partially_paid', '80.00', '1000.00'], [$order->status, $order->payment_status, $order->advance_paid, $order->cod_due]);
        $this->assertSame(['80.00'], $order->invoices->pluck('amount')->all());

        // A refund goes back through SSLCommerz, up to the advance.
        $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [], 'shipping_refund' => '80.00', 'adjustment' => '0'])->assertCreated()
            ->assertJsonPath('data.refund_reference', 'RF-1');
        Http::assertSent(fn (Request $request) => str_contains($request->url(), 'refund_amount=80.00'));
        $this->assertSame('80.00', $order->refresh()->advance_refunded);

        // An unpaid advance expires like other SSLCommerz attempts: cancelled and restocked once.
        $second = $this->codOrder()->assertCreated()->json('data.number');
        $this->assertSame(8, $this->lamp->refresh()->stock_quantity);
        $this->travel(4)->hours();
        $this->artisan('buynest:payments:expire-sslcommerz')->assertSuccessful();
        $this->assertSame('cancelled', Order::where('number', $second)->value('status'));
        $this->assertSame(9, $this->lamp->refresh()->stock_quantity);
        $this->artisan('buynest:payments:expire-sslcommerz')->assertSuccessful();
        $this->assertSame(9, $this->lamp->refresh()->stock_quantity);
    }

    public function test_collecting_the_cash_in_full_and_short(): void
    {
        $number = $this->codOrder()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'other'])->assertCreated();

        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered', 'collected_amount' => '2000'])->assertUnprocessable()
            ->assertJsonValidationErrors('collected_amount');
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered', 'collected_amount' => '500'])->assertUnprocessable()
            ->assertJsonValidationErrors('collection_note');
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered', 'collected_amount' => '500', 'collection_note' => 'Customer paid half'])
            ->assertOk()->assertJsonPath('data.status', 'delivered')->assertJsonPath('data.payment_status', 'partially_paid')
            ->assertJsonPath('data.cod.cod_due', '560.00')->assertJsonPath('data.cod.collected', '500.00')->assertJsonPath('data.totals.paid', '500.00');
        $this->assertSame(1, AdminNotification::where('type', 'cod_short_collection')->count());

        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['collected_amount' => '560'])->assertOk()
            ->assertJsonPath('data.payment_status', 'paid')->assertJsonPath('data.cod.cod_due', '0.00')->assertJsonPath('data.totals.paid', '1060.00');
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['collected_amount' => '1'])->assertUnprocessable();

        // In full at once.
        $second = $this->codOrder()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$second}/shipments", ['carrier' => 'other'])->assertCreated();
        $this->admin('PATCH', "/api/admin/v1/orders/{$second}", ['status' => 'delivered', 'collected_amount' => '1060.00'])->assertOk()
            ->assertJsonPath('data.payment_status', 'paid')->assertJsonPath('data.invoices.0.amount', '1060.00')
            ->assertJsonPath('data.invoices.0.note', 'Cash collected on delivery: ৳1,060.00.');
        // Without an amount, delivered works as before.
        $third = $this->codOrder()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$third}/shipments", ['carrier' => 'other'])->assertCreated();
        $this->admin('PATCH', "/api/admin/v1/orders/{$third}", ['status' => 'delivered'])->assertOk()->assertJsonPath('data.payment_status', 'unpaid');
    }

    public function test_phone_confirmation(): void
    {
        app(Settings::class)->put(['cod_require_confirmation' => true]);
        $number = $this->codOrder()->assertCreated()->assertJsonPath('data.confirmation_status', 'pending')->json('data.number');

        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'other'])->assertUnprocessable()
            ->assertJsonPath('errors.order.0', 'This cash on delivery order hasn\'t been confirmed by phone yet. Confirm it first, or ship it anyway with a reason.');
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'shipped'])->assertUnprocessable()->assertJsonValidationErrors('status');

        $this->admin('GET', '/api/admin/v1/orders/to-confirm')->assertOk()->assertJsonPath('data.0.number', $number)
            ->assertJsonPath('data.0.tel_url', 'tel:+8801712345678')->assertJsonPath('data.0.delivery_zone.code', 'inside_dhaka')
            ->assertJsonPath('data.0.previous', ['orders' => 0, 'delivered' => 0, 'cancelled' => 0, 'returns' => 0])
            ->assertJsonPath('data.0.address', 'House 12, Road 5, Dhanmondi, Dhaka, Dhaka, Bangladesh')->assertJsonPath('meta.total', 1);

        $this->admin('POST', "/api/admin/v1/orders/{$number}/confirmation", ['outcome' => 'unreachable', 'note' => 'No answer'])->assertOk()
            ->assertJsonPath('data.confirmation.status', 'unreachable')->assertJsonPath('data.confirmation.attempts', 1)
            ->assertJsonPath('data.confirmation.logs.0.note', 'No answer');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/confirmation", ['outcome' => 'confirmed'])->assertOk()
            ->assertJsonPath('data.confirmation.status', 'confirmed')->assertJsonPath('data.confirmation.attempts', 2);
        Mail::assertSent(CodConfirmedMail::class, fn ($mail) => $mail->hasTo('guest@example.com'));
        $this->admin('POST', "/api/admin/v1/orders/{$number}/confirmation", ['outcome' => 'confirmed'])->assertUnprocessable()->assertJsonValidationErrors('order');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'other'])->assertCreated();
        $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'guest@example.com'])->assertJsonPath('data.confirmation_status', 'confirmed');

        // Staff may ship an unconfirmed order with a reason (logged and audited).
        $second = $this->codOrder()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$second}/shipments", ['carrier' => 'other', 'confirmation_override' => 'Regular customer'])->assertCreated();
        $this->admin('GET', "/api/admin/v1/orders/{$second}")->assertJsonPath('data.confirmation.logs.0.outcome', 'override')
            ->assertJsonPath('data.confirmation.logs.0.note', 'Regular customer');
        $this->assertDatabaseHas('audit_log', ['action' => 'order.confirmation_overridden']);
        // Phase 18: shipped anyway, it no longer needs the call, so it leaves the "To confirm" queue.
        $this->admin('GET', '/api/admin/v1/orders/to-confirm')->assertOk()->assertJsonPath('meta.total', 0);

        // Cancelling at the confirmation restocks and emails the customer.
        $third = $this->codOrder()->json('data.number');
        $stock = $this->lamp->refresh()->stock_quantity;
        $this->admin('POST', "/api/admin/v1/orders/{$third}/confirmation", ['outcome' => 'cancelled'])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->admin('POST', "/api/admin/v1/orders/{$third}/confirmation", ['outcome' => 'cancelled', 'reason' => 'Ordered by mistake'])->assertOk()
            ->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.confirmation.status', 'cancelled');
        $this->assertSame($stock + 1, $this->lamp->refresh()->stock_quantity);
        Mail::assertSent(OrderStatusMail::class, fn ($mail) => $mail->order->number === $third);

        // The grid filters.
        $this->admin('GET', '/api/admin/v1/orders?confirmation_status=cancelled')->assertJsonCount(1, 'data')->assertJsonPath('data.0.number', $third);
        $this->admin('GET', '/api/admin/v1/orders?delivery_zone=inside_dhaka&cod=1')->assertJsonCount(3, 'data');
        $this->admin('GET', '/api/admin/v1/orders?cod=0')->assertJsonCount(0, 'data');
    }

    public function test_packing_slips_courier_csv_and_bangla_emails(): void
    {
        app(Settings::class)->put(['cod_fee' => '20.00']);
        $bangla = $this->codOrder(null, ['shipping_address' => $this->bdAddress(null, ['first_name' => 'রহিম', 'last_name' => 'উদ্দিন'])], ['Accept-Language' => 'bn'])
            ->assertCreated()->json('data.number');
        $english = $this->codOrder($this->debidwar())->json('data.number');

        // Bangla confirmation email: Bangla place names, zone + ETA, the cash to keep ready.
        Mail::assertSent(OrderPlacedMail::class, function ($mail) use ($bangla) {
            if ($mail->order->number !== $bangla) {
                return false;
            }
            $html = $mail->render();

            return str_contains($html, 'ধানমন্ডি, ঢাকা') && str_contains($html, 'ঢাকার ভেতরে') && str_contains($html, '১–২ দিনে ডেলিভারি')
                && str_contains($html, 'প্রস্তুত রাখুন') && str_contains($html, 'ক্যাশ অন ডেলিভারি ফি');
        });

        $pdf = $this->admin('GET', "/api/admin/v1/orders/{$bangla}/packing-slip.pdf")->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->assertStringStartsWith('%PDF-', $pdf->getContent());
        $html = app(PackingSlips::class)->html(Order::where('number', $bangla)->get());
        foreach ([$bangla, '+8801712345678', 'Dhanmondi, Dhaka', 'ধানমন্ডি, ঢাকা', '৳1,080.00', 'Inside Dhaka', 'Desk Lamp', 'Noto Sans Bengali'] as $text) {
            $this->assertStringContainsString($text, $html);
        }
        $this->assertStringNotContainsString('1,000.00', $html, 'no prices on a packing slip');
        $this->admin('POST', '/api/admin/v1/orders/packing-slips', ['numbers' => [$bangla, strtolower($english)]])->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->admin('POST', '/api/admin/v1/orders/packing-slips', ['numbers' => [$bangla, 'BN-1']])->assertUnprocessable()->assertJsonValidationErrors('numbers');

        $csv = $this->admin('GET', "/api/admin/v1/orders/export/courier.csv?numbers={$bangla},{$english}")->assertOk();
        $body = $csv->getContent();
        $this->assertStringStartsWith("\xEF\xBB\xBF", $body);
        $rows = array_map('str_getcsv', explode("\n", trim(substr($body, 3))));
        $this->assertSame(['invoice', 'recipient_name', 'recipient_phone', 'recipient_address', 'district', 'area', 'cod_amount', 'weight_kg', 'note'], $rows[0]);
        $this->assertSame([$bangla, 'রহিম উদ্দিন', '01712345678', 'House 12, Road 5, Dhanmondi, Dhaka, Dhaka', 'Dhaka', 'Dhanmondi', '1080.00', '1.50', 'Inside Dhaka'], $rows[1]);
        $this->assertSame([$english, 'Cumilla', 'Debidwar', '1140.00'], [$rows[2][0], $rows[2][4], $rows[2][5], $rows[2][6]]);
        $this->assertCount(2, array_filter(explode("\n", trim($this->admin('GET', '/api/admin/v1/orders/export/courier.csv?delivery_zone=outside_dhaka')->getContent()))));
    }
}
