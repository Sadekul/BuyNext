<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 11: product specifications (an ordered list of { label, value }) and
 * Magento-style product links: related products, up-sells, and cross-sells.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->json('specifications')->nullable();
        });

        Schema::create('product_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->foreignId('linked_product_id')->constrained('products')->cascadeOnDelete();
            $table->string('type', 20); // related | upsell | crosssell
            $table->unsignedSmallInteger('position')->default(0);
            $table->unique(['product_id', 'linked_product_id', 'type']);
            $table->index(['product_id', 'type', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_links');
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn('specifications'));
    }
};
