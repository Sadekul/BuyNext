<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 7: coupons grow into Magento-style cart price rules: conditions
 * (customer groups, categories or products), free shipping on any rule,
 * buy X get Y, and automatic rules without a code. Each use now remembers
 * the discount it gave (the coupon report shows automatic rules too).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('coupons', function (Blueprint $table) {
            $table->string('code', 40)->nullable()->change(); // null for automatic rules (MySQL allows many NULLs in a unique index)
            $table->json('customer_group_ids')->nullable()->after('min_subtotal');
            $table->string('applies_to', 12)->default('all')->after('customer_group_ids'); // all | categories | products
            $table->json('category_ids')->nullable()->after('applies_to');
            $table->json('product_ids')->nullable()->after('category_ids');
            $table->boolean('free_shipping')->default(false)->after('product_ids');
            $table->unsignedSmallInteger('buy_quantity')->nullable()->after('free_shipping');
            $table->unsignedSmallInteger('get_quantity')->nullable()->after('buy_quantity');
            $table->boolean('auto_apply')->default(false)->after('get_quantity');
            $table->index(['auto_apply', 'is_active']);
        });
        DB::table('coupons')->where('type', 'free_shipping')->update(['free_shipping' => true]);

        Schema::table('coupon_redemptions', function (Blueprint $table) {
            $table->decimal('discount', 10, 2)->nullable()->after('email');
        });
        // Before phase 7 an order had at most one coupon, so its discount was the order's.
        DB::table('coupon_redemptions')->update([
            'discount' => DB::raw('(SELECT discount_total FROM orders WHERE orders.id = coupon_redemptions.order_id)'),
        ]);

        Schema::table('orders', function (Blueprint $table) {
            $table->json('applied_rules')->nullable()->after('coupon_code');
        });
        Schema::table('order_items', function (Blueprint $table) {
            // The line's share of the cart rules' discount (null before phase 7: refunds then share the order's discount).
            $table->decimal('discount_amount', 10, 2)->nullable()->after('line_total');
            $table->string('price_label', 140)->nullable()->after('discount_amount');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', fn (Blueprint $table) => $table->dropColumn(['discount_amount', 'price_label']));
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn('applied_rules'));
        Schema::table('coupon_redemptions', fn (Blueprint $table) => $table->dropColumn('discount'));
        DB::table('coupons')->whereNull('code')->delete();
        Schema::table('coupons', function (Blueprint $table) {
            $table->dropIndex(['auto_apply', 'is_active']);
            $table->dropColumn(['customer_group_ids', 'applies_to', 'category_ids', 'product_ids', 'free_shipping', 'buy_quantity', 'get_quantity', 'auto_apply']);
            $table->string('code', 40)->nullable(false)->change();
        });
    }
};
