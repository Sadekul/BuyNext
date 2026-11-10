<?php

namespace Database\Factories;

use App\Models\Admin;
use App\Models\AdminRole;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Admin> */
class AdminFactory extends Factory
{
    /** By default an Owner (every permission), like every admin before phase 4. */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'password' => 'AdminPass123',
            'role_id' => fn () => AdminRole::owner()?->id,
        ];
    }

    /** An admin with one of the seeded roles ("Sales staff") or a role made of exactly these permission keys. */
    public function role(string|array $role): static
    {
        return $this->state(fn () => ['role_id' => is_array($role)
            ? AdminRole::create(['name' => 'Test role '.fake()->unique()->numberBetween(1, 1_000_000), 'permissions' => $role])->id
            : AdminRole::where('name', $role)->firstOrFail()->id]);
    }
}
