<?php

namespace Tests\Feature\Concerns;

use App\Models\Admin;
use App\Models\Product;
use Illuminate\Testing\TestResponse;

trait PlacesOrders
{
    protected function product(array $attributes = []): Product
    {
        return Product::factory()->create($attributes);
    }

    protected function checkoutBody(array $items, array $overrides = []): array
    {
        return array_merge([
            'items' => $items,
            'coupon_code' => null,
            'shipping_method' => 'standard',
            'payment_method' => 'cod',
            'email' => 'guest@example.com',
            'phone' => '+15550100100',
            'shipping_address' => [
                'first_name' => 'Ava', 'last_name' => 'Customer', 'line1' => '12 Market Street', 'line2' => null,
                'city' => 'Springfield', 'state' => 'Oregon', 'postal_code' => '29112', 'country' => 'United States',
            ],
            'billing_address' => null,
        ], $overrides);
    }

    protected function placeOrder(array $items, array $overrides = [], array $headers = []): TestResponse
    {
        return $this->postJson('/api/v1/orders', $this->checkoutBody($items, $overrides), $headers);
    }

    protected function adminHeaders(): array
    {
        $admin = Admin::factory()->create(['name' => 'Store Admin']);

        return ['Authorization' => 'Bearer '.$this->postJson('/api/admin/v1/auth/login', ['email' => $admin->email, 'password' => 'AdminPass123'])
            ->assertOk()->json('data.tokens.access_token')];
    }
}
