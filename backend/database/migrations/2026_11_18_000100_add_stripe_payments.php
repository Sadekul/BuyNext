<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 8: card payments through Stripe Checkout.
 * - orders: who took the payment (provider "stripe"), its reference (the
 *   PaymentIntent id), the current Checkout Session (id, address, expiry),
 *   how many sessions were made (for idempotency keys), and when it was paid.
 * - credit_memos.refund_reference: the Stripe refund id.
 * - stripe_events: every webhook event handled, so a retried event is done once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('payment_provider', 20)->nullable()->after('payment_method');
            $table->string('payment_reference', 100)->nullable()->after('payment_provider');
            $table->string('payment_session_id', 100)->nullable()->after('payment_reference')->index();
            $table->text('payment_url')->nullable()->after('payment_session_id');
            $table->timestamp('payment_expires_at')->nullable()->after('payment_url');
            $table->unsignedSmallInteger('payment_attempts')->default(0)->after('payment_expires_at');
            $table->timestamp('paid_at')->nullable()->after('payment_attempts');
        });

        Schema::table('credit_memos', function (Blueprint $table) {
            $table->string('refund_reference', 100)->nullable()->after('total');
        });

        Schema::create('stripe_events', function (Blueprint $table) {
            $table->string('id', 255)->primary(); // Stripe's event id (evt_...)
            $table->string('type', 100);
            $table->timestamp('processed_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stripe_events');
        Schema::table('credit_memos', fn (Blueprint $table) => $table->dropColumn('refund_reference'));
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['payment_session_id']);
            $table->dropColumn(['payment_provider', 'payment_reference', 'payment_session_id', 'payment_url',
                'payment_expires_at', 'payment_attempts', 'paid_at']);
        });
    }
};
