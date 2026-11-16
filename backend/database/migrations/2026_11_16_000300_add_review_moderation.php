<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 5: reviews written by customers, moderated by staff (Magento's
 * Marketing → Reviews). Only approved reviews are public. The reviews that
 * exist now are the imported DummyJSON ones, so they become approved.
 * products.review_count = the number of approved reviews (kept up to date
 * with rating_average whenever a review's status changes).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reviews', function (Blueprint $table) {
            $table->string('status', 10)->default('pending')->after('customer_id');
            $table->string('title', 120)->nullable()->after('rating');
            $table->boolean('verified_purchase')->default(false)->after('comment');
            $table->timestamp('updated_at')->nullable()->after('created_at');

            $table->index(['product_id', 'status']);
            $table->index('status');
            // One review per customer per product (imported reviews have no customer; NULLs never collide).
            $table->unique(['product_id', 'customer_id']);
        });

        DB::table('reviews')->update(['status' => 'approved', 'updated_at' => DB::raw('created_at')]);

        Schema::table('products', function (Blueprint $table) {
            $table->unsignedInteger('review_count')->default(0)->after('rating_average');
        });

        DB::statement("UPDATE products SET review_count = (SELECT COUNT(*) FROM reviews WHERE reviews.product_id = products.id AND reviews.status = 'approved')");
    }

    public function down(): void
    {
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn('review_count'));
        Schema::table('reviews', function (Blueprint $table) {
            $table->dropUnique(['product_id', 'customer_id']);
            $table->dropIndex(['product_id', 'status']);
            $table->dropIndex(['status']);
            $table->dropColumn(['status', 'title', 'verified_purchase', 'updated_at']);
        });
    }
};
