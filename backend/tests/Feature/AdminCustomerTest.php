<?php

namespace Tests\Feature;

use App\Mail\OneTimeCodeMail;
use App\Models\Admin;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\OneTimeCode;
use App\Models\Order;
use App\Models\Review;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\Feature\Concerns\ReadsCodes;
use Tests\TestCase;

/** Phase 6: customers in the admin: profile, edit, create (set-password email), password reset, notes, delete, export. */
class AdminCustomerTest extends TestCase
{
    use PlacesOrders, ReadsCodes, RefreshDatabase;

    private array $admin;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->admin = $this->adminHeaders();
    }

    private function login(Customer|string $customer, string $password = 'Password123')
    {
        $this->app['auth']->forgetGuards();

        return $this->postJson('/api/v1/auth/login', ['email' => is_string($customer) ? $customer : $customer->email, 'password' => $password]);
    }

    public function test_the_full_profile(): void
    {
        $customer = Customer::factory()->create(['first_name' => 'Nadia']);
        $product = $this->product(['price' => '10.00', 'stock_quantity' => 20]);
        $token = $this->login($customer)->json('data.tokens.access_token');
        $first = $this->placeOrder([['product_id' => $product->id, 'quantity' => 2]], [], $this->bearer($token))->json('data.number'); // 20 + 4.99
        $this->app['auth']->forgetGuards();
        $second = $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [], $this->bearer($token))->json('data.number'); // 10 + 4.99
        $this->app['auth']->forgetGuards();
        $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [], $this->bearer($token))->assertCreated();
        // One cancelled (not counted), one refunded in part (subtracted).
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/orders/{$second}", ['status' => 'cancelled'])->assertOk();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$first}/invoices")->assertCreated();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/orders/{$first}/credit-memos", ['shipping_refund' => '4.99'])->assertCreated();
        $customer->addresses()->create(['first_name' => 'N', 'last_name' => 'R', 'phone' => '+15550100100', 'line1' => '1 A St', 'city' => 'X',
            'postal_code' => '12345', 'country' => 'Germany', 'is_default_shipping' => true]);
        Review::factory()->create(['product_id' => $product->id, 'customer_id' => $customer->id]);
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/customers/{$customer->id}/notes", ['body' => 'Prefers phone calls.'])->assertCreated()
            ->assertJsonPath('data.body', 'Prefers phone calls.')->assertJsonPath('data.admin.name', 'Store Admin');

        $profile = $this->asAdmin($this->admin, 'GET', "/api/admin/v1/customers/{$customer->id}")->assertOk();
        $profile->assertJsonPath('data.first_name', 'Nadia')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.email_verified', true)
            ->assertJsonPath('data.group.name', 'General')
            ->assertJsonPath('data.orders_count', 3)
            ->assertJsonPath('data.lifetime_spent', '34.99') // 24.99 + 14.99, the cancelled one not counted, − 4.99 refunded
            ->assertJsonPath('data.reviews_count', 1)
            ->assertJsonPath('data.addresses.0.city', 'X')
            ->assertJsonPath('data.notes.0.body', 'Prefers phone calls.');
        $this->assertCount(3, $profile->json('data.recent_orders'));
        $this->assertSame(['number', 'status', 'payment_status', 'source', 'item_count', 'total', 'placed_at'], array_keys($profile->json('data.recent_orders.0')));
        $this->assertNotNull($profile->json('data.last_login_at'));
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.note_added', 'subject_id' => $customer->id]);

        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/customers/999999')->assertNotFound();
    }

    public function test_changing_the_email_unverifies_it_and_signs_the_customer_out(): void
    {
        $customer = Customer::factory()->create(['email' => 'old@example.com']);
        $token = $this->login($customer)->assertOk()->json('data.tokens.access_token');
        $wholesale = CustomerGroup::where('code', 'wholesale')->sole();

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/customers/{$customer->id}", [
            'email' => 'New@Example.com', 'first_name' => 'Renamed', 'group_id' => $wholesale->id,
        ])->assertOk()
            ->assertJsonPath('data.email', 'new@example.com')
            ->assertJsonPath('data.email_verified', false)
            ->assertJsonPath('data.status', 'unverified')
            ->assertJsonPath('data.group.name', 'Wholesale');

        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/me', $this->bearer($token))->assertUnauthorized();
        // Next sign-in: the verify-your-email flow sends a code to the new address.
        $this->login('new@example.com')->assertForbidden()->assertJsonPath('code', 'email_unverified');
        $code = $this->lastCodeFor('new@example.com', OneTimeCode::VERIFY_EMAIL);
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/verify-email', ['email' => 'new@example.com', 'code' => $code])->assertOk();
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.updated', 'subject_id' => $customer->id]);

        // Unique among customers; unchanged email keeps it verified.
        $other = Customer::factory()->create();
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/customers/{$customer->id}", ['email' => $other->email])
            ->assertUnprocessable()->assertJsonPath('errors.email.0', 'Another customer already uses this email.');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/customers/{$customer->id}", ['email' => 'new@example.com', 'phone' => '+44 20 7946 0000'])
            ->assertOk()->assertJsonPath('data.email_verified', true)->assertJsonPath('data.phone', '+442079460000');
        // An email change must not get the account pruned as an abandoned sign-up.
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/customers/{$customer->id}", ['email' => 'third@example.com'])->assertOk();
        $this->travel(30)->days();
        Artisan::call('model:prune', ['--model' => [Customer::class]]);
        $this->assertNotNull($customer->fresh());
    }

    public function test_blocking_keeps_the_phase_4_audit_action(): void
    {
        $customer = Customer::factory()->create();
        $token = $this->login($customer)->json('data.tokens.access_token');
        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/customers/{$customer->id}", ['is_active' => false])->assertOk()->assertJsonPath('data.status', 'blocked');
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/me', $this->bearer($token))->assertUnauthorized();
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.blocked', 'subject_id' => $customer->id]);
    }

    public function test_a_customer_created_by_staff_sets_their_own_password(): void
    {
        $vip = CustomerGroup::where('code', 'vip')->sole();
        $created = $this->asAdmin($this->admin, 'POST', '/api/admin/v1/customers', [
            'first_name' => 'Pat', 'last_name' => 'Phone', 'email' => 'Pat@Example.com', 'phone' => '+1 555 010 0199', 'group_id' => $vip->id,
        ])->assertCreated();
        $created->assertJsonPath('data.email', 'pat@example.com')->assertJsonPath('data.email_verified', false)
            ->assertJsonPath('data.created_by_admin', true)->assertJsonPath('data.group.name', 'VIP')
            ->assertJsonMissingPath('data.password');
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.created']);

        Mail::assertSent(OneTimeCodeMail::class, fn ($mail) => $mail->hasTo('pat@example.com') && $mail->setPassword
            && $mail->purpose === OneTimeCode::RESET_PASSWORD && $mail->envelope()->subject === 'Set your BuyNest password');
        $code = $this->lastCodeFor('pat@example.com', OneTimeCode::RESET_PASSWORD);

        // No password works before the reset; the code sets one and confirms the email.
        $this->login('pat@example.com', 'anything')->assertUnprocessable();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/reset-password', ['email' => 'pat@example.com', 'code' => $code, 'password' => 'MyOwnPass1',
            'password_confirmation' => 'MyOwnPass1'])->assertOk();
        $this->login('pat@example.com', 'MyOwnPass1')->assertOk()->assertJsonPath('data.customer.email_verified', true)
            ->assertJsonPath('data.customer.group.name', 'VIP');

        // Duplicate email, and a staff-made account is never pruned.
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/customers', ['first_name' => 'A', 'last_name' => 'B', 'email' => 'pat@example.com',
            'phone' => '+15550100100'])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->asAdmin($this->admin, 'POST', '/api/admin/v1/customers', ['first_name' => 'Un', 'last_name' => 'Used', 'email' => 'unused@example.com',
            'phone' => '+15550100100'])->assertCreated();
        Customer::factory()->unverified()->create(['email' => 'abandoned@example.com']);
        $this->travel(8)->days();
        Artisan::call('model:prune', ['--model' => [Customer::class]]);
        $this->assertDatabaseHas('customers', ['email' => 'unused@example.com']);
        $this->assertDatabaseMissing('customers', ['email' => 'abandoned@example.com']);
    }

    public function test_staff_send_a_password_reset(): void
    {
        $customer = Customer::factory()->create();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/customers/{$customer->id}/password-reset")->assertOk()
            ->assertJsonPath('data.email', $customer->email);
        Mail::assertSent(OneTimeCodeMail::class, fn ($mail) => $mail->hasTo($customer->email) && $mail->setPassword);
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/customers/{$customer->id}/password-reset")->assertStatus(429)
            ->assertJsonPath('code', 'too_soon')->assertHeader('Retry-After');
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.password_reset_sent', 'subject_id' => $customer->id]);

        $blocked = Customer::factory()->blocked()->create();
        $this->asAdmin($this->admin, 'POST', "/api/admin/v1/customers/{$blocked->id}/password-reset")->assertUnprocessable()->assertJsonValidationErrors('customer');
    }

    public function test_deleting_a_customer_keeps_orders_and_reviews(): void
    {
        $customer = Customer::factory()->create(['first_name' => 'Gone']);
        $product = $this->product(['stock_quantity' => 10]);
        $token = $this->login($customer)->json('data.tokens.access_token');
        $number = $this->placeOrder([['product_id' => $product->id, 'quantity' => 1]], [], $this->bearer($token))->json('data.number');
        $review = Review::factory()->create(['product_id' => $product->id, 'customer_id' => $customer->id, 'author_name' => 'Gone C.']);
        $customer->addresses()->create(['first_name' => 'N', 'last_name' => 'R', 'phone' => '+15550100100', 'line1' => '1 A St', 'city' => 'X',
            'postal_code' => '12345', 'country' => 'Germany']);
        $customer->notes()->create(['body' => 'note']);

        // An open order (processing): refused.
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/customers/{$customer->id}")->assertUnprocessable()
            ->assertJsonPath('errors.customer.0', 'This customer has 1 open order (pending payment, processing, or shipped). Complete or cancel it first.');

        $this->asAdmin($this->admin, 'PATCH', "/api/admin/v1/orders/{$number}", ['status' => 'cancelled'])->assertOk();
        $this->asAdmin($this->admin, 'DELETE', "/api/admin/v1/customers/{$customer->id}")->assertNoContent();

        $this->assertNull(Customer::find($customer->id));
        $this->assertNull(Order::where('number', $number)->sole()->customer_id);
        $this->assertNull($review->fresh()->customer_id);
        $this->assertSame('Gone C.', $review->fresh()->author_name);
        $this->assertDatabaseCount('customer_addresses', 0);
        $this->assertDatabaseCount('customer_notes', 0);
        $this->assertDatabaseMissing('personal_access_tokens', ['tokenable_id' => $customer->id, 'tokenable_type' => Customer::class]);
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.deleted', 'subject_id' => $customer->id]);
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/me', $this->bearer($token))->assertUnauthorized();
    }

    public function test_list_filters_and_csv_export_with_injection_guard(): void
    {
        $wholesale = CustomerGroup::where('code', 'wholesale')->sole();
        Customer::factory()->create(['first_name' => '=HYPERLINK("x")', 'group_id' => $wholesale->id, 'created_at' => '2026-01-10 10:00:00']);
        Customer::factory()->unverified()->create(['first_name' => 'Una', 'created_at' => '2026-02-10 10:00:00']);
        Customer::factory()->blocked()->create(['first_name' => 'Bea', 'created_at' => '2026-03-10 10:00:00']);

        $list = fn (string $query) => $this->asAdmin($this->admin, 'GET', "/api/admin/v1/customers?{$query}")->assertOk();
        $this->assertSame(['=HYPERLINK("x")'], array_column($list("group_id={$wholesale->id}")->json('data'), 'first_name'));
        $this->assertSame(['Una'], array_column($list('verified=0')->json('data'), 'first_name'));
        $this->assertSame(['Bea'], array_column($list('status=blocked')->json('data'), 'first_name'));
        $this->assertSame(2, $list('status=active')->json('meta.total'));
        $this->assertSame(['Una'], array_column($list('created_from=2026-02-01&created_to=2026-02-28')->json('data'), 'first_name'));
        $this->asAdmin($this->admin, 'GET', '/api/admin/v1/customers?created_from=2026-03-01&created_to=2026-02-01')
            ->assertUnprocessable()->assertJsonValidationErrors('created_to');

        $csv = $this->asAdmin($this->admin, 'GET', "/api/admin/v1/customers/export.csv?group_id={$wholesale->id}")->assertOk()
            ->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $this->assertStringContainsString('attachment; filename="customers-', $csv->headers->get('Content-Disposition'));
        $lines = array_values(array_filter(explode("\n", $csv->getContent())));
        $this->assertSame('id,first_name,last_name,email,phone,group,status,email_verified,orders_count,lifetime_spent,last_login_at,created_at', $lines[0]);
        $this->assertCount(2, $lines);
        $this->assertStringContainsString('"\'=HYPERLINK(""x"")"', $lines[1]);
        $this->assertStringContainsString(',Wholesale,active,yes,0,0.00,', $lines[1]);
    }

    public function test_permissions_on_the_customer_routes(): void
    {
        $customer = Customer::factory()->create();
        $sales = $this->signInAdmin(Admin::factory()->role('Sales staff')->create());
        // Sales staff may create, not edit or delete.
        $this->asAdmin($sales, 'POST', '/api/admin/v1/customers', ['first_name' => 'S', 'last_name' => 'T', 'email' => 's@example.com', 'phone' => '+15550100100'])
            ->assertCreated();
        $this->asAdmin($sales, 'PATCH', "/api/admin/v1/customers/{$customer->id}", ['first_name' => 'X'])->assertForbidden()->assertJsonPath('permission', 'customers.edit');
        $this->asAdmin($sales, 'DELETE', "/api/admin/v1/customers/{$customer->id}")->assertForbidden()->assertJsonPath('permission', 'customers.delete');
        $this->asAdmin($sales, 'POST', "/api/admin/v1/customers/{$customer->id}/notes", ['body' => 'x'])->assertForbidden();
        $this->asAdmin($sales, 'GET', "/api/admin/v1/customers/{$customer->id}/notes")->assertOk();

        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/customers/export.csv')->assertOk();
        $this->asAdmin($viewer, 'POST', '/api/admin/v1/customers', [])->assertForbidden()->assertJsonPath('permission', 'customers.create');
    }
}
