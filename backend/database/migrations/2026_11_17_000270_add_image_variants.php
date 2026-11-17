<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 9 (part B): resized copies of uploaded product photos.
 * product_images.variants: { "320": url, "960": url } (only the copies that
 * were made; null = none). products.thumbnail_variants: the same for the
 * thumbnail (the first image), so product cards get a srcset without loading
 * every image.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_images', function (Blueprint $table) {
            $table->json('variants')->nullable()->after('path');
        });
        Schema::table('products', function (Blueprint $table) {
            $table->json('thumbnail_variants')->nullable()->after('thumbnail_url');
        });
    }

    public function down(): void
    {
        Schema::table('product_images', fn (Blueprint $table) => $table->dropColumn('variants'));
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn('thumbnail_variants'));
    }
};
