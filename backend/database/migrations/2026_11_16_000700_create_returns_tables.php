<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 6: returns (Magento's RMA). "RMA-100001" = 100000 + id.
 *   requested → approved | rejected, approved → received, received → refunded | closed
 * restocked: the items went back to stock when the parcel was received, so
 * the credit memo for the return must not restock them again.
 * customer_notified: whether the last status change was emailed (the
 * customer sees admin_note only then, like order history notes).
 * credit_memos.return_id links the refund that settled a return.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('returns', function (Blueprint $table) {
            $table->id();
            $table->string('number', 20)->nullable()->unique();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('status', 20)->index();
            $table->string('reason', 60);
            $table->text('comment')->nullable();
            $table->text('admin_note')->nullable();
            $table->string('resolution', 20)->nullable();
            $table->boolean('restocked')->default(false);
            $table->boolean('customer_notified')->default(false);
            $table->foreignId('created_by_admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('return_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('return_id')->constrained('returns')->cascadeOnDelete();
            $table->foreignId('order_item_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('quantity');
            $table->string('condition', 20)->nullable();
        });

        Schema::table('credit_memos', function (Blueprint $table) {
            $table->foreignId('return_id')->nullable()->after('order_id')->constrained('returns')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('credit_memos', function (Blueprint $table) {
            $table->dropConstrainedForeignId('return_id');
        });
        Schema::dropIfExists('return_items');
        Schema::dropIfExists('returns');
    }
};
