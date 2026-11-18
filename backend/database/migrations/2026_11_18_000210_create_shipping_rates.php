<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 10 (part B): shipping table rates (price by method, country, cart
 * weight, and subtotal), and an optional weight per variant (grams).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipping_rates', function (Blueprint $table) {
            $table->id();
            $table->string('method', 20);
            $table->string('country', 60)->default('*'); // a country name as in Settings → Checkout, or "*"
            $table->unsignedInteger('min_weight_grams')->default(0);
            $table->unsignedInteger('max_weight_grams')->nullable();
            $table->decimal('min_subtotal', 10, 2)->default(0);
            $table->decimal('max_subtotal', 10, 2)->nullable();
            $table->decimal('price', 10, 2);
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
            $table->index(['method', 'position']);
        });

        Schema::table('product_variants', function (Blueprint $table) {
            $table->unsignedInteger('weight')->nullable()->after('stock_quantity');
        });
    }

    public function down(): void
    {
        Schema::table('product_variants', fn (Blueprint $table) => $table->dropColumn('weight'));
        Schema::dropIfExists('shipping_rates');
    }
};
