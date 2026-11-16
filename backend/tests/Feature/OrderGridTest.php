<?php

namespace Tests\Feature;

use App\Mail\InvoiceMail;
use App\Mail\OrderStatusMail;
use App\Mail\ShipmentMail;
use App\Models\Admin;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 6: order grid mass actions, CSV export, the shipments list, and packing slips. */
class OrderGridTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Product $lamp;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->lamp = $this->product(['price' => '25.00', 'stock_quantity' => 50]);
    }

    private function order(string $payment = 'card', array $overrides = []): string
    {
        $this->app['auth']->forgetGuards();

        return $this->placeOrder([['product_id' => $this->lamp->id, 'quantity' => 1]], ['payment_method' => $payment, ...$overrides])
            ->assertCreated()->json('data.number');
    }

    private function bulk(array $body, ?array $headers = null)
    {
        return $this->asAdmin($headers ?? $this->admin, 'POST', '/api/admin/v1/orders/bulk', $body);
    }

    public function test_bulk_invoice_handles_each_order_on_its_own(): void
    {
        $a = $this->order();
        $b = $this->order();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$b}/invoices", ['notify_customer' => false])->assertCreated();
        $c = $this->order();
        Mail::fake();

        $this->bulk(['numbers' => [$a, $b, strtolower($c), 'BN-1'], 'action' => 'invoice'])->assertOk()->assertExactJson(['data' => [
            'done' => [$a, $c],
            'skipped' => [
                ['number' => $b, 'reason' => 'This order has already been invoiced.'],
                ['number' => 'BN-1', 'reason' => 'Order not found.'],
            ],
        ]]);
        $this->assertSame(['paid', 'paid', 'paid'], Order::whereIn('number', [$a, $b, $c])->orderBy('id')->pluck('payment_status')->all());
        Mail::assertSent(InvoiceMail::class, 2);
    }

    public function test_bulk_ship_and_cancel(): void
    {
        $paid = $this->order();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$paid}/invoices", ['notify_customer' => false])->assertCreated();
        $cod = $this->order('cod');
        $unpaid = $this->order();

        $this->bulk(['numbers' => [$paid, $cod, $unpaid], 'action' => 'ship'])->assertUnprocessable()->assertJsonValidationErrors('carrier');
        $this->bulk(['numbers' => [$paid, $cod, $unpaid], 'action' => 'ship', 'carrier' => 'ups', 'notify_customer' => false])->assertOk()
            ->assertJsonPath('data.done', [$paid, $cod])
            ->assertJsonPath('data.skipped', [['number' => $unpaid, 'reason' => 'Invoice this order before shipping it: it hasn\'t been paid yet.']]);
        $this->assertSame('ups', Order::where('number', $cod)->sole()->shipments->sole()->carrier);
        $this->assertNull(Order::where('number', $cod)->sole()->shipments->sole()->tracking_number);
        Mail::assertNotSent(ShipmentMail::class);

        $stock = $this->lamp->fresh()->stock_quantity;
        $this->bulk(['numbers' => [$unpaid, $paid], 'action' => 'cancel'])->assertOk()
            ->assertJsonPath('data.done', [$unpaid])
            ->assertJsonPath('data.skipped.0.number', $paid);
        $this->assertSame('cancelled', Order::where('number', $unpaid)->sole()->status);
        $this->assertSame($stock + 1, $this->lamp->fresh()->stock_quantity);
        Mail::assertSent(OrderStatusMail::class, 1);
        $this->assertDatabaseHas('audit_log', ['action' => 'order.status_changed', 'subject_id' => Order::where('number', $unpaid)->sole()->id]);

        $this->bulk(['numbers' => [], 'action' => 'cancel'])->assertUnprocessable()->assertJsonValidationErrors('numbers');
        $this->bulk(['numbers' => array_map(fn ($i) => "BN-{$i}", range(1, 101)), 'action' => 'cancel'])->assertUnprocessable()->assertJsonValidationErrors('numbers');
        $this->bulk(['numbers' => [$paid], 'action' => 'delete'])->assertUnprocessable()->assertJsonValidationErrors('action');
    }

    public function test_each_bulk_action_needs_its_own_permission(): void
    {
        $number = $this->order();
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        foreach (['invoice' => 'invoices.create', 'ship' => 'shipments.create', 'cancel' => 'orders.edit'] as $action => $permission) {
            $this->bulk(['numbers' => [$number], 'action' => $action, 'carrier' => 'dhl'], $viewer)->assertForbidden()
                ->assertExactJson(['message' => 'Your role doesn\'t allow this.', 'code' => 'permission_denied', 'permission' => $permission]);
        }
        $this->assertSame('pending_payment', Order::sole()->status);
        $invoicer = $this->signInAdmin(Admin::factory()->role(['orders.view', 'invoices.create'])->create());
        $this->bulk(['numbers' => [$number], 'action' => 'invoice'], $invoicer)->assertOk()->assertJsonPath('data.done', [$number]);
        $this->bulk(['numbers' => [$number], 'action' => 'cancel'], $invoicer)->assertForbidden();
    }

    public function test_orders_export_csv_uses_the_filters_and_guards_formulas(): void
    {
        $evil = $this->order('cod', ['email' => 'evil@example.com', 'shipping_address' => [
            ...$this->checkoutBody([])['shipping_address'], 'first_name' => '=cmd|"/c calc"!A1', 'city' => '@SUM(1)',
        ]]);
        $this->order('card');

        $csv = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/orders/export.csv?payment_status=unpaid&search=evil')->assertOk()
            ->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $this->assertStringContainsString('attachment; filename="orders-', $csv->headers->get('Content-Disposition'));
        $lines = array_values(array_filter(explode("\n", $csv->getContent())));
        $this->assertSame('number,placed_at,status,payment_status,source,customer_name,email,phone,customer_group,items,subtotal,discount,shipping,tax,total,'
            .'paid,refunded,payment_method,shipping_method,coupon_code,ship_to_city,ship_to_country', $lines[0]);
        $this->assertCount(2, $lines);
        $this->assertStringStartsWith("{$evil},", $lines[1]);
        $this->assertStringContainsString('"\'=cmd|""/c calc""!A1 Customer"', $lines[1]);
        $this->assertStringContainsString(",'@SUM(1),", $lines[1]);
        $this->assertStringContainsString(',processing,unpaid,storefront,', $lines[1]);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/orders/export.csv?source=nope')->assertUnprocessable();
    }

    public function test_shipments_list_detail_and_packing_slip(): void
    {
        $first = $this->order('cod');
        $second = $this->order('cod');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$first}/shipments", ['carrier' => 'dhl', 'tracking_number' => 'ab123'])->assertCreated();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$second}/shipments", ['carrier' => 'ups'])->assertCreated();

        $all = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/shipments')->assertOk()->assertJsonPath('meta.total', 2);
        $all->assertJsonPath('data.0.order.number', $second)->assertJsonPath('data.0.item_count', 1)
            ->assertJsonPath('data.0.order.ship_to', 'Springfield, United States')->assertJsonMissingPath('data.0.items');
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/shipments?search=AB12')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.tracking_number', 'AB123');
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/shipments?search={$second}")->assertJsonPath('meta.total', 1);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/shipments?carrier=dhl')->assertJsonPath('data.0.order.number', $first);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/shipments?from='.now()->addDay()->format('Y-m-d'))->assertJsonPath('meta.total', 0);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/shipments?to='.now()->format('Y-m-d'))->assertJsonPath('meta.total', 2);

        $number = $all->json('data.1.number');
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/shipments/{$number}")->assertOk()
            ->assertJsonPath('data.items.0.name', $this->lamp->name)
            ->assertJsonPath('data.items.0.quantity', 1)
            ->assertJsonPath('data.order.shipping_address.city', 'Springfield')
            ->assertJsonPath('data.tracking_url', 'https://www.dhl.com/en/express/tracking.html?AWB=AB123');
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/shipments/SHP-1')->assertNotFound();

        $slip = $this->asAdmin($this->admin, 'GET', "/api/admin/v1/orders/{$first}/packing-slip")->assertOk();
        $slip->assertJsonPath('data.order_number', $first)
            ->assertJsonPath('data.items', [['order_item_id' => Order::where('number', $first)->sole()->items->sole()->id, 'sku' => $this->lamp->sku,
                'name' => $this->lamp->name, 'variant_label' => null, 'quantity' => 1]])
            ->assertJsonPath('data.ship_to.line1', '12 Market Street')
            ->assertJsonPath('data.shipments.0.tracking_number', 'AB123')
            ->assertJsonPath('data.store.name', 'BuyNest');
        $this->assertStringNotContainsString('25.00', $slip->getContent()); // no prices
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/orders/BN-1/packing-slip')->assertNotFound();
    }
}
