<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 17: "Best selling" sums order_items.quantity of the orders placed in
 * the last 90 days (not cancelled). An index on orders.created_at keeps that
 * window cheap as orders grow, and (product_id, order_id, quantity) lets the
 * sum read the index alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->index(['created_at', 'status'], 'orders_created_at_status_index');
        });
        Schema::table('order_items', function (Blueprint $table) {
            $table->index(['order_id', 'product_id', 'quantity'], 'order_items_order_product_quantity_index');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropIndex('order_items_order_product_quantity_index');
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('orders_created_at_status_index');
        });
    }
};
