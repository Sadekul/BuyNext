<?php

namespace Database\Factories;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Product>
 *
 * An active product with no discount, plenty of stock, and a minimum order
 * of 1, so tests only state the details they are about.
 */
class ProductFactory extends Factory
{
    public function definition(): array
    {
        $name = Str::title(fake()->unique()->words(3, true));

        return [
            'sku' => 'TST-'.strtoupper(Str::random(8)),
            'name' => $name,
            'slug' => Str::slug($name).'-'.Str::lower(Str::random(4)),
            'description' => fake()->sentence(12),
            'category_id' => Category::factory(),
            'brand_id' => null,
            'price' => '10.00',
            'discount_percent' => '0.00',
            'stock_quantity' => 100,
            'min_order_quantity' => 1,
            'status' => 'active',
            'rating_average' => '4.00',
            'thumbnail_url' => 'https://cdn.example.com/'.Str::random(6).'/thumbnail.webp',
            'tags' => [],
        ];
    }

    public function draft(): static
    {
        return $this->state(['status' => 'draft']);
    }

    public function archived(): static
    {
        return $this->state(['status' => 'archived']);
    }

    public function outOfStock(): static
    {
        return $this->state(['stock_quantity' => 0]);
    }
}
