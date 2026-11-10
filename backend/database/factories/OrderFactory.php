<?php

namespace Database\Factories;

use App\Models\Order;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Order>
 *
 * A bare guest order (no items) for list and search tests. Tests about money
 * and stock place real orders through POST /api/v1/orders instead.
 */
class OrderFactory extends Factory
{
    public function definition(): array
    {
        $address = [
            'first_name' => fake()->firstName(), 'last_name' => fake()->lastName(), 'line1' => fake()->streetAddress(),
            'line2' => null, 'city' => fake()->city(), 'state' => null, 'postal_code' => '12345', 'country' => 'United States',
        ];

        return [
            'email' => fake()->unique()->safeEmail(),
            'phone' => '+15550100100',
            'status' => 'processing',
            'payment_status' => 'unpaid',
            'payment_method' => 'cod',
            'shipping_method' => 'standard',
            'shipping_label' => 'Standard',
            'shipping_eta' => '3–5 business days',
            'subtotal' => '50.00',
            'discount_total' => '0.00',
            'shipping_total' => '0.00',
            'tax_total' => '0.00',
            'grand_total' => '50.00',
            'shipping_address' => $address,
            'billing_address' => $address,
            'placed_at' => now(),
        ];
    }

    /** Orders get their number from their id, right after the insert (like Checkout). */
    public function configure(): static
    {
        return $this->afterCreating(fn (Order $order) => $order->forceFill(['number' => Order::numberFor($order->id)])->save());
    }
}
