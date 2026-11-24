<?php

use Database\Seeders\BangladeshPlacesSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 14: Bangladesh divisions, districts, and areas (upazilas and metro
 * thanas) for structured addresses, loaded from database/data/bd-geo by
 * BangladeshPlacesSeeder (idempotent; also run on its own).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bd_divisions', function (Blueprint $table) {
            $table->unsignedInteger('id')->primary();
            $table->string('name', 80);
            $table->string('bn_name', 80);
        });
        Schema::create('bd_districts', function (Blueprint $table) {
            $table->unsignedInteger('id')->primary();
            $table->unsignedInteger('division_id')->index();
            $table->string('name', 80);
            $table->string('bn_name', 80);
        });
        Schema::create('bd_areas', function (Blueprint $table) {
            $table->unsignedInteger('id')->primary();
            $table->unsignedInteger('district_id')->index();
            $table->string('kind', 10); // upazila | thana
            $table->string('name', 80);
            $table->string('bn_name', 80);
            $table->string('city_corporation', 80)->nullable();
            $table->json('postcodes')->nullable();
        });

        (new BangladeshPlacesSeeder)->run();
    }

    public function down(): void
    {
        Schema::dropIfExists('bd_areas');
        Schema::dropIfExists('bd_districts');
        Schema::dropIfExists('bd_divisions');
    }
};
