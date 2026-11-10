<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The catalog: categories, brands, products, their images and reviews.
 * Money is DECIMAL(10,2), never FLOAT: decimals store cents exactly.
 * Products are soft-deleted, so old orders and links still find them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 100)->unique();
            $table->string('name', 120);
            $table->string('image_url', 2048)->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });

        Schema::create('brands', function (Blueprint $table) {
            $table->id();
            $table->string('name', 80)->unique();
            $table->timestamps();
        });

        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('sku', 64)->unique();
            $table->string('name', 160);
            $table->string('slug', 190)->unique();
            $table->text('description')->nullable();
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->foreignId('brand_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('price', 10, 2);
            $table->decimal('discount_percent', 5, 2)->default(0);
            $table->unsignedInteger('stock_quantity')->default(0);
            $table->unsignedInteger('min_order_quantity')->default(1);
            $table->enum('status', ['draft', 'active', 'archived'])->default('active');
            $table->decimal('rating_average', 3, 2)->default(0);
            $table->string('thumbnail_url', 2048)->nullable();
            $table->string('warranty', 190)->nullable();
            $table->string('shipping_info', 190)->nullable();
            $table->string('return_policy', 190)->nullable();
            $table->unsignedInteger('weight')->nullable();
            $table->json('tags')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // The storefront always filters on status (and lists by category).
            $table->index(['status', 'category_id']);
        });

        Schema::create('product_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->string('url', 2048);
            $table->string('alt', 190)->nullable();
            $table->unsignedInteger('position')->default(0);
        });

        Schema::create('reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('author_name', 120);
            $table->unsignedTinyInteger('rating');
            $table->text('comment');
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reviews');
        Schema::dropIfExists('product_images');
        Schema::dropIfExists('products');
        Schema::dropIfExists('brands');
        Schema::dropIfExists('categories');
    }
};
