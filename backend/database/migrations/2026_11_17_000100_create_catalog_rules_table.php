<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 7: catalog price rules (Magento's Marketing → Catalog price rules):
 * automatic sale prices for groups of shoppers, categories, or products.
 * The id lists are JSON (a shop has a handful of rules, so they are matched
 * in PHP from a cached copy, never with SQL joins).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('catalog_rules', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120);
            $table->string('description', 500)->nullable();
            $table->boolean('is_active')->default(true);
            $table->dateTime('starts_at')->nullable();
            $table->dateTime('ends_at')->nullable();
            $table->json('customer_group_ids'); // [] = everyone, guests included
            $table->json('category_ids');       // [] = every category; a category includes its descendants
            $table->json('product_ids');        // [] = no product limit
            $table->string('action', 10);       // percent | fixed
            $table->decimal('amount', 10, 2);
            $table->unsignedSmallInteger('priority')->default(0); // lower first
            $table->boolean('stop_further')->default(false);
            $table->timestamps();
            $table->index(['is_active', 'priority']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('catalog_rules');
    }
};
