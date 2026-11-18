<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 11: display currencies. Shoppers may see prices converted with these
 * rates (typed in by staff: units per 1 of the base currency); orders are
 * always charged in the base currency. BDT and EUR are seeded as switched-off
 * examples without a rate.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('currency_rates', function (Blueprint $table) {
            $table->id();
            $table->char('code', 3)->unique();
            $table->string('symbol', 5);
            $table->decimal('rate', 18, 8)->default(0);
            $table->unsignedTinyInteger('decimals')->default(2);
            $table->boolean('enabled')->default(false);
            $table->unsignedSmallInteger('position')->default(0);
            $table->timestamps();
        });

        $now = now();
        DB::table('currency_rates')->insert([
            ['code' => 'BDT', 'symbol' => '৳', 'rate' => 0, 'decimals' => 2, 'enabled' => false, 'position' => 1, 'created_at' => $now, 'updated_at' => $now],
            ['code' => 'EUR', 'symbol' => '€', 'rate' => 0, 'decimals' => 2, 'enabled' => false, 'position' => 2, 'created_at' => $now, 'updated_at' => $now],
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('currency_rates');
    }
};
