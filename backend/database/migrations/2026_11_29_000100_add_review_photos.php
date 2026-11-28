<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 22: product reviews with photos (docs/backend/PHASE22_CONTRACT.md).
 *
 * Up to 3 photos per review, cleaned (hidden data removed, at most 1600 px)
 * and stored on the private `local` disk at review-photos/{review_id}/{name}.
 * The public can only fetch a photo while its review is approved and the
 * photo isn't hidden by staff. The setting review_photos_enabled (Settings →
 * Catalog) is off by default, so nothing changes until the owner ticks it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('review_photos', function (Blueprint $table) {
            $table->id();
            $table->foreignId('review_id')->constrained()->cascadeOnDelete();
            $table->string('name', 40)->unique(); // {32 random hex}.{jpg|png|webp}, chosen by the server
            $table->string('path', 190);
            $table->unsignedSmallInteger('width');
            $table->unsignedSmallInteger('height');
            $table->unsignedInteger('size_bytes');
            $table->unsignedTinyInteger('position');
            $table->boolean('hidden')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('review_photos');
    }
};
