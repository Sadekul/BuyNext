<?php

use Database\Seeders\ConfigurableDemoSeeder;
use Illuminate\Database\Migrations\Migration;

/*
 * Phase 16: six demo products become configurable (colour swatches + sizes, phones with storage and
 * colour, a laptop with RAM and storage). Only products that still have their demo SKU and name and
 * no options or variants are changed (see the seeder). On a fresh install the products don't exist
 * yet here; buynest:import-catalog runs the seeder again after importing.
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
