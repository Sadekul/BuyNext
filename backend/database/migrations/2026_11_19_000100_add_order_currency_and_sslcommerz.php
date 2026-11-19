<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 12:
 * - orders.currency: the currency the order was placed (and charged) in, so
 *   its invoices, credit memos, PDFs, and emails stay right after the store
 *   currency changes. Every order before phase 12 was in dollars: back-filled USD
 *   (the column default does it, in one statement).
 * - orders.payment_details: what SSLCommerz told us about the payment
 *   (tran_id, val_id, bank_tran_id, card_type, card_brand, card_issuer, risk).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->char('currency', 3)->default('USD')->after('grand_total');
            $table->json('payment_details')->nullable()->after('paid_at');
        });
    }

    public function down(): void
    {
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn(['currency', 'payment_details']));
    }
};
