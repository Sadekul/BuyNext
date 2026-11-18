<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 11: the wishlist kept on the server for signed-in customers, and its
 * share link. variant_key (the variant id, or 0) makes the unique key work for
 * rows without a variant too (MySQL allows many NULLs in a unique key). It is a
 * plain column set by WishlistItem: MySQL refuses a cascading foreign key on a
 * column a generated column reads.
 * The share token is stored only as a SHA-256 hash.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wishlist_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->unsignedBigInteger('variant_key')->default(0); // = product_variant_id ?? 0, kept by the model
            $table->string('note', 255)->nullable();
            $table->timestamp('created_at')->nullable();
            $table->unique(['customer_id', 'product_id', 'variant_key']);
            $table->index(['product_id', 'created_at']);
        });

        Schema::table('customers', function (Blueprint $table) {
            $table->char('wishlist_share_hash', 64)->nullable()->unique();
            $table->timestamp('wishlist_shared_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropUnique(['wishlist_share_hash']);
            $table->dropColumn(['wishlist_share_hash', 'wishlist_shared_at']);
        });
        Schema::dropIfExists('wishlist_items');
    }
};
