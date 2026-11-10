<?php

namespace Database\Seeders;

use App\Models\Admin;
use App\Models\Customer;
use Illuminate\Database\Seeder;

/**
 * Demo accounts for local development only (php artisan db:seed).
 * Production admins are created with `php artisan buynest:create-admin`.
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->command?->warn('Demo accounts are only seeded in local development.');

            return;
        }

        Admin::updateOrCreate(['email' => 'admin@buynest.test'], ['name' => 'Store Admin', 'password' => 'AdminPass2026']);

        // Two shoppers, so "my data stays mine" can be tried on one browser.
        $shoppers = [
            ['email' => 'customer@buynest.test', 'first_name' => 'Ava', 'last_name' => 'Customer', 'phone' => '+15550100100', 'password' => 'CustomerPass2026'],
            ['email' => 'shopper2@buynest.test', 'first_name' => 'Ben', 'last_name' => 'Shopper', 'phone' => '+15550100101', 'password' => 'ShopperPass2026'],
        ];
        foreach ($shoppers as $shopper) {
            Customer::updateOrCreate(['email' => $shopper['email']], $shopper)
                ->forceFill(['email_verified_at' => now(), 'is_active' => true])->save();
        }
    }
}
