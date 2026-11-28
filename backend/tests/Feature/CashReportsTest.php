<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AuditLog;
use App\Models\CourierPayout;
use App\Models\CreditMemo;
use App\Models\DeliveryZone;
use App\Models\Invoice;
use App\Models\Order;
use App\Models\Shipment;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\BangladeshAddresses;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Phase 21: sales and cash reports in a taka store (docs/backend/PHASE21_CONTRACT.md):
 * the store time zone, sales by payment method and delivery zone, money in by
 * channel, cash on delivery per courier, what is still to collect, courier
 * payments, the backfill of existing invoices, and the CSVs.
 *
 * The courier is a Steadfast stand-in (Http::fake, no stray requests).
 */
class CashReportsTest extends TestCase
{
    use BangladeshAddresses, PlacesOrders, RefreshDatabase;

    private const STEADFAST = 'https://steadfast.test/api/v1';

    private ?array $headers = null;

    private int $consignments = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'buynest.store.currency' => 'BDT',
            'buynest.couriers.steadfast' => ['api_key' => 'sf-key', 'secret_key' => 'sf-secret', 'api_url' => self::STEADFAST, 'webhook_token' => 'sf-hook'],
        ]);
        Http::preventStrayRequests();
        Http::fake(function (Request $request) {
            $path = substr((string) parse_url($request->url(), PHP_URL_PATH), strlen('/api/v1'));

            return $path === '/create_order'
                ? Http::response(['status' => 200, 'message' => 'Consignment has been created successfully.', 'consignment' => [
                    'consignment_id' => 5000 + (++$this->consignments), 'invoice' => $request['invoice'], 'tracking_code' => "SF{$this->consignments}X",
                    'status' => 'in_review']])
                : Http::response(['status' => 404], 404);
        });
    }

    private function admin(string $method, string $uri, array $body = [])
    {
        $this->headers ??= $this->adminHeaders();

        return $this->asAdmin($this->headers, $method, $uri, $body);
    }

    /** A bare taka order (no items) with these fields. */
    private function order(array $attributes = []): Order
    {
        return Order::factory()->create(['currency' => 'BDT', 'placed_at' => '2026-11-01 12:00:00', ...$attributes])->fresh();
    }

    private function invoice(Order $order, string $amount, string $at, array $attributes = []): Invoice
    {
        $invoice = Invoice::create(['order_id' => $order->id, 'amount' => $amount, 'note' => 'Paid.', 'customer_notified' => false, ...$attributes]);
        $invoice->forceFill(['number' => Invoice::numberFor($invoice->id), 'created_at' => $at])->save();

        return $invoice;
    }

    private function memo(Order $order, string $total, string $at): void
    {
        $memo = CreditMemo::create(['order_id' => $order->id, 'subtotal' => $total, 'shipping_refund' => '0.00', 'adjustment' => '0.00', 'total' => $total,
            'restocked' => false, 'customer_notified' => false]);
        $memo->forceFill(['created_at' => $at])->save();
    }

    private function shipment(Order $order, string $carrier, string $status, array $attributes = []): Shipment
    {
        $shipment = Shipment::create(['order_id' => $order->id, 'carrier' => $carrier, 'tracking_number' => null, 'customer_notified' => false]);
        $shipment->forceFill(['number' => Shipment::numberFor($shipment->id), 'delivery_status' => $status, 'created_at' => '2026-11-02 10:00:00',
            'status_updated_at' => '2026-11-03 10:00:00', ...$attributes])->save();

        return $shipment;
    }

    private function timezone(string $zone): void
    {
        app(Settings::class)->put(['store_timezone' => $zone]);
    }

    private function payout(array $body)
    {
        return $this->admin('POST', '/api/admin/v1/courier-payouts', ['carrier' => 'steadfast', 'amount' => '600.00', 'received_on' => '2026-11-20', ...$body]);
    }

    // ---- time zone ----

    public function test_the_time_zone_setting(): void
    {
        $this->admin('GET', '/api/admin/v1/settings')->assertOk()->assertJsonPath('data.general.store_timezone', 'UTC');
        $this->admin('PATCH', '/api/admin/v1/settings', ['general' => ['store_timezone' => 'Mars/Olympus']])->assertUnprocessable()
            ->assertJsonPath('errors', ['general.store_timezone' => ['Choose a time zone from the list, such as Asia/Dhaka.']]);
        $this->admin('PATCH', '/api/admin/v1/settings', ['general' => ['store_timezone' => 'Asia/Dhaka']])->assertOk()
            ->assertJsonPath('data.general.store_timezone', 'Asia/Dhaka');
        $this->assertTrue(AuditLog::where('action', 'settings.updated')->exists());
    }

    public function test_dhaka_moves_a_late_evening_order_to_the_next_day_and_keeps_the_range_edges(): void
    {
        $this->order(['placed_at' => '2026-11-01 20:00:00', 'grand_total' => '100.00']); // 02:00 on 11-02 in Dhaka
        $this->order(['placed_at' => '2026-10-31 19:00:00', 'grand_total' => '10.00']);  // 01:00 on 11-01 in Dhaka
        $this->order(['placed_at' => '2026-11-03 18:30:00', 'grand_total' => '1.00']);   // 00:30 on 11-04 in Dhaka
        $sales = fn () => $this->admin('GET', '/api/admin/v1/reports/sales?from=2026-11-01&to=2026-11-03')->assertOk();

        $utc = $sales()->assertJsonPath('meta.timezone', 'UTC');
        $this->assertSame(['100.00', '0.00', '1.00'], array_column($utc->json('data.series'), 'gross'));
        $this->assertSame('101.00', $utc->json('data.totals.gross'));

        $this->timezone('Asia/Dhaka');
        $dhaka = $sales()->assertJsonPath('meta.timezone', 'Asia/Dhaka');
        $this->assertSame(['10.00', '100.00', '0.00'], array_column($dhaka->json('data.series'), 'gross'));
        $this->assertSame('110.00', $dhaka->json('data.totals.gross'));
    }

    public function test_week_and_month_periods_and_the_default_range_follow_the_time_zone(): void
    {
        $this->timezone('Asia/Dhaka');
        $this->order(['placed_at' => '2026-11-01 20:00:00']); // Sunday in UTC, Monday 11-02 in Dhaka
        $this->order(['placed_at' => '2026-11-30 20:00:00']); // 2026-12-01 in Dhaka

        $weeks = $this->admin('GET', '/api/admin/v1/reports/sales?from=2026-10-26&to=2026-11-08&group_by=week')->assertOk()->json('data.series');
        $this->assertSame([['2026-10-26', 0], ['2026-11-02', 1]], array_map(fn ($row) => [$row['period'], $row['orders']], $weeks));
        $months = $this->admin('GET', '/api/admin/v1/reports/sales?from=2026-11-01&to=2026-12-31&group_by=month')->assertOk()->json('data.series');
        $this->assertSame([['2026-11', 1], ['2026-12', 1]], array_map(fn ($row) => [$row['period'], $row['orders']], $months));

        // At 20:00 UTC it is already tomorrow in Dhaka: the default range and the dashboard chart end there.
        $this->travelTo('2026-11-28 20:00:00');
        $this->headers = null; // sign in again at the new time
        $this->order(['placed_at' => '2026-11-28 19:00:00', 'grand_total' => '75.00']);
        $this->admin('GET', '/api/admin/v1/reports/sales')->assertOk()->assertJsonPath('meta.to', '2026-11-29')->assertJsonPath('meta.from', '2026-10-31');
        $chart = $this->admin('GET', '/api/admin/v1/overview')->assertOk()->json('data.revenue_chart');
        $this->assertCount(30, $chart);
        $this->assertSame(['date' => '2026-11-29', 'orders' => 1, 'revenue' => '75.00'], end($chart));

        $this->timezone('UTC');
        $chart = $this->admin('GET', '/api/admin/v1/overview')->assertOk()->json('data.revenue_chart');
        $this->assertSame(['date' => '2026-11-28', 'orders' => 1, 'revenue' => '75.00'], end($chart));
    }

    // ---- sales breakdowns ----

    public function test_sales_by_payment_method_and_delivery_zone_add_up_to_the_totals(): void
    {
        $a = $this->order(['payment_method' => 'cod', 'delivery_zone_code' => 'inside_dhaka', 'grand_total' => '1060.00']);
        $this->order(['payment_method' => 'cod', 'grand_total' => '500.00', 'placed_at' => '2026-11-02 12:00:00']);
        $sslcommerz = ['payment_method' => 'sslcommerz', 'payment_provider' => 'sslcommerz', 'payment_reference' => 'BT'];
        $this->order([...$sslcommerz, 'payment_details' => ['card_type' => 'BKASH-BKash'], 'delivery_zone_code' => 'inside_dhaka', 'grand_total' => '300.00']);
        $this->order([...$sslcommerz, 'payment_details' => ['card_type' => 'VISA-Dutch Bangla'], 'delivery_zone_code' => 'outside_dhaka', 'grand_total' => '1200.00']);
        $this->order(['payment_method' => 'sslcommerz', 'grand_total' => '100.00']); // not paid yet: method unknown
        // A COD order whose advance went through SSLCommerz stays cash on delivery.
        $this->order(['payment_method' => 'cod', 'payment_provider' => 'sslcommerz', 'payment_details' => ['card_type' => 'NAGAD-Nagad'],
            'delivery_zone_code' => 'dhaka_suburbs', 'grand_total' => '900.00']);
        $usd = $this->order(['payment_method' => 'card', 'currency' => 'USD', 'grand_total' => '50.00']);
        $this->order(['status' => 'cancelled', 'grand_total' => '999.00']);
        $this->memo($a, '60.00', '2026-11-03 09:00:00');
        $this->memo($usd, '5.00', '2026-11-03 09:00:00');

        $data = $this->admin('GET', '/api/admin/v1/reports/sales?from=2026-11-01&to=2026-11-03')->assertOk()->json('data');
        $this->assertSame(['orders' => 6, 'gross' => '4060.00', 'refunds' => '60.00', 'net' => '4000.00'],
            array_intersect_key($data['totals'], array_flip(['orders', 'gross', 'refunds', 'net'])));
        $this->assertSame([
            ['method' => 'cod', 'label' => 'Cash on delivery', 'orders' => 3, 'gross' => '2460.00', 'refunds' => '60.00', 'net' => '2400.00'],
            ['method' => 'sslcommerz:card', 'label' => 'Card (SSLCommerz)', 'orders' => 1, 'gross' => '1200.00', 'refunds' => '0.00', 'net' => '1200.00'],
            ['method' => 'sslcommerz:bkash', 'label' => 'bKash (SSLCommerz)', 'orders' => 1, 'gross' => '300.00', 'refunds' => '0.00', 'net' => '300.00'],
            ['method' => 'sslcommerz:other', 'label' => 'Other (SSLCommerz)', 'orders' => 1, 'gross' => '100.00', 'refunds' => '0.00', 'net' => '100.00'],
        ], $data['by_payment_method']);
        $this->assertSame([
            ['zone_code' => 'inside_dhaka', 'name' => 'Inside Dhaka', 'orders' => 2, 'gross' => '1360.00', 'refunds' => '60.00', 'net' => '1300.00'],
            ['zone_code' => 'outside_dhaka', 'name' => 'Outside Dhaka', 'orders' => 1, 'gross' => '1200.00', 'refunds' => '0.00', 'net' => '1200.00'],
            ['zone_code' => 'dhaka_suburbs', 'name' => 'Dhaka suburbs', 'orders' => 1, 'gross' => '900.00', 'refunds' => '0.00', 'net' => '900.00'],
            ['zone_code' => null, 'name' => 'No zone (outside Bangladesh or a free-text address)', 'orders' => 2, 'gross' => '600.00', 'refunds' => '0.00',
                'net' => '600.00'],
        ], $data['by_delivery_zone']);
        $this->assertSame('Inside Dhaka', DeliveryZone::where('code', 'inside_dhaka')->value('name'));

        foreach (['by_payment_method', 'by_delivery_zone'] as $breakdown) {
            foreach (['gross', 'refunds', 'net'] as $field) {
                $this->assertSame($data['totals'][$field], number_format(array_sum(array_column($data[$breakdown], $field)), 2, '.', ''), "{$breakdown} {$field}");
            }
            $this->assertSame($data['totals']['orders'], array_sum(array_column($data[$breakdown], 'orders')));
        }
        // The dollar order is listed on its own, never added in.
        $this->assertSame([['currency' => 'USD', 'orders' => 1, 'gross' => '50.00', 'refunds' => '5.00', 'net' => '45.00']], $data['other_currencies']);
    }

    // ---- money in ----

    public function test_payments_by_channel_with_refunds_and_zero_filled_days(): void
    {
        $staff = Admin::factory()->create();
        $card = $this->order(['payment_method' => 'card', 'payment_provider' => 'stripe', 'payment_reference' => 'pi_1', 'grand_total' => '500.00']);
        $this->invoice($card, '500.00', '2026-11-01 10:00:00');
        $bkash = $this->order(['payment_method' => 'sslcommerz', 'payment_provider' => 'sslcommerz', 'payment_reference' => 'BT1',
            'payment_details' => ['card_type' => 'BKASH-BKash'], 'grand_total' => '300.00']);
        $this->invoice($bkash, '300.00', '2026-11-01 11:00:00');
        // One COD order: the advance online, then the courier's cash. Each counted once, on its own day.
        $cod = $this->order(['payment_method' => 'cod', 'payment_provider' => 'sslcommerz', 'payment_reference' => 'BT2',
            'payment_details' => ['card_type' => 'NAGAD-Nagad'], 'grand_total' => '1080.00']);
        $this->invoice($cod, '80.00', '2026-11-01 12:00:00', ['kind' => 'advance']);
        $this->invoice($cod, '1000.00', '2026-11-03 12:00:00', ['kind' => 'cod_collection', 'collected_via' => 'steadfast']);
        $byStaff = $this->order(['payment_method' => 'cod', 'grand_total' => '700.00']);
        $this->invoice($byStaff, '700.00', '2026-11-02 12:00:00', ['kind' => 'cod_collection', 'collected_via' => 'staff', 'admin_id' => $staff->id]);
        $bank = $this->order(['payment_method' => 'bank_transfer', 'grand_total' => '200.00']);
        $this->invoice($bank, '200.00', '2026-11-02 13:00:00', ['admin_id' => $staff->id]);
        // A gift card paid 150 of a 400 card order: Stripe brought 250.
        $gift = $this->order(['payment_method' => 'card', 'payment_provider' => 'stripe', 'payment_reference' => 'pi_2', 'grand_total' => '400.00',
            'gift_card_amount' => '150.00']);
        $this->invoice($gift, '400.00', '2026-11-02 14:00:00');
        $points = $this->order(['payment_method' => 'reward_points', 'payment_provider' => 'reward_points', 'grand_total' => '50.00',
            'reward_points_amount' => '50.00']);
        $this->invoice($points, '50.00', '2026-11-02 15:00:00');
        $usd = $this->order(['payment_method' => 'card', 'payment_provider' => 'stripe', 'payment_reference' => 'pi_3', 'currency' => 'USD', 'grand_total' => '20.00']);
        $this->invoice($usd, '20.00', '2026-11-01 10:00:00');
        $this->memo($card, '100.00', '2026-11-03 16:00:00');
        $this->memo($usd, '5.00', '2026-11-03 16:00:00');
        $this->invoice($card, '1.00', '2026-11-05 10:00:00'); // outside the range

        $response = $this->admin('GET', '/api/admin/v1/reports/payments?from=2026-11-01&to=2026-11-04')->assertOk()
            ->assertJsonPath('meta', ['from' => '2026-11-01', 'to' => '2026-11-04', 'group_by' => 'day', 'currency' => 'BDT', 'timezone' => 'UTC']);
        $data = $response->json('data');
        $this->assertSame(['received' => '3230.00', 'online' => '1130.00', 'cod_cash' => '1700.00', 'other' => '400.00', 'refunds' => '100.00',
            'net_received' => '3130.00'], $data['totals']);
        $this->assertSame([
            ['channel' => 'cash:steadfast', 'label' => 'Cash collected by Steadfast', 'amount' => '1000.00', 'count' => 1],
            ['channel' => 'stripe', 'label' => 'Card (Stripe)', 'amount' => '750.00', 'count' => 2],
            ['channel' => 'cash:staff', 'label' => 'Cash collected by staff', 'amount' => '700.00', 'count' => 1],
            ['channel' => 'sslcommerz:bkash', 'label' => 'bKash (SSLCommerz)', 'amount' => '300.00', 'count' => 1],
            ['channel' => 'other', 'label' => 'Recorded by staff (no payment provider)', 'amount' => '200.00', 'count' => 1],
            ['channel' => 'gift_card', 'label' => 'Gift cards', 'amount' => '150.00', 'count' => 1],
            ['channel' => 'advance', 'label' => 'Cash on delivery advances (paid online)', 'amount' => '80.00', 'count' => 1],
            ['channel' => 'reward_points', 'label' => 'Reward points', 'amount' => '50.00', 'count' => 1],
        ], $data['channels']);
        $this->assertSame([
            ['period' => '2026-11-01', 'online' => '880.00', 'cod_cash' => '0.00', 'other' => '0.00', 'refunds' => '0.00', 'net_received' => '880.00'],
            ['period' => '2026-11-02', 'online' => '250.00', 'cod_cash' => '700.00', 'other' => '400.00', 'refunds' => '0.00', 'net_received' => '1350.00'],
            ['period' => '2026-11-03', 'online' => '0.00', 'cod_cash' => '1000.00', 'other' => '0.00', 'refunds' => '100.00', 'net_received' => '900.00'],
            ['period' => '2026-11-04', 'online' => '0.00', 'cod_cash' => '0.00', 'other' => '0.00', 'refunds' => '0.00', 'net_received' => '0.00'],
        ], $data['series']);
        $this->assertSame([['currency' => 'USD', 'received' => '20.00', 'count' => 1, 'refunds' => '5.00', 'net_received' => '15.00']], $data['other_currencies']);
        $this->assertSame($data['totals']['received'], number_format(array_sum(array_column($data['channels'], 'amount')), 2, '.', ''));

        // The CSV: a BOM, the series, one row per day.
        $csv = $this->admin('GET', '/api/admin/v1/reports/payments.csv?from=2026-11-01&to=2026-11-04')->assertOk();
        $this->assertSame('attachment; filename="money-in-2026-11-01-to-2026-11-04.csv"', $csv->headers->get('Content-Disposition'));
        $this->assertStringStartsWith("\xEF\xBB\xBFperiod,online,cod_cash,other,refunds,net_received\n2026-11-01,880.00,0.00,0.00,0.00,880.00\n", $csv->getContent());
        $this->assertCount(5, explode("\n", trim($csv->getContent())));
    }

    // ---- cash on delivery ----

    public function test_a_courier_collection_is_marked_and_payouts_reduce_what_it_owes(): void
    {
        app(Settings::class)->put(['free_shipping_threshold' => '100000.00', 'enabled_payment_methods' => ['cod']]);
        $this->zoneRates();
        $lamp = $this->product(['price' => '1000.00', 'stock_quantity' => 10, 'name' => 'Desk Lamp', 'weight' => 1500]);
        $number = $this->placeOrder([['product_id' => $lamp->id, 'quantity' => 1]], ['payment_method' => 'cod', 'phone' => '01712 345678',
            'email' => 'rahim@example.com', 'shipping_address' => $this->bdAddress()])->assertCreated()->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/courier-booking", ['courier' => 'steadfast'])->assertCreated();
        $this->postJson('/api/v1/couriers/steadfast/webhook', ['notification_type' => 'delivery_status', 'consignment_id' => 5001, 'invoice' => $number,
            'status' => 'delivered', 'cod_amount' => 1060, 'delivery_charge' => 60], ['Authorization' => 'Bearer sf-hook'])->assertOk();

        $invoice = Invoice::sole();
        $this->assertSame(['cod_collection', 'steadfast', '1060.00'], [$invoice->kind, $invoice->collected_via, $invoice->amount]);
        $today = now()->toDateString();
        $cod = fn () => $this->admin('GET', "/api/admin/v1/reports/cod?from={$today}&to={$today}")->assertOk();
        $cod()->assertJsonPath('data.period', [['carrier' => 'steadfast', 'label' => 'Steadfast', 'shipped' => 1, 'delivered' => 1, 'returned' => 0,
            'cancelled' => 0, 'collected' => '1060.00', 'fees' => '60.00', 'fees_reported' => true, 'payouts' => '0.00']])
            ->assertJsonPath('data.balances', [['carrier' => 'steadfast', 'label' => 'Steadfast', 'collected_all_time' => '1060.00', 'fees_all_time' => '60.00',
                'fees_reported' => true, 'payouts_all_time' => '0.00', 'owed' => '1000.00', 'note' => null, 'last_payout_on' => null]])
            ->assertJsonPath('data.outstanding', ['orders' => 0, 'amount' => '0.00'])
            ->assertJsonPath('data.staff', ['collected' => '0.00'])
            ->assertJsonPath('data.currency', 'BDT');

        $this->payout(['amount' => '600', 'received_on' => $today, 'reference' => 'BKASH-TX1'])->assertCreated();
        $cod()->assertJsonPath('data.balances.0.owed', '400.00')->assertJsonPath('data.balances.0.last_payout_on', $today)
            ->assertJsonPath('data.period.0.payouts', '600.00');
        $second = $this->payout(['amount' => '500', 'received_on' => $today])->assertCreated()->json('data.id');
        $cod()->assertJsonPath('data.balances.0.owed', '-100.00')->assertJsonPath('data.balances.0.note', 'paid_more_than_recorded');

        // A deleted payment no longer counts (it is kept, soft deleted, for the audit trail).
        $this->admin('DELETE', "/api/admin/v1/courier-payouts/{$second}")->assertNoContent();
        $cod()->assertJsonPath('data.balances.0.owed', '400.00')->assertJsonPath('data.balances.0.note', null);
        $this->assertNotNull(CourierPayout::withTrashed()->find($second)->deleted_at);
    }

    public function test_staff_recording_the_cash_of_a_courier_parcel_counts_on_that_courier(): void
    {
        app(Settings::class)->put(['free_shipping_threshold' => '100000.00', 'enabled_payment_methods' => ['cod']]);
        $lamp = $this->product(['price' => '1000.00', 'stock_quantity' => 10]);
        $deliver = function (string $carrier) use ($lamp) {
            $number = $this->placeOrder([['product_id' => $lamp->id, 'quantity' => 1]], ['payment_method' => 'cod'])->assertCreated()->json('data.number');
            $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => $carrier])->assertCreated();
            $due = Order::where('number', $number)->value('grand_total');
            $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered', 'collected_amount' => $due])->assertOk();

            return [Order::where('number', $number)->sole()->invoices()->sole(), $due];
        };

        // RedX took the parcel by hand (no API): staff record the cash, but RedX has it until it pays the shop.
        [$redx, $due] = $deliver('redx');
        $this->assertSame(['cod_collection', 'redx'], [$redx->kind, $redx->collected_via]);
        // The shop's own delivery ("other"): staff have the cash.
        [$own] = $deliver('other');
        $this->assertSame(['cod_collection', 'staff'], [$own->kind, $own->collected_via]);

        $today = now()->toDateString();
        $cod = fn () => $this->admin('GET', "/api/admin/v1/reports/cod?from={$today}&to={$today}")->assertOk();
        $cod()->assertJsonPath('data.staff', ['collected' => $due])
            ->assertJsonPath('data.period', [['carrier' => 'redx', 'label' => 'RedX', 'shipped' => 1, 'delivered' => 0, 'returned' => 0, 'cancelled' => 0,
                'collected' => $due, 'fees' => null, 'fees_reported' => false, 'payouts' => '0.00']])
            ->assertJsonPath('data.balances', [['carrier' => 'redx', 'label' => 'RedX', 'collected_all_time' => $due, 'fees_all_time' => null,
                'fees_reported' => false, 'payouts_all_time' => '0.00', 'owed' => $due, 'note' => null, 'last_payout_on' => null]]);
        $channels = collect($this->admin('GET', "/api/admin/v1/reports/payments?from={$today}&to={$today}")->assertOk()->json('data.channels'))
            ->pluck('amount', 'channel')->all();
        $this->assertSame(['cash:redx' => $due, 'cash:staff' => $due], $channels);

        // RedX pays the cash minus the fee it kept: nothing left owed, and no "paid more than recorded".
        $this->payout(['carrier' => 'redx', 'amount' => number_format((float) $due - 60, 2, '.', ''), 'fees' => '60', 'received_on' => $today])->assertCreated();
        $cod()->assertJsonPath('data.balances.0.fees_all_time', '60.00')->assertJsonPath('data.balances.0.fees_reported', true)
            ->assertJsonPath('data.balances.0.owed', '0.00')->assertJsonPath('data.balances.0.note', null)
            ->assertJsonPath('data.balances.0.last_payout_on', $today);
    }

    public function test_fees_reported_or_not_and_returned_and_cancelled_counts(): void
    {
        // RedX reports no fee per parcel: "Not reported" (null), never 0.
        $redx = $this->order(['payment_method' => 'cod', 'status' => 'delivered', 'payment_status' => 'paid', 'cod_due' => '0.00', 'grand_total' => '500.00']);
        $this->shipment($redx, 'redx', 'delivered');
        $this->invoice($redx, '500.00', '2026-11-03 12:00:00', ['kind' => 'cod_collection', 'collected_via' => 'redx']);
        $returned = $this->order(['payment_method' => 'cod', 'status' => 'shipped', 'cod_due' => '300.00', 'grand_total' => '300.00']);
        $this->shipment($returned, 'steadfast', 'returned', ['courier_fee_cents' => 5000]);
        $cancelled = $this->order(['payment_method' => 'cod', 'status' => 'shipped', 'cod_due' => '200.00', 'grand_total' => '200.00']);
        $this->shipment($cancelled, 'steadfast', 'cancelled', ['courier_fee_cents' => 6000]); // a cancelled booking costs nothing

        $report = fn () => $this->admin('GET', '/api/admin/v1/reports/cod?from=2026-11-01&to=2026-11-05')->assertOk();
        $data = $report()->json('data');
        $this->assertSame([
            ['carrier' => 'steadfast', 'label' => 'Steadfast', 'shipped' => 2, 'delivered' => 0, 'returned' => 1, 'cancelled' => 1, 'collected' => '0.00',
                'fees' => '50.00', 'fees_reported' => true, 'payouts' => '0.00'],
            ['carrier' => 'redx', 'label' => 'RedX', 'shipped' => 1, 'delivered' => 1, 'returned' => 0, 'cancelled' => 0, 'collected' => '500.00',
                'fees' => null, 'fees_reported' => false, 'payouts' => '0.00'],
        ], $data['period']);
        // A return fee and no cash or payments yet: the shop owes Steadfast ৳50 (not "paid more than recorded").
        $this->assertSame(['steadfast', '50.00', true, '-50.00', 'fees_more_than_collected'], [$data['balances'][0]['carrier'],
            $data['balances'][0]['fees_all_time'], $data['balances'][0]['fees_reported'], $data['balances'][0]['owed'], $data['balances'][0]['note']]);
        $this->assertSame(['redx', null, false, '500.00'], [$data['balances'][1]['carrier'], $data['balances'][1]['fees_all_time'],
            $data['balances'][1]['fees_reported'], $data['balances'][1]['owed']]);
        // The returned and the cancelled parcel bring in no cash: nothing is still to collect.
        $this->assertSame(['orders' => 0, 'amount' => '0.00'], $data['outstanding']);

        // Staff type RedX's fee into its payment: now reported.
        $this->payout(['carrier' => 'redx', 'amount' => '470', 'fees' => '30', 'received_on' => '2026-11-04'])->assertCreated();
        $redxBalance = $report()->json('data.balances.1');
        $this->assertSame(['30.00', true, '470.00', '0.00', null, '2026-11-04'], [$redxBalance['fees_all_time'], $redxBalance['fees_reported'],
            $redxBalance['payouts_all_time'], $redxBalance['owed'], $redxBalance['note'], $redxBalance['last_payout_on']]);
    }

    public function test_outstanding_lists_only_shipped_unpaid_cod_orders_oldest_first(): void
    {
        $this->travelTo('2026-11-28 12:00:00');
        $old = $this->order(['payment_method' => 'cod', 'status' => 'shipped', 'cod_due' => '1060.00', 'grand_total' => '1060.00', 'placed_at' => '2026-11-01 10:00:00']);
        $this->shipment($old, 'steadfast', 'in_transit', ['created_at' => '2026-11-10 12:00:00', 'courier_consignment_id' => '=HYPERLINK("x")']);
        $recent = $this->order(['payment_method' => 'cod', 'status' => 'delivered', 'payment_status' => 'partially_paid', 'cod_due' => '560.00',
            'grand_total' => '1060.00', 'placed_at' => '2026-11-20 10:00:00']);
        $this->shipment($recent, 'pathao', 'partly_delivered', ['created_at' => '2026-11-25 12:00:00', 'courier_consignment_id' => 'DL1PT']);
        // Not listed: paid, not shipped yet, cancelled, not COD, and parcels that came back (returned, or cancelled by the courier).
        $back = $this->order(['payment_method' => 'cod', 'status' => 'shipped', 'cod_due' => '640.00', 'grand_total' => '640.00']);
        $this->shipment($back, 'pathao', 'returned');
        $called = $this->order(['payment_method' => 'cod', 'status' => 'shipped', 'cod_due' => '300.00', 'grand_total' => '300.00']);
        $this->shipment($called, 'steadfast', 'cancelled');
        $paid = $this->order(['payment_method' => 'cod', 'status' => 'delivered', 'payment_status' => 'paid', 'cod_due' => '0.00']);
        $this->shipment($paid, 'steadfast', 'delivered');
        $this->order(['payment_method' => 'cod', 'status' => 'processing', 'cod_due' => '500.00']);
        $this->order(['payment_method' => 'cod', 'status' => 'cancelled', 'cod_due' => '500.00']);
        $card = $this->order(['payment_method' => 'card', 'status' => 'shipped']);
        $this->shipment($card, 'steadfast', 'in_transit');

        $this->admin('GET', '/api/admin/v1/reports/cod/outstanding')->assertOk()
            ->assertJsonPath('data', [
                ['number' => $old->number, 'placed_at' => '2026-11-01T10:00:00Z', 'shipped_at' => '2026-11-10T12:00:00Z', 'carrier' => 'steadfast',
                    'consignment_id' => '=HYPERLINK("x")', 'delivery_status' => 'in_transit', 'cod_due' => '1060.00', 'days_since_shipped' => 18],
                ['number' => $recent->number, 'placed_at' => '2026-11-20T10:00:00Z', 'shipped_at' => '2026-11-25T12:00:00Z', 'carrier' => 'pathao',
                    'consignment_id' => 'DL1PT', 'delivery_status' => 'partly_delivered', 'cod_due' => '560.00', 'days_since_shipped' => 3],
            ])
            ->assertJsonPath('meta.total', 2)->assertJsonPath('meta.currency', 'BDT');
        $this->admin('GET', '/api/admin/v1/reports/cod/outstanding?carrier=pathao')->assertOk()->assertJsonPath('data.*.number', [$recent->number]);
        $this->admin('GET', '/api/admin/v1/reports/cod/outstanding?older_than_days=14')->assertOk()->assertJsonPath('data.*.number', [$old->number]);
        $this->admin('GET', '/api/admin/v1/reports/cod/outstanding?per_page=1&page=2')->assertOk()->assertJsonPath('data.*.number', [$recent->number]);
        $this->admin('GET', '/api/admin/v1/reports/cod/outstanding?carrier=mars&older_than_days=-1')->assertUnprocessable()
            ->assertJsonPath('errors.carrier.0', 'Choose a courier from the list.')->assertJsonPath('errors.older_than_days.0', 'Enter a number of days (0 or more).');
        $this->admin('GET', '/api/admin/v1/reports/cod?from=2026-11-01&to=2026-11-28')->assertOk()
            ->assertJsonPath('data.outstanding', ['orders' => 2, 'amount' => '1620.00']);

        // The CSV: BOM, every row, and a courier's text can't run as a formula.
        $csv = $this->admin('GET', '/api/admin/v1/reports/cod/outstanding.csv')->assertOk();
        $this->assertSame('attachment; filename="cod-to-collect-2026-11-28.csv"', $csv->headers->get('Content-Disposition'));
        $lines = explode("\n", trim($csv->getContent()));
        $this->assertSame("\xEF\xBB\xBFnumber,placed_at,shipped_at,carrier,consignment_id,delivery_status,cod_due,days_since_shipped", $lines[0]);
        $this->assertSame("{$old->number},2026-11-01T10:00:00Z,2026-11-10T12:00:00Z,steadfast,\"'=HYPERLINK(\"\"x\"\")\",in_transit,1060.00,18", $lines[1]);
        $this->assertCount(3, $lines);
    }

    public function test_the_courier_balances_csv(): void
    {
        $order = $this->order(['payment_method' => 'cod', 'status' => 'delivered', 'payment_status' => 'paid', 'cod_due' => '0.00']);
        $this->shipment($order, 'redx', 'delivered');
        $this->invoice($order, '500.00', '2026-11-03 12:00:00', ['kind' => 'cod_collection', 'collected_via' => 'redx']);

        $csv = $this->admin('GET', '/api/admin/v1/reports/cod.csv')->assertOk();
        $this->assertStringStartsWith('text/csv', $csv->headers->get('Content-Type'));
        $this->assertSame("\xEF\xBB\xBFcarrier,courier,collected,fees,paid_to_you,owed,last_payout_on,note\nredx,RedX,500.00,\"Not reported\",0.00,500.00,,\n",
            $csv->getContent());
    }

    // ---- the backfill ----

    public function test_the_backfill_marks_existing_invoices(): void
    {
        $staff = Admin::factory()->create();
        $cash = 'Cash collected on delivery: ৳100.00.';
        // No admin, and the courier reported its (latest) parcel delivered: the courier's.
        $courier = $this->order(['payment_method' => 'cod']);
        $this->shipment($courier, 'other', 'shipped');
        $this->shipment($courier, 'steadfast', 'delivered'); // the latest shipment
        $byCourier = $this->invoice($courier, '100.00', '2026-11-01 10:00:00', ['note' => $cash]);
        // Staff recorded the cash of a courier parcel (RedX, booked by hand): RedX's.
        $redxOrder = $this->order(['payment_method' => 'cod']);
        $this->shipment($redxOrder, 'redx', 'shipped');
        $byStaffForRedx = $this->invoice($redxOrder, '100.00', '2026-11-01 10:00:00', ['note' => $cash, 'admin_id' => $staff->id]);
        // Staff recorded the cash of the shop's own delivery: staff's.
        $ownOrder = $this->order(['payment_method' => 'cod']);
        $this->shipment($ownOrder, 'other', 'shipped');
        $byStaff = $this->invoice($ownOrder, '100.00', '2026-11-01 10:00:00', ['note' => $cash, 'admin_id' => $staff->id]);
        // A staff collection whose admin was deleted (admin_id null), on a hand-delivered parcel.
        $deletedAdmin = $this->order(['payment_method' => 'cod']);
        $this->shipment($deletedAdmin, 'other', 'shipped');
        $orphan = $this->invoice($deletedAdmin, '100.00', '2026-11-01 10:00:00', ['note' => 'Cash collected on delivery: ৳100.00. Short']);
        // No admin, but the courier never reported it delivered.
        $notDelivered = $this->order(['payment_method' => 'cod']);
        $this->shipment($notDelivered, 'pathao', 'in_transit');
        $pending = $this->invoice($notDelivered, '100.00', '2026-11-01 10:00:00', ['note' => $cash]);
        // Marked "staff" before the courier rule (an earlier run): looked at again.
        $earlierOrder = $this->order(['payment_method' => 'cod']);
        $this->shipment($earlierOrder, 'pathao', 'delivered');
        $earlier = $this->invoice($earlierOrder, '100.00', '2026-11-01 10:00:00', ['note' => $cash, 'admin_id' => $staff->id,
            'kind' => 'cod_collection', 'collected_via' => 'staff']);
        $advance = $this->invoice($this->order(), '80.00', '2026-11-01 10:00:00', ['note' => 'Advance delivery charge paid with bKash through SSLCommerz.']);
        $plain = $this->invoice($this->order(), '50.00', '2026-11-01 10:00:00', ['note' => 'Paid by card through Stripe.']);
        $migration = require database_path('migrations/2026_11_28_000100_add_cash_reports.php');

        $this->assertSame(['cod_collection' => 5, 'courier' => 2, 'staff' => 3, 'reclassified' => 1, 'advance' => 1], $migration->backfill());
        $this->assertSame(['cod_collection' => 0, 'courier' => 0, 'staff' => 0, 'reclassified' => 0, 'advance' => 0], $migration->backfill()); // again: nothing new

        $marks = fn (Invoice $invoice) => [$invoice->fresh()->kind, $invoice->fresh()->collected_via];
        $this->assertSame(['cod_collection', 'steadfast'], $marks($byCourier));
        $this->assertSame(['cod_collection', 'redx'], $marks($byStaffForRedx));
        $this->assertSame(['cod_collection', 'staff'], $marks($byStaff));
        $this->assertSame(['cod_collection', 'staff'], $marks($orphan));
        $this->assertSame(['cod_collection', 'staff'], $marks($pending));
        $this->assertSame(['cod_collection', 'pathao'], $marks($earlier));
        $this->assertSame(['advance', null], $marks($advance));
        $this->assertSame([null, null], $marks($plain));
    }

    // ---- courier payments ----

    public function test_recording_a_payment_its_rules_and_the_duplicate_warning(): void
    {
        $this->travelTo('2026-11-28 20:00:00');
        $this->admin('POST', '/api/admin/v1/courier-payouts', ['carrier' => 'dhl', 'amount' => '0', 'fees' => '-1', 'received_on' => '2019-12-31',
            'reference' => str_repeat('x', 101)])->assertUnprocessable()
            ->assertJsonPath('errors', [
                'carrier' => ['Choose a courier from the list.'],
                'amount' => ['The amount must be more than 0.'],
                'fees' => ['Fees can\'t be below 0.'],
                'received_on' => ['The date can\'t be before 2020.'],
                'reference' => ['Keep the reference to 100 characters.'],
            ]);
        $this->admin('POST', '/api/admin/v1/courier-payouts', [])->assertUnprocessable()
            ->assertJsonValidationErrors(['carrier' => 'Choose the courier that paid you.', 'amount' => 'Enter the amount you received.',
                'received_on' => 'Enter the date the money arrived.']);
        $this->payout(['amount' => '12.345'])->assertUnprocessable()->assertJsonPath('errors.amount', ['Use at most 2 decimals.']);
        $this->payout(['received_on' => '2026-11-29'])->assertUnprocessable()->assertJsonPath('errors.received_on', ['The date can\'t be in the future.']);
        // In Dhaka it is already the 29th.
        $this->timezone('Asia/Dhaka');
        $this->payout(['received_on' => '2026-11-29', 'amount' => '1'])->assertCreated();
        $this->timezone('UTC');

        $first = $this->payout(['amount' => '9800', 'fees' => '120.5', 'reference' => '  TX-1  ', 'note' => ''])->assertCreated()
            ->assertJsonPath('data.carrier', 'steadfast')->assertJsonPath('data.carrier_label', 'Steadfast')->assertJsonPath('data.amount', '9800.00')
            ->assertJsonPath('data.fees', '120.50')->assertJsonPath('data.currency', 'BDT')->assertJsonPath('data.received_on', '2026-11-20')
            ->assertJsonPath('data.reference', 'TX-1')->assertJsonPath('data.note', null)->assertJsonPath('data.admin_name', 'Store Admin')
            ->json('data');

        $duplicate = $this->payout(['amount' => '9800.00'])->assertStatus(409)
            ->assertJsonPath('message', 'A payment of ৳9,800.00 from Steadfast on 2026-11-20 is already recorded. Record this one too only if it is a second payment.')
            ->assertJsonPath('duplicate_of', $first);
        $this->assertSame(2, CourierPayout::count());
        $this->payout(['amount' => '9800.00', 'confirm_duplicate' => true])->assertCreated();
        $this->payout(['amount' => '9800.00', 'received_on' => '2026-11-21'])->assertCreated(); // another day: fine
        $this->assertSame(4, CourierPayout::count());
        $this->assertNotNull($duplicate->json('duplicate_of.id'));

        $audit = AuditLog::where('action', 'courier_payout.created')->where('subject_id', $first['id'])->sole();
        $this->assertSame('Payment of ৳9,800.00 from Steadfast received on 2026-11-20 recorded.', $audit->summary);
        $this->assertEquals(['carrier' => 'steadfast', 'amount' => '9800.00', 'fees' => '120.50', 'currency' => 'BDT', 'received_on' => '2026-11-20',
            'reference' => 'TX-1', 'note' => null], $audit->changes['after']);
    }

    public function test_editing_deleting_listing_and_permissions(): void
    {
        $id = $this->payout(['amount' => '600', 'received_on' => '2026-11-20'])->assertCreated()->json('data.id');
        $this->payout(['carrier' => 'pathao', 'amount' => '300', 'received_on' => '2026-11-10'])->assertCreated();

        $this->admin('PATCH', "/api/admin/v1/courier-payouts/{$id}", ['amount' => '650', 'note' => 'Statement 14'])->assertOk()
            ->assertJsonPath('data.amount', '650.00')->assertJsonPath('data.note', 'Statement 14')->assertJsonPath('data.received_on', '2026-11-20');
        $this->admin('PATCH', "/api/admin/v1/courier-payouts/{$id}", ['amount' => '-5'])->assertUnprocessable()
            ->assertJsonPath('errors.amount', ['The amount must be more than 0.']);
        $this->assertEquals(['before' => ['amount' => '600.00', 'note' => null], 'after' => ['amount' => '650.00', 'note' => 'Statement 14']],
            AuditLog::where('action', 'courier_payout.updated')->sole()->changes);
        $this->admin('PATCH', '/api/admin/v1/courier-payouts/999999', ['amount' => '1'])->assertNotFound()
            ->assertJsonPath('message', 'Courier payment not found.');

        $this->admin('GET', '/api/admin/v1/courier-payouts')->assertOk()->assertJsonPath('data.*.carrier', ['steadfast', 'pathao'])
            ->assertJsonPath('meta.total', 2)->assertJsonPath('meta.currency', 'BDT');
        $this->admin('GET', '/api/admin/v1/courier-payouts?carrier=pathao')->assertOk()->assertJsonPath('data.*.amount', ['300.00']);
        $this->admin('GET', '/api/admin/v1/courier-payouts?from=2026-11-15&to=2026-11-30')->assertOk()->assertJsonPath('data.*.id', [$id]);

        $this->admin('DELETE', "/api/admin/v1/courier-payouts/{$id}")->assertNoContent();
        $this->admin('DELETE', "/api/admin/v1/courier-payouts/{$id}")->assertNotFound();
        $this->assertSame('650.00', AuditLog::where('action', 'courier_payout.deleted')->sole()->changes['before']['amount']);
        $this->admin('GET', '/api/admin/v1/courier-payouts')->assertOk()->assertJsonPath('meta.total', 1);

        // A Viewer (reports.view, no cash.manage) sees the reports and payments but can't record them.
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/courier-payouts')->assertOk();
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reports/cod')->assertOk();
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reports/payments')->assertOk();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/courier-payouts', ['carrier' => 'steadfast', 'amount' => '1', 'received_on' => '2026-11-20'])
            ->assertForbidden()->assertJsonPath('permission', 'cash.manage');
        $this->asAdmin($viewer, 'PATCH', '/api/admin/v1/courier-payouts/1', ['amount' => '1'])->assertForbidden();
        $this->asAdmin($viewer, 'DELETE', '/api/admin/v1/courier-payouts/1')->assertForbidden();
        // Sales staff have no reports.view.
        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'GET', '/api/admin/v1/courier-payouts')->assertForbidden()->assertJsonPath('permission', 'reports.view');
        $this->asAdmin($sales, 'GET', '/api/admin/v1/reports/cod/outstanding.csv')->assertForbidden();

        // The permission catalog has the new group.
        $this->admin('GET', '/api/admin/v1/permissions')->assertOk()
            ->assertJsonFragment(['group' => 'cash', 'label' => 'Cash', 'permissions' => [['key' => 'cash.manage', 'label' => 'Record courier payments']]]);
    }

    public function test_the_public_store_info_names_the_store_time_zone(): void
    {
        // The admin reads it on every page, so report periods and payment dates start on the store's today.
        $this->getJson('/api/v1/store')->assertOk()->assertJsonPath('data.timezone', 'UTC');
        app(Settings::class)->put(['store_timezone' => 'Asia/Dhaka']);
        $this->getJson('/api/v1/store')->assertJsonPath('data.timezone', 'Asia/Dhaka');
    }
}
