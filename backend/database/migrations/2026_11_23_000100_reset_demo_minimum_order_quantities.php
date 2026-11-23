<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * The catalog was imported from DummyJSON, whose minimumOrderQuantity values are random demo data
 * (156 of 196 products above 1; Apple Airpods 4), so one "Add to cart" click added several units.
 * Products now sell one at a time; staff can still set a real minimum per product in the admin.
 * Runs once (before any shop has set its own minimums), and there is nothing to undo.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('products')->where('min_order_quantity', '>', 1)->update(['min_order_quantity' => 1]);
    }

    public function down(): void
    {
        // The demo values aren't kept; re-importing no longer brings them back either.
    }
};
