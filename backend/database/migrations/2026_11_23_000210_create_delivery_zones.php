<?php

use Database\Seeders\DeliveryZonesSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 14: delivery zones (Inside Dhaka, Dhaka suburbs, Outside Dhaka) and
 * the places in them; shipping table rates per zone with a delivery time.
 * The zones and their places are seeded, never prices.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_zones', function (Blueprint $table) {
            $table->id();
            $table->string('code', 40)->unique();
            $table->string('name', 80);
            $table->string('bn_name', 80);
            $table->unsignedInteger('position')->default(0);
            $table->boolean('is_active')->default(true);
            $table->boolean('is_fallback')->default(false);
            $table->timestamps();
        });
        Schema::create('delivery_zone_places', function (Blueprint $table) {
            $table->id();
            $table->foreignId('zone_id')->constrained('delivery_zones')->cascadeOnDelete();
            // One of the two; a place belongs to at most one zone.
            $table->unsignedInteger('district_id')->nullable()->unique();
            $table->unsignedInteger('area_id')->nullable()->unique();
            $table->timestamps();
        });
        Schema::table('shipping_rates', function (Blueprint $table) {
            $table->string('zone_code', 40)->nullable()->after('country');
            $table->unsignedSmallInteger('eta_days_min')->nullable()->after('price');
            $table->unsignedSmallInteger('eta_days_max')->nullable()->after('eta_days_min');
        });

        (new DeliveryZonesSeeder)->run();
    }

    public function down(): void
    {
        Schema::table('shipping_rates', fn (Blueprint $table) => $table->dropColumn(['zone_code', 'eta_days_min', 'eta_days_max']));
        Schema::dropIfExists('delivery_zone_places');
        Schema::dropIfExists('delivery_zones');
    }
};
