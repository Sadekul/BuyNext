<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\CustomerAddress;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Concerns\PlacesOrders;
use Tests\TestCase;

/** Phase 6: the customer address book (store and admin), and "save this address" at checkout. */
class AddressBookTest extends TestCase
{
    use PlacesOrders, RefreshDatabase;

    private Customer $customer;

    private array $headers;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->customer = Customer::factory()->create();
        $this->headers = $this->customerHeaders($this->customer);
    }

    private function customerHeaders(Customer $customer): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$this->postJson('/api/v1/auth/login', ['email' => $customer->email, 'password' => 'Password123'])
            ->assertOk()->json('data.tokens.access_token')];
    }

    private function address(array $overrides = []): array
    {
        return array_merge([
            'first_name' => 'Ava', 'last_name' => 'Customer', 'company' => null, 'phone' => '+1 555 010 0100',
            'line1' => '12 Market Street', 'line2' => null, 'city' => 'Springfield', 'state' => 'Oregon', 'postal_code' => '29112',
            'country' => 'United States',
        ], $overrides);
    }

    private function as(array $headers, string $method, string $uri, array $body = [])
    {
        $this->app['auth']->forgetGuards();

        return $this->json($method, $uri, $body, $headers);
    }

    public function test_a_customer_manages_their_addresses_and_the_first_becomes_default(): void
    {
        $first = $this->as($this->headers, 'POST', '/api/v1/me/addresses', $this->address())->assertCreated();
        $first->assertJsonPath('data.phone', '+15550100100')
            ->assertJsonPath('data.is_default_shipping', true)
            ->assertJsonPath('data.is_default_billing', true);
        $this->assertSame(['id', 'first_name', 'last_name', 'company', 'phone', 'line1', 'line2', 'city', 'state', 'postal_code', 'country',
            'is_default_shipping', 'is_default_billing', 'created_at', 'updated_at'], array_keys($first->json('data')));

        // A second address that is the new default shipping clears the flag on the first only for shipping.
        $second = $this->as($this->headers, 'POST', '/api/v1/me/addresses', $this->address(['line1' => '9 Elm Road', 'is_default_shipping' => true]))
            ->assertCreated()->assertJsonPath('data.is_default_shipping', true)->assertJsonPath('data.is_default_billing', false);
        $this->assertFalse(CustomerAddress::find($first->json('data.id'))->is_default_shipping);
        $this->assertTrue(CustomerAddress::find($first->json('data.id'))->is_default_billing);

        // PATCH only changes what is sent; making it the billing default clears the other.
        $this->as($this->headers, 'PATCH', '/api/v1/me/addresses/'.$second->json('data.id'), ['city' => 'Portland', 'is_default_billing' => true])
            ->assertOk()->assertJsonPath('data.city', 'Portland')->assertJsonPath('data.line1', '9 Elm Road')->assertJsonPath('data.is_default_billing', true);
        $this->assertSame(1, CustomerAddress::where('is_default_billing', true)->count());
        $this->assertSame(1, CustomerAddress::where('is_default_shipping', true)->count());

        $list = $this->as($this->headers, 'GET', '/api/v1/me/addresses')->assertOk();
        $this->assertSame([$second->json('data.id'), $first->json('data.id')], array_column($list->json('data'), 'id'));

        $this->as($this->headers, 'DELETE', '/api/v1/me/addresses/'.$first->json('data.id'))->assertNoContent();
        $this->assertSame(1, $this->customer->addresses()->count());
    }

    public function test_validation_and_allowed_countries(): void
    {
        $this->as($this->headers, 'POST', '/api/v1/me/addresses', $this->address(['country' => 'Narnia', 'postal_code' => '!', 'phone' => '123']))
            ->assertUnprocessable()->assertJsonValidationErrors(['country', 'postal_code', 'phone'])
            ->assertJsonPath('errors.country.0', 'We don\'t deliver to that country yet.');
        $this->as($this->headers, 'POST', '/api/v1/me/addresses', [])->assertUnprocessable()
            ->assertJsonValidationErrors(['first_name', 'last_name', 'phone', 'line1', 'city', 'postal_code', 'country']);
    }

    public function test_another_customers_address_is_not_found(): void
    {
        $other = Customer::factory()->create();
        $theirs = $other->addresses()->create([...$this->address(), 'phone' => '+15550100100']);

        $this->as($this->headers, 'PATCH', "/api/v1/me/addresses/{$theirs->id}", ['city' => 'Hacked'])->assertNotFound();
        $this->as($this->headers, 'DELETE', "/api/v1/me/addresses/{$theirs->id}")->assertNotFound();
        $this->assertSame([], $this->as($this->headers, 'GET', '/api/v1/me/addresses')->json('data'));
        $this->assertSame('Springfield', $theirs->fresh()->city);
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/me/addresses')->assertUnauthorized();
    }

    public function test_at_most_twenty_addresses(): void
    {
        for ($i = 0; $i < 20; $i++) {
            $this->customer->addresses()->create([...$this->address(), 'phone' => '+15550100100', 'line1' => "{$i} Main St"]);
        }
        $this->as($this->headers, 'POST', '/api/v1/me/addresses', $this->address())->assertUnprocessable()->assertJsonValidationErrors('address');
        $this->assertSame(20, $this->customer->addresses()->count());
    }

    public function test_checkout_saves_the_address_once_and_skips_a_full_book(): void
    {
        $product = $this->product(['stock_quantity' => 10]);
        $items = [['product_id' => $product->id, 'quantity' => 1]];

        $this->placeOrder($items, ['save_address' => true], $this->headers)->assertCreated();
        $saved = $this->customer->addresses()->sole();
        $this->assertSame('12 Market Street', $saved->line1);
        $this->assertSame('+15550100100', $saved->phone);
        $this->assertTrue($saved->is_default_shipping);

        // The same address again (different case): not added twice. Without the flag: not added.
        $this->app['auth']->forgetGuards();
        $this->placeOrder($items, ['save_address' => true, 'shipping_address' => [...$this->checkoutBody([])['shipping_address'], 'city' => 'SPRINGFIELD']],
            $this->headers)->assertCreated();
        $this->app['auth']->forgetGuards();
        $this->placeOrder($items, ['shipping_address' => [...$this->checkoutBody([])['shipping_address'], 'line1' => '1 Other Way']], $this->headers)->assertCreated();
        $this->assertSame(1, $this->customer->addresses()->count());

        // A full book: the order still goes through, the address is skipped.
        for ($i = 0; $i < 19; $i++) {
            $this->customer->addresses()->create([...$this->address(), 'phone' => '+15550100100', 'line1' => "{$i} Main St"]);
        }
        $this->app['auth']->forgetGuards();
        $this->placeOrder($items, ['save_address' => true, 'shipping_address' => [...$this->checkoutBody([])['shipping_address'], 'line1' => '77 New St']],
            $this->headers)->assertCreated();
        $this->assertSame(20, $this->customer->addresses()->count());

        // Guests: ignored.
        $this->app['auth']->forgetGuards();
        $this->placeOrder($items, ['save_address' => true])->assertCreated();
        $this->assertSame(20, CustomerAddress::count());
    }

    public function test_staff_manage_a_customers_addresses_with_audit(): void
    {
        $admin = $this->adminHeaders();
        $created = $this->asAdmin($admin, 'POST', "/api/admin/v1/customers/{$this->customer->id}/addresses", $this->address())->assertCreated();
        $id = $created->json('data.id');
        $this->asAdmin($admin, 'PATCH', "/api/admin/v1/customers/{$this->customer->id}/addresses/{$id}", ['company' => 'Acme'])
            ->assertOk()->assertJsonPath('data.company', 'Acme');
        $this->asAdmin($admin, 'GET', "/api/admin/v1/customers/{$this->customer->id}/addresses")->assertOk()->assertJsonPath('data.0.id', $id);

        $other = Customer::factory()->create();
        $this->asAdmin($admin, 'PATCH', "/api/admin/v1/customers/{$other->id}/addresses/{$id}", ['company' => 'X'])->assertNotFound();
        $this->asAdmin($admin, 'DELETE', "/api/admin/v1/customers/{$this->customer->id}/addresses/{$id}")->assertNoContent();

        $this->assertDatabaseHas('audit_log', ['action' => 'customer.address_added', 'subject_id' => $this->customer->id]);
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.address_updated', 'subject_id' => $this->customer->id]);
        $this->assertDatabaseHas('audit_log', ['action' => 'customer.address_deleted', 'subject_id' => $this->customer->id]);
    }
}
