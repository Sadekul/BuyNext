<?php

namespace Tests\Feature;

use App\Mail\RefundMail;
use App\Models\CreditMemo;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/**
 * Refund math, in cents. The order used by most tests:
 *   tea   3.33 × 3 = 9.99
 *   mug   7.77 × 1 = 7.77     subtotal 17.76, NEST10 −1.78, shipping 4.99, total 20.97
 * Coupon shares (proportional, rounded to the cent, leftover cent to the
 * biggest dropped fraction): tea 1.00, mug 0.78. So tea paid 8.99 (units
 * 2.99, 2.99, and 3.01 for the last one) and mug paid 6.99.
 */
class CreditMemoTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Product $tea;

    private Product $mug;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->tea = $this->product(['price' => '3.33', 'stock_quantity' => 10]);
        $this->mug = $this->product(['price' => '7.77', 'stock_quantity' => 10]);
    }

    private function admin(string $method, string $uri, array $body = [])
    {
        $this->app['auth']->forgetGuards();

        return $this->json($method, $uri, $body, $this->admin);
    }

    /** Places the order above and invoices it; returns [number, tea item id, mug item id]. */
    private function paidOrder(bool $invoice = true): array
    {
        $number = $this->placeOrder([['product_id' => $this->tea->id, 'quantity' => 3], ['product_id' => $this->mug->id, 'quantity' => 1]],
            ['coupon_code' => 'NEST10', 'expected_total' => '20.97'])->assertCreated()->json('data.number');
        if ($invoice) {
            $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        }
        $items = Order::where('number', $number)->sole()->items;

        return [$number, $items[0]->id, $items[1]->id];
    }

    private function refund(string $number, array $items, array $extra = [])
    {
        return $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => array_map(fn ($id, $qty) => ['order_item_id' => $id, 'quantity' => $qty], array_keys($items), $items),
            'shipping_refund' => '0.00', 'adjustment' => '0.00', 'restock' => false, ...$extra,
        ]);
    }

    public function test_the_refundable_limits(): void
    {
        [$number, $tea, $mug] = $this->paidOrder();

        $this->admin('GET', "/api/admin/v1/orders/{$number}/refundable")->assertOk()->assertExactJson(['data' => [
            'items' => [
                ['order_item_id' => $tea, 'name' => $this->tea->name, 'sku' => $this->tea->sku, 'ordered' => 3, 'refunded' => 0, 'refundable' => 3, 'unit_refund' => '2.99', 'variant_label' => null],
                ['order_item_id' => $mug, 'name' => $this->mug->name, 'sku' => $this->mug->sku, 'ordered' => 1, 'refunded' => 0, 'refundable' => 1, 'unit_refund' => '6.99', 'variant_label' => null],
            ],
            'shipping_refundable' => '4.99',
            'max_total' => '20.97',
        ]]);
        $this->admin('GET', '/api/admin/v1/orders/BN-1/refundable')->assertNotFound();
    }

    public function test_a_partial_then_a_full_refund_gives_back_exactly_what_was_paid(): void
    {
        [$number, $tea, $mug] = $this->paidOrder();

        // One tea, restocked.
        $first = $this->refund($number, [$tea => 1, $mug => 0], ['restock' => true, 'note' => 'Damaged box.'])->assertCreated();
        $memo = CreditMemo::sole();
        $first->assertJsonPath('data', [
            'number' => 'CM-'.(100000 + $memo->id), 'order_number' => $number, 'return_number' => null,
            'items' => [['order_item_id' => $tea, 'name' => $this->tea->name, 'variant_label' => null, 'sku' => $this->tea->sku, 'quantity' => 1, 'amount' => '2.99']],
            'subtotal' => '2.99', 'shipping_refund' => '0.00', 'adjustment' => '0.00', 'total' => '2.99', 'refund_reference' => null, 'restocked' => true,
            'created_at' => $memo->created_at->toIso8601ZuluString(), 'admin_name' => 'Store Admin', 'note' => 'Damaged box.',
        ]);
        $this->assertSame(8, $this->tea->fresh()->stock_quantity); // 10 − 3 + 1
        $this->assertSame(9, $this->mug->fresh()->stock_quantity);
        $this->assertSame(['processing', 'partially_refunded'], [Order::sole()->status, Order::sole()->payment_status]);
        Mail::assertSent(RefundMail::class, fn ($mail) => $mail->hasTo('guest@example.com') && str_contains($mail->render(), '$2.99'));

        $this->admin('GET', "/api/admin/v1/orders/{$number}/refundable")
            ->assertJsonPath('data.items.0.refunded', 1)->assertJsonPath('data.items.0.refundable', 2)
            ->assertJsonPath('data.max_total', '17.98');

        // Everything else: the last tea unit takes the remainder (2.99 + 3.01).
        $this->refund($number, [$tea => 2, $mug => 1], ['shipping_refund' => '4.99'])->assertCreated()
            ->assertJsonPath('data.items.0.amount', '6.00')
            ->assertJsonPath('data.items.1.amount', '6.99')
            ->assertJsonPath('data.total', '17.98');
        $this->assertSame(8, $this->tea->fresh()->stock_quantity); // not restocked this time

        $order = $this->admin('GET', "/api/admin/v1/orders/{$number}")->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.payment_status', 'refunded')
            ->assertJsonPath('data.totals.paid', '20.97')
            ->assertJsonPath('data.totals.refunded', '20.97')
            ->assertJsonPath('data.credit_memos.1.total', '17.98');
        $this->assertStringStartsWith('Credit memo CM-', $order->json('data.history.3.note'));

        // Closed is final.
        $this->refund($number, [], ['adjustment' => '1.00'])->assertJsonValidationErrors(['order' => 'This order has already been fully refunded.']);
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered'])->assertJsonValidationErrors(['status' => 'A closed order can\'t be changed any more.']);

        // The customer sees the refunds.
        $this->app['auth']->forgetGuards();
        $memos = $this->postJson('/api/v1/orders/lookup', ['number' => $number, 'email' => 'guest@example.com'])->json('data.credit_memos');
        $this->assertSame(['2.99', '17.98'], array_column($memos, 'total'));
        $this->assertSame(['number', 'total', 'created_at'], array_keys($memos[0]));
    }

    public function test_refunding_units_one_by_one_adds_up_to_the_line(): void
    {
        [$number, $tea] = $this->paidOrder();

        foreach (['2.99', '2.99', '3.01'] as $amount) {
            $this->refund($number, [$tea => 1])->assertCreated()->assertJsonPath('data.total', $amount);
        }
        $this->refund($number, [$tea => 1])->assertJsonValidationErrors(['items.0.quantity' => "{$this->tea->name} has already been fully refunded."]);
        $this->assertSame('partially_refunded', Order::sole()->payment_status); // the mug and shipping are left
    }

    public function test_coupon_shares_with_rounding_always_add_up(): void
    {
        // Three equal lines and a discount that doesn't split evenly: subtotal 10.02, NEST10 → 1.00.
        // Shares 0.34 / 0.33 / 0.33 (on a tie the leftover cent goes to the first line), so the lines paid 3.00 / 3.01 / 3.01.
        $a = $this->product(['price' => '3.34']);
        $b = $this->product(['price' => '3.34']);
        $c = $this->product(['price' => '3.34']);
        $number = $this->placeOrder([['product_id' => $a->id, 'quantity' => 1], ['product_id' => $b->id, 'quantity' => 1], ['product_id' => $c->id, 'quantity' => 1]],
            ['coupon_code' => 'NEST10', 'shipping_method' => 'express'])->assertCreated()->assertJsonPath('data.totals.discount', '1.00')->json('data.number');
        $this->admin('POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();

        $units = array_column($this->admin('GET', "/api/admin/v1/orders/{$number}/refundable")->json('data.items'), 'unit_refund');
        $this->assertSame(['3.00', '3.01', '3.01'], $units);
        $ids = Order::sole()->items->pluck('id')->all();
        $this->refund($number, array_fill_keys($ids, 1), ['shipping_refund' => '12.99'])->assertCreated()->assertJsonPath('data.total', '22.01');
        $this->assertSame(['closed', 'refunded'], [Order::sole()->status, Order::sole()->payment_status]);
    }

    public function test_limits_are_enforced(): void
    {
        [$number, $tea, $mug] = $this->paidOrder();

        $this->refund($number, [$tea => 4])->assertJsonValidationErrors(['items.0.quantity' => "Only 3 of {$this->tea->name} can be refunded."]);
        $this->refund($number, [999999 => 1])->assertJsonValidationErrors(['items.0.order_item_id' => 'This item isn\'t part of the order.']);
        $this->admin('POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => $tea, 'quantity' => 1], ['order_item_id' => $tea, 'quantity' => 1]]])
            ->assertJsonValidationErrors(['items.1.order_item_id' => 'Each item can be listed only once.']);
        $this->refund($number, [], ['shipping_refund' => '5.00'])->assertJsonValidationErrors(['shipping_refund' => 'At most $4.99 of shipping can be refunded.']);
        $this->refund($number, [])->assertJsonValidationErrors(['total' => 'The refund total must be more than $0.00.']);
        $this->refund($number, [$tea => 1], ['adjustment' => '-2.99'])->assertJsonValidationErrors(['total' => 'The refund total must be more than $0.00.']);
        $this->refund($number, [$tea => 1], ['adjustment' => '18.00'])
            ->assertJsonValidationErrors(['total' => 'The refund can\'t be more than $20.97 (what was paid and not refunded yet).']);
        $this->refund($number, [], ['adjustment' => '1.234'])->assertJsonValidationErrors('adjustment');
        $this->refund($number, [], ['shipping_refund' => '-1.00'])->assertJsonValidationErrors('shipping_refund');
        $this->assertSame(0, CreditMemo::count());

        // Shipping can be refunded in parts, never beyond what was charged.
        $this->refund($number, [], ['shipping_refund' => '2.00'])->assertCreated();
        $this->refund($number, [], ['shipping_refund' => '3.00'])->assertJsonValidationErrors(['shipping_refund' => 'At most $2.99 of shipping can be refunded.']);
        // A positive adjustment (goodwill) is fine within what is left.
        $this->refund($number, [], ['adjustment' => '1.50'])->assertCreated()->assertJsonPath('data.total', '1.50');
        $this->admin('GET', "/api/admin/v1/orders/{$number}/refundable")->assertJsonPath('data.max_total', '17.47')->assertJsonPath('data.shipping_refundable', '2.99');
    }

    public function test_a_negative_adjustment_keeps_a_fee_and_still_closes_the_order(): void
    {
        [$number, $tea, $mug] = $this->paidOrder();

        $this->refund($number, [$tea => 3, $mug => 1], ['shipping_refund' => '4.99', 'adjustment' => '-5.00'])->assertCreated()
            ->assertJsonPath('data.subtotal', '15.98')
            ->assertJsonPath('data.adjustment', '-5.00')
            ->assertJsonPath('data.total', '15.97');
        // Nothing left to refund but the kept fee: fully refunded and closed.
        $this->assertSame(['closed', 'refunded'], [Order::sole()->status, Order::sole()->payment_status]);
        $this->admin('GET', "/api/admin/v1/orders/{$number}")->assertJsonPath('data.totals.refunded', '15.97');
    }

    public function test_only_paid_orders_can_be_refunded(): void
    {
        [$number, $tea] = $this->paidOrder(invoice: false);

        $this->admin('GET', "/api/admin/v1/orders/{$number}/refundable")->assertOk()
            ->assertJsonPath('data.max_total', '0.00')->assertJsonPath('data.shipping_refundable', '0.00');
        $this->refund($number, [$tea => 1])
            ->assertJsonValidationErrors(['order' => 'This order hasn\'t been paid yet, so there is nothing to refund. Invoice it first.']);
        $this->admin('POST', '/api/admin/v1/orders/BN-1/credit-memos', ['items' => []])->assertNotFound();
    }

    public function test_restock_skips_deleted_products_and_delivered_orders_can_close(): void
    {
        [$number, $tea, $mug] = $this->paidOrder();
        $this->admin('POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'usps'])->assertCreated();
        $this->admin('PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered'])->assertOk();
        $this->mug->delete();

        $this->refund($number, [$tea => 3, $mug => 1], ['shipping_refund' => '4.99', 'restock' => true, 'notify_customer' => false])->assertCreated()
            ->assertJsonPath('data.restocked', true);
        $this->assertSame(10, $this->tea->fresh()->stock_quantity);
        $this->assertSame(9, Product::withTrashed()->find($this->mug->id)->stock_quantity); // deleted: left alone
        $this->assertSame('closed', Order::sole()->status);
        Mail::assertNotSent(RefundMail::class);
    }

    public function test_staff_list_and_read_credit_memos(): void
    {
        [$number, $tea] = $this->paidOrder();
        $this->refund($number, [$tea => 1])->assertCreated();
        $memo = CreditMemo::sole()->number;

        $this->admin('GET', '/api/admin/v1/credit-memos')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.number', $memo);
        $this->admin('GET', '/api/admin/v1/credit-memos?search=nobody')->assertJsonPath('meta.total', 0);
        $this->admin('GET', "/api/admin/v1/credit-memos?search={$number}")->assertJsonPath('meta.total', 1);
        $this->admin('GET', "/api/admin/v1/credit-memos/{$memo}")->assertOk()->assertJsonPath('data.items.0.amount', '2.99');
        $this->admin('GET', '/api/admin/v1/credit-memos/CM-1')->assertNotFound();
        $this->admin('GET', '/api/admin/v1/overview')->assertJsonPath('data.orders.revenue', '17.98'); // 20.97 − 2.99
    }
}
