<?php

namespace Database\Factories;

use App\Models\Product;
use App\Models\Review;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Review> */
class ReviewFactory extends Factory
{
    public function definition(): array
    {
        return [
            'product_id' => Product::factory(),
            'author_name' => fake()->name(),
            'rating' => fake()->numberBetween(1, 5),
            'comment' => fake()->sentence(),
            'status' => 'approved',
            'verified_purchase' => false,
            'created_at' => now(),
        ];
    }

    public function pending(): static
    {
        return $this->state(['status' => 'pending']);
    }
}
