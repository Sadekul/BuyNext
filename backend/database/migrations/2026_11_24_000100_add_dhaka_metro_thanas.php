<?php

use Database\Seeders\BangladeshPlacesSeeder;
use Database\Seeders\DeliveryZonesSeeder;
use Illuminate\Database\Migrations\Migration;

/*
 * The dataset's 17 Dhaka metro thanas missed Banani, Badda, Wari, Rampura, Pallabi, Cantonment and
 * others, so shoppers there couldn't choose their area. Both seeders are idempotent: this adds the
 * Dhaka Metropolitan Police thanas from database/data/bd-geo/dhaka-metro-thanas.json and puts them
 * in the Inside Dhaka zone, without touching zones or places staff already changed.
 */
return new class extends Migration
{
    public function up(): void
    {
        (new BangladeshPlacesSeeder)->run();
        (new DeliveryZonesSeeder)->run();
    }

    public function down(): void
    {
        // Areas may be in use by saved addresses and orders: they stay.
    }
};
