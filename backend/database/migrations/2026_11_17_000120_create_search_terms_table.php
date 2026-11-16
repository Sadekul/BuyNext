<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 7: what shoppers search for (Magento's Search terms). One row per
 * normalized term; the visitor is never stored (the once-per-hour limit is a
 * cache key made from a hash of their IP).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('search_terms', function (Blueprint $table) {
            $table->id();
            $table->string('term', 100)->unique();
            $table->unsignedInteger('hits')->default(0);
            $table->unsignedInteger('last_results_count')->default(0);
            $table->string('redirect_url', 2048)->nullable();
            $table->timestamps();
            $table->index('hits');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('search_terms');
    }
};
