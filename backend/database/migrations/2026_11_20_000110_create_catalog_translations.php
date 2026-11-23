<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 13: Bangla (and any later language) versions of shop content. The
 * base columns stay the English text; a translation row holds the other
 * language, and every empty field falls back to the base text.
 * - product_translations (FULLTEXT on name + description, so Bangla words are
 *   searched like English ones; Bangla separates words with spaces, so the
 *   default parser works),
 * - category_translations, page_translations,
 * - product_options.translations / product_option_values.translations:
 *   { "bn": { "name": "সাইজ" } } / { "bn": { "value": "নীল" } } (json, small),
 * - specification rows (products.specifications json) get label_bn/value_bn
 *   keys, so no column is needed for them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_translations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->string('locale', 5);
            $table->string('name')->nullable();
            $table->text('short_description')->nullable();
            $table->longText('description')->nullable();
            $table->string('meta_title')->nullable();
            $table->string('meta_description', 500)->nullable();
            $table->timestamps();
            $table->unique(['product_id', 'locale']);
            $table->index('locale');
        });
        if (DB::getDriverName() === 'mysql') {
            Schema::table('product_translations', fn (Blueprint $table) => $table->fullText(['name', 'description'], 'product_translations_search_fulltext'));
        }
        Schema::create('category_translations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->constrained()->cascadeOnDelete();
            $table->string('locale', 5);
            $table->string('name')->nullable();
            $table->text('description')->nullable();
            $table->string('meta_title')->nullable();
            $table->string('meta_description', 500)->nullable();
            $table->timestamps();
            $table->unique(['category_id', 'locale']);
        });
        Schema::create('page_translations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('page_id')->constrained()->cascadeOnDelete();
            $table->string('locale', 5);
            $table->string('title')->nullable();
            $table->longText('body')->nullable();
            $table->string('meta_title')->nullable();
            $table->string('meta_description', 500)->nullable();
            $table->timestamps();
            $table->unique(['page_id', 'locale']);
        });
        Schema::table('product_options', fn (Blueprint $table) => $table->json('translations')->nullable());
        Schema::table('product_option_values', fn (Blueprint $table) => $table->json('translations')->nullable());
    }

    public function down(): void
    {
        Schema::table('product_option_values', fn (Blueprint $table) => $table->dropColumn('translations'));
        Schema::table('product_options', fn (Blueprint $table) => $table->dropColumn('translations'));
        Schema::dropIfExists('page_translations');
        Schema::dropIfExists('category_translations');
        Schema::dropIfExists('product_translations');
    }
};
