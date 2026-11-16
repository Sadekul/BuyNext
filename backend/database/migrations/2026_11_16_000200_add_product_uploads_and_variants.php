<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 5: uploaded product images, and configurable products (Magento's
 * options + variants).
 *
 * - product_images.path: the file on the `public` disk for uploads; null for
 *   external URLs (the imported DummyJSON images).
 * - A product with options sells only through its variants (has_variants).
 *   Its stock_quantity is kept equal to the sum of its active variants' stock.
 * - Variants are never deleted (old orders keep their link); option_key is
 *   the sorted value ids joined with "-", so a combination exists once per product.
 * - order_items remember the variant and its label ("Size: M / Color: Red").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_images', function (Blueprint $table) {
            $table->string('path', 255)->nullable()->after('url');
        });

        Schema::table('products', function (Blueprint $table) {
            $table->boolean('has_variants')->default(false)->after('min_order_quantity');
        });

        Schema::create('product_options', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->string('name', 40);
            $table->unsignedInteger('position')->default(0);
        });

        Schema::create('product_option_values', function (Blueprint $table) {
            $table->id();
            $table->foreignId('option_id')->constrained('product_options')->cascadeOnDelete();
            $table->string('value', 40);
            $table->unsignedInteger('position')->default(0);
        });

        Schema::create('product_variants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->string('sku', 64)->unique();
            $table->json('option_value_ids');
            $table->string('option_key', 191);
            $table->decimal('price', 10, 2)->nullable();
            $table->unsignedInteger('stock_quantity')->default(0);
            $table->boolean('is_active')->default(false);
            $table->timestamps();

            $table->unique(['product_id', 'option_key']);
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->foreignId('variant_id')->nullable()->after('product_id')->constrained('product_variants')->nullOnDelete();
            $table->string('variant_label', 255)->nullable()->after('name');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('variant_id');
            $table->dropColumn('variant_label');
        });
        Schema::dropIfExists('product_variants');
        Schema::dropIfExists('product_option_values');
        Schema::dropIfExists('product_options');
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn('has_variants'));
        Schema::table('product_images', fn (Blueprint $table) => $table->dropColumn('path'));
    }
};
