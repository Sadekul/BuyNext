<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Coupons move from config/buynest.php into the database (Magento's "Cart
 * Price Rules", simplified). times_used is a counter kept next to the rule so
 * checkout can lock ONE row and compare it with usage_limit; each use is
 * also recorded in coupon_redemptions (for per-customer limits).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('coupons', function (Blueprint $table) {
            $table->id();
            $table->string('code', 40)->unique(); // stored upper case
            $table->string('description', 160);
            $table->string('type', 20); // percent | fixed | free_shipping
            $table->decimal('value', 10, 2)->default(0);
            $table->decimal('min_subtotal', 10, 2)->nullable();
            $table->dateTime('starts_at')->nullable(); // dateTime, not timestamp: timestamps stop in 2038
            $table->dateTime('ends_at')->nullable();
            $table->unsignedInteger('usage_limit')->nullable();
            $table->unsignedInteger('usage_limit_per_customer')->nullable();
            $table->unsignedInteger('times_used')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('coupon_redemptions', function (Blueprint $table) {
            $table->id();
            // restrict: a coupon with redemptions is only ever disabled, never deleted.
            $table->foreignId('coupon_id')->constrained()->restrictOnDelete();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('email', 190);
            $table->timestamp('created_at')->nullable();
            $table->index(['coupon_id', 'customer_id']);
            $table->index(['coupon_id', 'email']);
        });

        // The two codes the shop had in phase 2, with the same rules (data, not just schema).
        $now = now();
        DB::table('coupons')->insertOrIgnore([
            ['code' => 'NEST10', 'description' => '10% off your order', 'type' => 'percent', 'value' => '10.00',
                'min_subtotal' => null, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
            ['code' => 'SAVE20', 'description' => '$20 off orders of $150 or more', 'type' => 'fixed', 'value' => '20.00',
                'min_subtotal' => '150.00', 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
        ]);

        // Orders placed before this migration used those codes too: record their
        // uses, so usage limits and "already used" checks count them.
        $coupons = DB::table('coupons')->pluck('id', 'code');
        $orders = DB::table('orders')->whereIn('coupon_code', $coupons->keys())->where('status', '!=', 'cancelled')
            ->orderBy('id')->get(['id', 'coupon_code', 'customer_id', 'email', 'placed_at']);
        foreach ($orders as $order) {
            DB::table('coupon_redemptions')->insert([
                'coupon_id' => $coupons[$order->coupon_code], 'order_id' => $order->id,
                'customer_id' => $order->customer_id, 'email' => mb_strtolower($order->email), 'created_at' => $order->placed_at,
            ]);
        }
        foreach ($coupons as $id) {
            DB::table('coupons')->where('id', $id)->update(['times_used' => DB::table('coupon_redemptions')->where('coupon_id', $id)->count()]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('coupon_redemptions');
        Schema::dropIfExists('coupons');
    }
};
