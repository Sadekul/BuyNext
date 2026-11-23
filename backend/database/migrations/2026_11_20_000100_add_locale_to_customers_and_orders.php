<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 13 (Bangla and English):
 * - customers.locale: the shopper's chosen language (en|bn), saved with
 *   PATCH /api/v1/me { locale }; null = the store default. Emails use it.
 * - orders.locale: the language the order was placed in (the request's), so
 *   a guest's emails and PDFs are in that language. Every older order was
 *   placed in English: back-filled "en" by the column default.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('locale', 5)->nullable()->after('phone');
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->char('locale', 2)->default('en')->after('currency');
        });
    }

    public function down(): void
    {
        Schema::table('customers', fn (Blueprint $table) => $table->dropColumn('locale'));
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn('locale'));
    }
};
