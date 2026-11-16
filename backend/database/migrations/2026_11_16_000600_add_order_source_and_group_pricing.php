<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 6: where an order came from (the storefront, or staff taking a phone
 * order in the admin), and the customer-group price it got.
 *   orders.source                  storefront | admin (existing orders: storefront)
 *   orders.created_by_admin_id     who placed an admin order
 *   orders.customer_group          the group's name at the time of the order
 *   order_items.group_discount_percent  the group discount that line got (0 before phase 6)
 * order_items.sale_price stays "what one unit cost", now after the group discount.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('source', 20)->default('storefront')->after('status')->index();
            $table->foreignId('created_by_admin_id')->nullable()->after('source')->constrained('admins')->nullOnDelete();
            $table->string('customer_group', 60)->nullable()->after('customer_id');
        });
        DB::table('orders')->whereNull('source')->update(['source' => 'storefront']);

        Schema::table('order_items', function (Blueprint $table) {
            $table->decimal('group_discount_percent', 5, 2)->default(0)->after('discount_percent');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn('group_discount_percent');
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('created_by_admin_id');
            $table->dropIndex(['source']);
            $table->dropColumn(['source', 'customer_group']);
        });
    }
};
