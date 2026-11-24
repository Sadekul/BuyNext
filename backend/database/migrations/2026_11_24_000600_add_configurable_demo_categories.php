<?php

use Database\Seeders\ConfigurableDemoSeeder;
use Illuminate\Database\Migrations\Migration;

/*
 * More demo products with choices, by category (asked by the user: "many products have no variation; it should
 * be sizes and colors"): shirts, tops, dresses, and shoes get Color × Size; phones and tablets Storage × Color;
 * laptops RAM × Storage; watches, sunglasses, and bags Color. Only imported demo products without options are
 * changed (their DummyJSON SKU ends with their own id), never staff products; four products the browser suites
 * buy as simple products stay simple (ConfigurableDemoSeeder::KEEP_SIMPLE).
 */
return new class extends Migration
{
    public function up(): void
    {
        (new ConfigurableDemoSeeder)->run();
    }

    public function down(): void
    {
        // Staff may have changed the options, variants, or stock since: they stay.
    }
};
