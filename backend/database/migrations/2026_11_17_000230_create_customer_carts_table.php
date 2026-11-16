<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 7: a signed-in customer's cart, saved whenever the storefront
 * validates it. It lets the cart follow the customer to another device and
 * feeds the abandoned carts report (Magento's Reports → Abandoned carts).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_carts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->unique()->constrained('customers')->cascadeOnDelete();
            $table->json('items'); // [{ product_id, variant_id, quantity }]
            $table->decimal('subtotal', 12, 2)->default(0);
            $table->unsignedInteger('item_count')->default(0);
            $table->timestamp('reminded_at')->nullable();
            $table->timestamp('converted_at')->nullable();
            $table->timestamps();
            $table->index(['converted_at', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_carts');
    }
};
