<?php

namespace Tests\Feature;

use App\Mail\ReturnStatusMail;
use App\Models\Admin;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 6: returns (RMA): who may return what and when, the status workflow, and refunding a return. */
class ReturnsTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private array $admin;

    private Customer $customer;

    private array $headers;

    private Product $mug;

    private Product $tea;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
        $this->customer = Customer::factory()->create();
        $this->headers = $this->customerHeaders($this->customer);
        $this->mug = $this->product(['price' => '10.00', 'stock_quantity' => 10]);
        $this->tea = $this->product(['price' => '5.00', 'stock_quantity' => 10]);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    /** A paid order (3 mugs, 2 teas), shipped; delivered too when asked. Returns [number, mug item id, tea item id]. */
    private function shippedOrder(bool $deliver = false, bool $ship = true): array
    {
        $this->app['auth']->forgetGuards();
        $number = $this->placeOrder([['product_id' => $this->mug->id, 'quantity' => 3], ['product_id' => $this->tea->id, 'quantity' => 2]], [], $this->headers)
            ->assertCreated()->json('data.number');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/invoices", ['notify_customer' => false])->assertCreated();
        if ($ship) {
            $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'dhl', 'notify_customer' => false])->assertCreated();
        }
        if ($deliver) {
            $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered', 'notify_customer' => false])->assertOk();
        }
        $items = Order::where('number', $number)->sole()->items;

        return [$number, $items[0]->id, $items[1]->id];
    }

    private function request(string $number, array $items, array $extra = [])
    {
        return $this->asAdmin($this->headers, 'POST', "/api/v1/orders/{$number}/returns", [
            'items' => array_map(fn ($id, $qty) => ['order_item_id' => $id, 'quantity' => $qty], array_keys($items), $items),
            'reason' => 'Damaged',
            ...$extra,
        ]);
    }

    private function patchReturn(string $number, array $body)
    {
        return $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/returns/{$number}", $body);
    }

    public function test_a_customer_requests_a_return_for_a_shipped_order(): void
    {
        [$number, $mug, $tea] = $this->shippedOrder();

        $detail = $this->asAdmin($this->headers, 'GET', "/api/v1/orders/{$number}")->assertOk();
        $detail->assertJsonPath('data.return_eligibility.eligible', true)
            ->assertJsonPath('data.return_eligibility.reasons', ['Damaged', 'Wrong item', 'Not as described', 'No longer needed', 'Other'])
            ->assertJsonPath('data.return_eligibility.items.0.returnable', 3)
            ->assertJsonPath('data.returns', []);

        $created = $this->request($number, [$mug => 2], ['comment' => 'Cracked handle.'])->assertCreated();
        $return = OrderReturn::sole();
        $this->assertSame('RMA-'.(100000 + $return->id), $return->number);
        $created->assertJsonPath('data.number', $return->number)
            ->assertJsonPath('data.status', 'requested')
            ->assertJsonPath('data.reason', 'Damaged')
            ->assertJsonPath('data.comment', 'Cracked handle.')
            ->assertJsonPath('data.items_count', 2)
            ->assertJsonPath('data.items.0.order_item_id', $mug)
            ->assertJsonPath('data.items.0.quantity', 2)
            ->assertJsonPath('data.allowed_transitions', [])
            ->assertJsonMissingPath('data.customer');
        Mail::assertSent(ReturnStatusMail::class, fn ($mail) => $mail->hasTo('guest@example.com') && $mail->return->status === 'requested'); // the order's email
        $this->assertStringContainsString("Return {$return->number} requested", Order::where('number', $number)->sole()->history->last()->note);

        // Quantity limits: 1 mug left, 2 teas.
        $this->request($number, [$mug => 2])->assertUnprocessable()->assertJsonValidationErrors(['items.0.quantity' => "Only 1 of {$this->mug->name} can be returned."]);
        $this->request($number, [999999 => 1])->assertUnprocessable()->assertJsonValidationErrors('items.0.order_item_id');
        $this->request($number, [$tea => 1], ['reason' => 'Bored'])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->request($number, [$mug => 1, $tea => 2])->assertCreated();
        $this->request($number, [$tea => 1])->assertUnprocessable()->assertJsonPath('errors.order.0', 'Every item of this order has already been returned or refunded.');

        // Lists: own only.
        $this->asAdmin($this->headers, 'GET', '/api/v1/returns')->assertOk()->assertJsonPath('meta.total', 2)->assertJsonMissingPath('data.0.customer');
        $this->asAdmin($this->headers, 'GET', "/api/v1/returns/{$return->number}")->assertOk()->assertJsonPath('data.order.number', $number);
        $stranger = $this->customerHeaders(Customer::factory()->create());
        $this->asAdmin($stranger, 'GET', "/api/v1/returns/{$return->number}")->assertNotFound();
        $this->asAdmin($stranger, 'GET', '/api/v1/returns')->assertJsonPath('meta.total', 0);
        $this->asAdmin($stranger, 'POST', "/api/v1/orders/{$number}/returns", ['items' => [['order_item_id' => $tea, 'quantity' => 1]], 'reason' => 'Damaged'])
            ->assertNotFound();
    }

    public function test_not_shipped_disabled_and_the_window(): void
    {
        [$unshipped, $mug] = $this->shippedOrder(ship: false);
        $this->request($unshipped, [$mug => 1])->assertUnprocessable()
            ->assertJsonPath('errors.order.0', 'Items can be returned once the order has shipped.');

        // The window runs from the delivered date…
        [$delivered, $mug2] = $this->shippedOrder(deliver: true);
        $this->travel(29)->days();
        $this->headers = $this->customerHeaders($this->customer); // access tokens last an hour
        $this->asAdmin($this->headers, 'GET', "/api/v1/orders/{$delivered}")->assertJsonPath('data.return_eligibility.eligible', true);
        $this->travel(2)->days();
        $this->headers = $this->customerHeaders($this->customer);
        $this->admin = $this->adminHeaders();
        $this->request($delivered, [$mug2 => 1])->assertUnprocessable()->assertJsonPath('errors.order.0', fn ($m) => str_starts_with($m, 'The return window for this order closed on'));
        $this->asAdmin($this->headers, 'GET', "/api/v1/orders/{$delivered}")->assertJsonPath('data.return_eligibility.code', 'window_closed');

        // …staff may override it; a longer window opens it again.
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$delivered}/returns", ['items' => [['order_item_id' => $mug2, 'quantity' => 1]], 'reason' => 'Other'])
            ->assertUnprocessable()->assertJsonValidationErrors('order');
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$delivered}/returns", [
            'items' => [['order_item_id' => $mug2, 'quantity' => 1]], 'reason' => 'Other', 'override_window' => true,
        ])->assertCreated()->assertJsonPath('data.created_by_admin.name', 'Store Admin');
        $this->assertDatabaseHas('audit_log', ['action' => 'return.created']);
        $this->asAdmin($this->admin, 'PATCH', '/api/admin/v1/settings', ['returns' => ['return_window_days' => 60]])->assertOk();
        $this->request($delivered, [$mug2 => 1])->assertCreated();

        // Returns switched off.
        $this->asAdmin($this->admin, 'PATCH', '/api/admin/v1/settings', ['returns' => ['returns_enabled' => false]])->assertOk();
        $this->request($delivered, [$mug2 => 1])->assertUnprocessable()->assertJsonPath('errors.order.0', 'Returns are not available at the moment.');
        $this->asAdmin($this->admin, 'PATCH', '/api/admin/v1/settings', ['returns' => ['return_reasons' => [], 'return_window_days' => 0]])
            ->assertUnprocessable()->assertJsonValidationErrors(['returns.return_reasons', 'returns.return_window_days']);
    }

    public function test_without_a_delivered_date_the_window_runs_from_the_shipment(): void
    {
        [$number, $mug] = $this->shippedOrder();
        $this->travel(31)->days();
        $this->headers = $this->customerHeaders($this->customer);
        $this->request($number, [$mug => 1])->assertUnprocessable()->assertJsonValidationErrors('order');
    }

    public function test_status_transitions(): void
    {
        [$number, $mug] = $this->shippedOrder();
        $rma = $this->request($number, [$mug => 1])->json('data.number');
        Mail::fake();

        $this->patchReturn($rma, ['status' => 'received'])->assertUnprocessable()
            ->assertJsonPath('errors.status.0', 'A requested return can\'t be moved to received. It can go to: approved, rejected.');
        $this->patchReturn($rma, ['status' => 'refunded'])->assertUnprocessable()->assertJsonValidationErrors('status');
        $this->patchReturn($rma, ['status' => 'approved', 'admin_note' => 'Use the prepaid label.'])->assertOk()
            ->assertJsonPath('data.status', 'approved')->assertJsonPath('data.allowed_transitions', ['received']);
        Mail::assertSent(ReturnStatusMail::class, fn ($mail) => $mail->return->status === 'approved');
        // The customer sees the note (they were emailed); a silent note stays internal.
        $this->asAdmin($this->headers, 'GET', "/api/v1/returns/{$rma}")->assertJsonPath('data.admin_note', 'Use the prepaid label.');

        $item = OrderReturn::sole()->items->sole();
        $this->patchReturn($rma, ['status' => 'received', 'items' => [['return_item_id' => $item->id, 'condition' => 'opened']],
            'notify_customer' => false, 'admin_note' => 'Box dented.'])->assertOk()
            ->assertJsonPath('data.items.0.condition', 'opened')->assertJsonPath('data.restocked', false)->assertJsonPath('data.can_refund', true);
        $this->asAdmin($this->headers, 'GET', "/api/v1/returns/{$rma}")->assertJsonPath('data.admin_note', null);
        $this->patchReturn($rma, ['status' => 'closed', 'resolution' => 'replace'])->assertOk()->assertJsonPath('data.resolution', 'replace');
        $this->patchReturn($rma, ['status' => 'approved'])->assertUnprocessable()->assertJsonPath('errors.status.0', 'A closed return can\'t be changed any more.');

        // Rejected returns give their quantity back.
        $second = $this->request($number, [$mug => 2])->json('data.number');
        $this->patchReturn($second, ['status' => 'rejected'])->assertOk();
        $this->request($number, [$mug => 2])->assertCreated();

        $notes = Order::where('number', $number)->sole()->history->pluck('note')->implode("\n");
        $this->assertStringContainsString("Return {$rma} approved.", $notes);
        $this->assertStringContainsString("Return {$rma} closed.", $notes);
        foreach (['return.approved', 'return.received', 'return.closed', 'return.rejected'] as $action) {
            $this->assertDatabaseHas('audit_log', ['action' => $action]);
        }
    }

    public function test_refunding_a_return_restocks_only_once(): void
    {
        [$number, $mug] = $this->shippedOrder();
        $rma = $this->request($number, [$mug => 2])->json('data.number');
        $this->patchReturn($rma, ['status' => 'approved'])->assertOk();

        // Only a received return can be refunded.
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $mug, 'quantity' => 2]], 'return_number' => $rma,
        ])->assertUnprocessable()->assertJsonValidationErrors('return_number');

        $stock = $this->mug->fresh()->stock_quantity; // 7
        $this->patchReturn($rma, ['status' => 'received', 'restock' => true])->assertOk()->assertJsonPath('data.restocked', true);
        $this->assertSame($stock + 2, $this->mug->fresh()->stock_quantity);

        Mail::fake();
        $memo = $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $mug, 'quantity' => 2]], 'restock' => true, 'return_number' => strtolower($rma),
        ])->assertCreated()->assertJsonPath('data.return_number', $rma)->assertJsonPath('data.restocked', false)->assertJsonPath('data.total', '20.00');
        $this->assertSame($stock + 2, $this->mug->fresh()->stock_quantity); // not twice

        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/returns/{$rma}")->assertOk()
            ->assertJsonPath('data.status', 'refunded')->assertJsonPath('data.resolution', 'refund')
            ->assertJsonPath('data.credit_memo.number', $memo->json('data.number'))->assertJsonPath('data.allowed_transitions', []);
        Mail::assertSent(ReturnStatusMail::class, fn ($mail) => $mail->return->status === 'refunded');
        $this->assertDatabaseHas('audit_log', ['action' => 'return.refunded']);

        // The refunded return still counts; a memo of another order can't use it.
        $this->asAdmin($this->headers, 'GET', "/api/v1/orders/{$number}")->assertJsonPath('data.return_eligibility.items.0.returnable', 1)
            ->assertJsonPath('data.returns.0.status', 'refunded');
        [$other] = $this->shippedOrder();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$other}/credit-memos", ['shipping_refund' => '1.00', 'return_number' => $rma])
            ->assertUnprocessable()->assertJsonPath('errors.return_number.0', 'This return doesn\'t belong to the order.');
    }

    public function test_a_return_not_restocked_on_receipt_is_restocked_by_the_memo(): void
    {
        [$number, $mug] = $this->shippedOrder();
        $rma = $this->request($number, [$mug => 1])->json('data.number');
        $this->patchReturn($rma, ['status' => 'approved'])->assertOk();
        $this->patchReturn($rma, ['status' => 'received'])->assertOk();
        $stock = $this->mug->fresh()->stock_quantity;
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $mug, 'quantity' => 1]], 'restock' => true, 'return_number' => $rma,
        ])->assertCreated()->assertJsonPath('data.restocked', true);
        $this->assertSame($stock + 1, $this->mug->fresh()->stock_quantity);
    }

    public function test_a_plain_refund_lowers_what_can_be_returned(): void
    {
        [$number, $mug] = $this->shippedOrder();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$number}/credit-memos", ['items' => [['order_item_id' => $mug, 'quantity' => 2]]])->assertCreated();
        $this->request($number, [$mug => 2])->assertUnprocessable()->assertJsonValidationErrors(['items.0.quantity' => "Only 1 of {$this->mug->name} can be returned."]);
    }

    public function test_the_admin_list_and_permissions(): void
    {
        [$number, $mug] = $this->shippedOrder();
        $rma = $this->request($number, [$mug => 1])->json('data.number');

        $list = $this->asAdmin($this->admin, 'GET', '/api/admin/v1/returns?status=requested&search='.$number)->assertOk();
        $list->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.number', $rma)
            ->assertJsonPath('data.0.customer.id', $this->customer->id)
            ->assertJsonPath('meta.counts', ['requested' => 1, 'approved' => 0, 'rejected' => 0, 'received' => 0, 'refunded' => 0, 'closed' => 0]);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/returns?status=approved')->assertJsonPath('meta.total', 0);
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/returns/RMA-1')->assertNotFound();
        $this->asAdmin($this->admin, 'GET', "/api/admin/v1/orders/{$number}")->assertJsonPath('data.returns.0.number', $rma);

        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', "/api/admin/v1/returns/{$rma}")->assertOk();
        $this->asAdmin($viewer, 'PATCH', "/api/admin/v1/returns/{$rma}", ['status' => 'approved'])->assertForbidden()->assertJsonPath('permission', 'returns.manage');
        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'PATCH', "/api/admin/v1/returns/{$rma}", ['status' => 'approved'])->assertOk();
    }
}
