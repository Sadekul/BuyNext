<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\Coupon;
use App\Models\CreditMemo;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Reports, on these orders (range 2026-11-01 to 2026-11-05):
 *   11-01  guest     A×2                 20.00 + 4.99 shipping = 24.99 (refund of one A, 10.00, on 11-04)
 *   11-02  guest     B×1, cancelled      not counted
 *   11-03  customer  B×2 with NEST10     60.00 − 6.00, free shipping = 54.00
 *   11-03  customer  A×1                 10.00 + 4.99 = 14.99
 *   10-01  other     A×1                 outside the range
 */
class ReportsTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $headers;

    private Product $a;

    private Product $b;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->headers = $this->adminHeaders();
        $this->a = $this->product(['name' => 'Apple Mug', 'sku' => 'A-1', 'price' => '10.00']);
        $this->b = $this->product(['name' => '=HYPERLINK("http://evil.example")', 'sku' => 'B-2', 'price' => '30.00']);
    }

    private function order(string $date, Product $product, int $qty, array $overrides = [], array $headers = []): Order
    {
        $this->app['auth']->forgetGuards();
        $number = $this->placeOrder([['product_id' => $product->id, 'quantity' => $qty]], $overrides, $headers)->assertCreated()->json('data.number');
        $order = Order::where('number', $number)->sole();
        $order->forceFill(['placed_at' => "{$date} 12:00:00"])->save();

        return $order;
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])->json('data.tokens.access_token')];
    }

    private function seedOrders(): void
    {
        $first = $this->order('2026-11-01', $this->a, 2);
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/orders/{$first->number}/invoices")->assertCreated();
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/orders/{$first->number}/credit-memos", [
            'items' => [['order_item_id' => $first->items()->value('id'), 'quantity' => 1]],
        ])->assertCreated();
        CreditMemo::query()->update(['created_at' => '2026-11-04 09:00:00']);

        $cancelled = $this->order('2026-11-02', $this->b, 1);
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/orders/{$cancelled->number}", ['status' => 'cancelled'])->assertOk();

        $regular = Customer::factory()->create(['first_name' => 'Rita', 'last_name' => 'Regular', 'email' => 'rita@example.com']);
        $regular->forceFill(['created_at' => '2026-11-02 10:00:00'])->save();
        $headers = $this->customerHeaders($regular);
        $this->order('2026-11-03', $this->b, 2, ['coupon_code' => 'NEST10', 'email' => 'rita@example.com'], $headers);
        $this->order('2026-11-03', $this->a, 1, ['email' => 'rita@example.com'], $headers);

        $other = Customer::factory()->create(['email' => 'early@example.com']);
        $this->order('2026-10-01', $this->a, 1, ['email' => 'early@example.com'], $this->customerHeaders($other));
    }

    private function report(string $uri)
    {
        return $this->asAdmin($this->headers, 'GET', "/api/admin/v1/reports/{$uri}");
    }

    public function test_sales_by_day_with_every_day_present(): void
    {
        $this->seedOrders();

        $this->report('sales?from=2026-11-01&to=2026-11-05')->assertOk()
            ->assertJsonPath('data.totals', [
                'orders' => 3, 'units' => 5, 'gross' => '93.98', 'discounts' => '6.00', 'shipping' => '9.98', 'tax' => '0.00',
                'refunds' => '10.00', 'net' => '83.98', 'average_order' => '27.99',
            ])
            ->assertJsonPath('data.series', [
                ['period' => '2026-11-01', 'orders' => 1, 'gross' => '24.99', 'refunds' => '0.00', 'net' => '24.99'],
                ['period' => '2026-11-02', 'orders' => 0, 'gross' => '0.00', 'refunds' => '0.00', 'net' => '0.00'],
                ['period' => '2026-11-03', 'orders' => 2, 'gross' => '68.99', 'refunds' => '0.00', 'net' => '68.99'],
                ['period' => '2026-11-04', 'orders' => 0, 'gross' => '0.00', 'refunds' => '10.00', 'net' => '-10.00'],
                ['period' => '2026-11-05', 'orders' => 0, 'gross' => '0.00', 'refunds' => '0.00', 'net' => '0.00'],
            ])
            ->assertJsonPath('meta', ['from' => '2026-11-01', 'to' => '2026-11-05', 'group_by' => 'day', 'currency' => 'USD']);
    }

    public function test_sales_by_week_and_month(): void
    {
        $this->seedOrders();

        // 2026-11-01 is a Sunday: it belongs to the week starting Monday 2026-10-26.
        $weeks = $this->report('sales?from=2026-11-01&to=2026-11-05&group_by=week')->assertOk()->json('data.series');
        $this->assertSame(['2026-10-26', '2026-11-02'], array_column($weeks, 'period'));
        $this->assertSame(['24.99', '58.99'], array_column($weeks, 'net'));

        $months = $this->report('sales?from=2026-09-15&to=2026-11-05&group_by=month')->assertOk()->json('data.series');
        $this->assertSame(['2026-09', '2026-10', '2026-11'], array_column($months, 'period'));
        $this->assertSame([0, 1, 3], array_column($months, 'orders'));
    }

    public function test_date_range_rules(): void
    {
        $this->report('sales?from=2025-01-01&to=2026-01-01')->assertOk(); // 366 days
        $this->report('sales?from=2025-01-01&to=2026-01-02')->assertUnprocessable()->assertJsonValidationErrors('to');
        $this->report('sales?from=2026-11-05&to=2026-11-01')->assertUnprocessable()->assertJsonValidationErrors('to');
        $this->report('sales?from=11/01/2026')->assertUnprocessable()->assertJsonValidationErrors('from');
        $this->report('sales?group_by=year')->assertUnprocessable()->assertJsonValidationErrors('group_by');

        // Default: the last 30 days, today included.
        $response = $this->report('sales')->assertOk();
        $this->assertCount(30, $response->json('data.series'));
        $this->assertSame(now()->toDateString(), $response->json('meta.to'));
        $this->assertSame(now()->subDays(29)->toDateString(), $response->json('meta.from'));
    }

    public function test_best_sellers_customers_and_coupons(): void
    {
        $this->seedOrders();

        $this->report('products?from=2026-11-01&to=2026-11-05')->assertOk()->assertJsonPath('data', [
            ['product_id' => $this->a->id, 'name' => 'Apple Mug', 'sku' => 'A-1', 'units' => 3, 'revenue' => '30.00'],
            ['product_id' => $this->b->id, 'name' => '=HYPERLINK("http://evil.example")', 'sku' => 'B-2', 'units' => 2, 'revenue' => '60.00'],
        ]);
        $this->report('products?from=2026-11-01&to=2026-11-05&limit=1')->assertJsonCount(1, 'data');

        $this->report('customers?from=2026-11-01&to=2026-11-05')->assertOk()->assertJsonPath('data', [
            'new_customers' => 1,
            'returning_customers' => 1,
            'guest_orders' => 1,
            'top_customers' => [['id' => Customer::where('email', 'rita@example.com')->value('id'), 'name' => 'Rita Regular',
                'email' => 'rita@example.com', 'orders' => 2, 'spent' => '68.99']],
        ]);

        $this->report('coupons?from=2026-11-01&to=2026-11-05')->assertOk()->assertJsonPath('data', [
            ['coupon_id' => Coupon::where('code', 'NEST10')->value('id'), 'code' => 'NEST10', 'name' => '10% off your order', 'automatic' => false,
                'uses' => 1, 'discount_total' => '6.00'],
        ]);
    }

    public function test_low_stock_lowest_first(): void
    {
        $this->product(['name' => 'Few', 'stock_quantity' => 3]);
        $this->product(['name' => 'None', 'stock_quantity' => 0]);
        $this->product(['name' => 'Enough', 'stock_quantity' => 10]);

        $this->report('low-stock')->assertOk()
            ->assertJsonPath('data.*.name', ['None', 'Few'])
            ->assertJsonPath('meta.low_stock_threshold', 10);
    }

    public function test_csv_downloads_are_safe_to_open_in_a_spreadsheet(): void
    {
        $this->seedOrders();

        $sales = $this->report('sales.csv?from=2026-11-01&to=2026-11-05')->assertOk();
        $this->assertStringStartsWith('text/csv', $sales->headers->get('Content-Type'));
        $this->assertSame('attachment; filename="sales-2026-11-01-to-2026-11-05.csv"', $sales->headers->get('Content-Disposition'));
        $lines = explode("\n", trim($sales->getContent()));
        $this->assertSame('period,orders,gross,refunds,net', $lines[0]);
        $this->assertSame('2026-11-04,0,0.00,10.00,-10.00', $lines[4]); // a negative amount stays a number
        $this->assertCount(6, $lines);

        $products = $this->report('products.csv?from=2026-11-01&to=2026-11-05')->assertOk();
        $this->assertStringContainsString('attachment;', $products->headers->get('Content-Disposition'));
        $this->assertStringContainsString("{$this->b->id},\"'=HYPERLINK(\"\"http://evil.example\"\")\",B-2,2,60.00", $products->getContent());
    }

    public function test_reports_need_reports_view(): void
    {
        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'GET', '/api/admin/v1/reports/sales.csv')->assertForbidden()->assertJsonPath('permission', 'reports.view');
    }
}
