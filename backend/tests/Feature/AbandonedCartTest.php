<?php

namespace Tests\Feature;

use App\Mail\AbandonedCartMail;
use App\Models\Admin;
use App\Models\Customer;
use App\Models\CustomerCart;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 7: saved carts (abandoned cart report, reminders, cart restore on another device). */
class AbandonedCartTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Customer $customer;

    private array $customerHeaders;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->customer = Customer::factory()->create(['first_name' => 'Ava']);
        $this->customerHeaders = $this->customerHeaders($this->customer);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    private function validateCart(array $items, array $headers = []): void
    {
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/cart/validate', ['items' => $items, 'shipping_method' => 'standard'], $headers)->assertOk();
    }

    public function test_validating_saves_a_signed_in_cart_only(): void
    {
        $mug = $this->product(['price' => '10.00']);
        $this->validateCart([['product_id' => $mug->id, 'quantity' => 1], ['product_id' => $mug->id, 'quantity' => 2]], $this->customerHeaders);
        $cart = CustomerCart::sole();
        $this->assertEquals([['product_id' => $mug->id, 'variant_id' => null, 'quantity' => 3]], $cart->items);
        $this->assertSame(['30.00', 3], [$cart->subtotal, $cart->item_count]);

        $this->validateCart([['product_id' => $mug->id, 'quantity' => 1]]); // a guest
        $this->assertSame(1, CustomerCart::count());

        $this->validateCart([], $this->customerHeaders);
        $this->assertSame(0, CustomerCart::count());
    }

    public function test_two_price_checks_at_once_update_the_one_saved_cart(): void
    {
        // Phase 23's browser runs: checkout asks for prices again when the address or payment changes, and two
        // requests at the same moment both found no saved cart. The second insert hit the unique customer_id
        // and answered 500, so the order couldn't be placed. Here the "other request" adds its row just before ours.
        $mug = $this->product(['price' => '10.00']);
        $raced = false;
        CustomerCart::creating(function (CustomerCart $cart) use (&$raced) {
            if (! $raced) {
                $raced = true;
                DB::table('customer_carts')->insert(['customer_id' => $cart->customer_id, 'items' => json_encode([]), 'subtotal' => '0.00',
                    'item_count' => 0, 'created_at' => now(), 'updated_at' => now()]);
            }
        });

        $this->validateCart([['product_id' => $mug->id, 'quantity' => 2]], $this->customerHeaders);

        $this->assertTrue($raced);
        $cart = CustomerCart::sole(); // still one row, now with this request's items
        $this->assertEquals([['product_id' => $mug->id, 'variant_id' => null, 'quantity' => 2]], $cart->items);
        $this->assertSame(['20.00', 2], [$cart->subtotal, $cart->item_count]);
    }

    public function test_placing_an_order_converts_the_cart(): void
    {
        $mug = $this->product();
        $this->validateCart([['product_id' => $mug->id, 'quantity' => 1]], $this->customerHeaders);
        $this->app['auth']->forgetGuards();
        $this->placeOrder([['product_id' => $mug->id, 'quantity' => 1]], ['email' => $this->customer->email], $this->customerHeaders)->assertCreated();

        $this->assertNotNull(CustomerCart::sole()->converted_at);
        $this->getJson('/api/v1/me/cart', $this->customerHeaders)->assertOk()->assertJsonPath('data.items', []);
        $this->travel(2)->hours();
        $this->asAdmin($this->adminHeaders(), 'GET', '/api/admin/v1/reports/abandoned-carts')->assertJsonCount(0, 'data');
    }

    public function test_the_report_lists_carts_idle_for_an_hour(): void
    {
        $mug = $this->product(['name' => 'Mug', 'price' => '12.00']);
        $this->validateCart([['product_id' => $mug->id, 'quantity' => 2]], $this->customerHeaders);
        $this->asAdmin($this->adminHeaders(), 'GET', '/api/admin/v1/reports/abandoned-carts')->assertOk()->assertJsonCount(0, 'data');
        $this->travel(61)->minutes();
        $admin = $this->adminHeaders(); // admin tokens last an hour
        $this->asAdmin($admin, 'GET', '/api/admin/v1/reports/abandoned-carts')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.customer.id', $this->customer->id)
            ->assertJsonPath('data.0.subtotal', '24.00')
            ->assertJsonPath('data.0.items.0.name', 'Mug')
            ->assertJsonPath('data.0.items.0.sale_price', '12.00')
            ->assertJsonPath('data.0.can_remind', true);
        $this->asAdmin($admin, 'GET', '/api/admin/v1/reports/abandoned-carts?min_subtotal=30')->assertJsonCount(0, 'data');
        $this->asAdmin($admin, 'GET', '/api/admin/v1/reports/abandoned-carts?min_age_hours=2')->assertJsonCount(0, 'data');
    }

    public function test_a_reminder_goes_at_most_once_per_72_hours_and_only_to_active_customers(): void
    {
        $mug = $this->product(['name' => 'Mug']);
        $this->validateCart([['product_id' => $mug->id, 'quantity' => 1]], $this->customerHeaders);
        $admin = Admin::factory()->create();
        // Signs in again each time: the test travels days ahead and admin tokens last an hour.
        $remind = fn () => $this->asAdmin($this->signInAdmin($admin), 'POST', "/api/admin/v1/reports/abandoned-carts/{$this->customer->id}/remind");

        $remind()->assertUnprocessable()->assertJsonValidationErrors('cart'); // still shopping
        $this->travel(2)->hours();
        $remind()->assertOk()->assertJsonPath('data.email', $this->customer->email);
        Mail::assertSent(AbandonedCartMail::class, fn ($m) => $m->hasTo($this->customer->email)
            && $m->envelope()->subject === 'You left something in your cart' && str_contains($m->render(), 'Mug × 1')
            && str_contains($m->render(), config('buynest.storefront_url').'/cart'));
        $remind()->assertStatus(429)->assertJsonPath('code', 'too_soon')->assertHeader('Retry-After');
        $this->travel(73)->hours();
        $remind()->assertOk();
        Mail::assertSent(AbandonedCartMail::class, 2);

        $this->customer->forceFill(['is_active' => false])->save();
        $this->travel(73)->hours();
        $remind()->assertUnprocessable()->assertJsonValidationErrors('customer');
        $this->asAdmin($this->signInAdmin($admin), 'POST', '/api/admin/v1/reports/abandoned-carts/999999/remind')->assertNotFound();
        $this->assertDatabaseHas('audit_log', ['action' => 'cart.reminded', 'subject_id' => $this->customer->id]);
    }

    public function test_reminding_needs_newsletter_send(): void
    {
        $viewer = $this->signInAdmin(Admin::factory()->role('Viewer')->create());
        $this->asAdmin($viewer, 'GET', '/api/admin/v1/reports/abandoned-carts')->assertOk();
        $this->asAdmin($viewer, 'POST', "/api/admin/v1/reports/abandoned-carts/{$this->customer->id}/remind")
            ->assertForbidden()->assertJsonPath('permission', 'newsletter.send');
    }

    public function test_the_cart_is_restored_and_merged_capped_by_stock(): void
    {
        $mug = $this->product(['stock_quantity' => 5]);
        $lamp = $this->product(['stock_quantity' => 50]);
        $gone = $this->product(['stock_quantity' => 0]);
        $this->validateCart([['product_id' => $mug->id, 'quantity' => 4], ['product_id' => $gone->id, 'quantity' => 1]], $this->customerHeaders);

        $this->getJson('/api/v1/me/cart', $this->customerHeaders)->assertOk()
            ->assertJsonPath('data.items', [['product_id' => $mug->id, 'variant_id' => null, 'quantity' => 4]])
            ->assertJsonPath('data.item_count', 4);

        $this->postJson('/api/v1/me/cart/merge', ['items' => [['product_id' => $mug->id, 'quantity' => 3], ['product_id' => $lamp->id, 'quantity' => 2]]], $this->customerHeaders)
            ->assertOk()->assertJsonPath('data.items', [
                ['product_id' => $mug->id, 'variant_id' => null, 'quantity' => 5], // 4 + 3, capped by stock
                ['product_id' => $lamp->id, 'variant_id' => null, 'quantity' => 2],
            ]);
        $this->assertSame(7, CustomerCart::sole()->item_count);

        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/me/cart')->assertUnauthorized();
    }
}
