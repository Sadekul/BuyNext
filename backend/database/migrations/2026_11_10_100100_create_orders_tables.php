<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Orders. Every item is a SNAPSHOT (name, sku, prices) taken at checkout, so
 * an order never changes when the product is edited or deleted later.
 * customer_id is null for guest orders.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            // "BN-100001" = 100000 + id, so it is set right after the insert (null for a moment).
            $table->string('number', 20)->nullable()->unique();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('email', 190)->index();
            $table->string('phone', 20);
            $table->string('status', 20)->index();
            $table->string('payment_status', 20);
            $table->string('payment_method', 20);
            $table->string('shipping_method', 20);
            $table->string('shipping_label', 60);
            $table->string('shipping_eta', 120);
            $table->string('coupon_code', 40)->nullable();
            $table->decimal('subtotal', 10, 2);
            $table->decimal('discount_total', 10, 2);
            $table->decimal('shipping_total', 10, 2);
            $table->decimal('tax_total', 10, 2);
            $table->decimal('grand_total', 10, 2);
            $table->json('shipping_address');
            $table->json('billing_address');
            $table->timestamp('placed_at');
            $table->timestamps();
        });

        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->nullable()->constrained()->nullOnDelete();
            $table->string('sku', 64);
            $table->string('name', 160);
            $table->string('thumbnail_url', 2048)->nullable();
            $table->decimal('unit_price', 10, 2);
            $table->decimal('discount_percent', 5, 2);
            $table->decimal('sale_price', 10, 2);
            $table->unsignedInteger('quantity');
            $table->decimal('line_total', 10, 2);
        });

        Schema::create('order_status_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->string('status', 20);
            $table->string('payment_status', 20)->nullable();
            $table->text('note')->nullable();
            $table->foreignId('admin_id')->nullable()->constrained()->nullOnDelete();
            $table->boolean('customer_notified')->default(false);
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_status_history');
        Schema::dropIfExists('order_items');
        Schema::dropIfExists('orders');
    }
};
