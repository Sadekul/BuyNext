<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 12: every run of php artisan buynest:currency:convert (the store's
 * prices multiplied into a new currency). A second run for the same target
 * is refused, so prices are never converted twice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('currency_conversions', function (Blueprint $table) {
            $table->id();
            $table->char('from_currency', 3);
            $table->char('to_currency', 3)->index();
            $table->decimal('rate', 18, 8);
            $table->decimal('rounding', 10, 2);
            $table->string('actor', 10)->default('cli'); // cli | admin
            $table->foreignId('admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->json('counts'); // { products: 12, product_variants: 4, ... }
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('currency_conversions');
    }
};
