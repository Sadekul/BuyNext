<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 9 (part B): "Email me when it's back in stock".
 * One row per (product, variant, email) while it waits: waiting_key is
 * "product:variant:email" (hashed) until the alert is sent, then null, so the
 * unique index only covers waiting alerts and the same person can ask again
 * after the next sell-out. token_hash: the "stop these alerts" link's secret
 * (sha256; the link carries "{id}.{token}").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_alerts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            $table->string('email', 190);
            $table->foreignId('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->char('token_hash', 64);
            $table->char('waiting_key', 64)->nullable()->unique();
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('notified_at')->nullable();
            $table->index(['product_id', 'notified_at']);
            $table->index('email');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_alerts');
    }
};
