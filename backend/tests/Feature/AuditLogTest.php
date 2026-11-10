<?php

namespace Tests\Feature;

use App\Models\Admin;
use App\Models\AdminRole;
use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\Order;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Who did what in the admin: the audit log. */
class AuditLogTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Admin $owner;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->owner = Admin::factory()->create(['email' => 'owner@buynest.test']);
        $this->headers = $this->signInAdmin($this->owner);
    }

    private function last(string $action): AuditLog
    {
        return AuditLog::where('action', $action)->latest('id')->firstOrFail();
    }

    // MySQL keeps JSON object keys in its own order, so changes are compared with assertEquals (keys, not their order).

    public function test_sign_ins_are_logged_and_failed_ones_have_no_admin(): void
    {
        $this->assertSame($this->owner->id, $this->last('admin.signed_in')->admin_id);

        $this->postJson('/api/admin/v1/auth/login', ['email' => 'owner@buynest.test', 'password' => 'WrongPass123'])->assertUnprocessable();
        $this->postJson('/api/admin/v1/auth/login', ['email' => 'nobody@buynest.test', 'password' => 'WrongPass123'])->assertUnprocessable();

        $failed = AuditLog::where('action', 'admin.sign_in_failed')->orderBy('id')->get();
        $this->assertCount(2, $failed);
        $this->assertNull($failed[0]->admin_id);
        $this->assertStringContainsString('owner@buynest.test', $failed[0]->summary);
        $this->assertStringContainsString('nobody@buynest.test', $failed[1]->summary);
        $this->assertStringNotContainsString('WrongPass123', json_encode($failed->toArray()));
        $this->assertSame('127.0.0.1', $failed[0]->ip);
    }

    public function test_a_product_update_logs_only_the_changed_fields(): void
    {
        $product = $this->product(['price' => '10.00', 'stock_quantity' => 5]);

        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/products/{$product->id}", ['price' => '8.50', 'stock_quantity' => 5, 'name' => $product->name])->assertOk();

        $entry = $this->last('product.updated');
        $this->assertSame($this->owner->id, $entry->admin_id);
        $this->assertSame(['product', $product->id], [$entry->subject_type, $entry->subject_id]);
        $this->assertEquals(['before' => ['price' => '10.00'], 'after' => ['price' => '8.50']], $entry->changes);

        // Nothing changed: nothing logged.
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/products/{$product->id}", ['price' => '8.50'])->assertOk();
        $this->assertSame(1, AuditLog::where('action', 'product.updated')->count());

        $this->asAdmin($this->headers, 'DELETE', "/api/admin/v1/products/{$product->id}")->assertNoContent();
        $this->assertSame('8.50', $this->last('product.deleted')->changes['before']['price']);
    }

    public function test_admin_changes_never_log_passwords(): void
    {
        $viewer = AdminRole::where('name', 'Viewer')->sole();
        $id = $this->asAdmin($this->headers, 'POST', '/api/admin/v1/admins', [
            'name' => 'Vic', 'email' => 'vic@example.com', 'role_id' => $viewer->id, 'password' => 'SecretPass2026',
        ])->assertCreated()->json('data.id');
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/admins/{$id}/reset-password", ['password' => 'OtherSecret2026'])->assertOk();
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/admins/{$id}", ['is_active' => false])->assertOk();

        $this->assertEquals(['name' => 'Vic', 'email' => 'vic@example.com', 'role' => 'Viewer', 'is_active' => true], $this->last('admin.created')->changes['after']);
        $this->assertNull($this->last('admin.password_reset')->changes);
        $this->assertEquals(['before' => ['is_active' => true], 'after' => ['is_active' => false]], $this->last('admin.deactivated')->changes);

        $all = json_encode(AuditLog::all()->toArray());
        $this->assertStringNotContainsString('SecretPass2026', $all);
        $this->assertStringNotContainsString('OtherSecret2026', $all);
        $this->assertStringNotContainsString('$2y$', $all);
    }

    public function test_order_work_is_logged(): void
    {
        $product = $this->product(['price' => '20.00']);
        $number = $this->placeOrder([['product_id' => $product->id, 'quantity' => 2]], ['payment_method' => 'card'])->assertCreated()->json('data.number');

        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/orders/{$number}/invoices")->assertCreated();
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/orders/{$number}/shipments", ['carrier' => 'ups', 'tracking_number' => '1Z999'])->assertCreated();
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'delivered'])->assertOk();
        $item = Order::where('number', $number)->sole()->items[0];
        $this->asAdmin($this->headers, 'POST', "/api/admin/v1/orders/{$number}/credit-memos", [
            'items' => [['order_item_id' => $item->id, 'quantity' => 1]],
        ])->assertCreated();

        $this->assertStringContainsString($number, $this->last('invoice.created')->summary);
        $this->assertSame('1Z999', $this->last('shipment.created')->changes['after']['tracking_number']);
        $this->assertEquals(['before' => ['status' => 'shipped'], 'after' => ['status' => 'delivered']], $this->last('order.status_changed')->changes);
        $this->assertSame('20.00', $this->last('credit_memo.created')->changes['after']['total']);
    }

    public function test_customers_coupons_content_and_settings_are_logged(): void
    {
        $customer = Customer::factory()->create();
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/customers/{$customer->id}", ['is_active' => false])->assertOk();
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/coupons', ['code' => 'WELCOME5', 'type' => 'fixed', 'value' => '5.00'])->assertCreated();
        $this->asAdmin($this->headers, 'PATCH', '/api/admin/v1/settings', ['shipping' => ['standard_price' => '5.99']])->assertOk();
        $this->asAdmin($this->headers, 'POST', '/api/admin/v1/pages', ['slug' => 'faq', 'title' => 'FAQ', 'body' => '<p>Hi</p>'])->assertCreated();

        $this->assertEquals(['before' => ['is_active' => true], 'after' => ['is_active' => false]], $this->last('customer.blocked')->changes);
        $this->assertSame('WELCOME5', $this->last('coupon.created')->changes['after']['code']);
        $this->assertEquals(['before' => ['standard_price' => '4.99'], 'after' => ['standard_price' => '5.99']], $this->last('settings.updated')->changes);
        $this->assertSame('faq', $this->last('page.created')->changes['after']['slug']);
    }

    public function test_the_log_can_be_filtered_and_needs_audit_view(): void
    {
        $product = $this->product();
        $this->asAdmin($this->headers, 'PATCH', "/api/admin/v1/products/{$product->id}", ['price' => '1.00'])->assertOk();
        $this->postJson('/api/admin/v1/auth/login', ['email' => 'x@example.com', 'password' => 'Nope12345678'])->assertUnprocessable();

        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/audit?action=product')->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.action', 'product.updated')
            ->assertJsonPath('data.0.admin.email', 'owner@buynest.test')
            ->assertJsonPath('data.0.changes.after.price', '1.00');
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/audit?action=admin.sign_in_failed')->assertJsonPath('data.0.admin', null);
        $this->asAdmin($this->headers, 'GET', "/api/admin/v1/audit?admin_id={$this->owner->id}&subject_type=product&from=".now()->toDateString().'&to='.now()->toDateString())
            ->assertJsonCount(1, 'data');
        $this->asAdmin($this->headers, 'GET', '/api/admin/v1/audit?from=2020-01-01&to=2020-01-31')->assertJsonCount(0, 'data');

        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        $this->asAdmin($sales, 'GET', '/api/admin/v1/audit')->assertForbidden()->assertJsonPath('permission', 'audit.view');
    }
}
