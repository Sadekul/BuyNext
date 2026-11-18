<?php

use App\Services\SearchIndex;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 10 (part A): better search.
 *
 * - products.search_text: what the FULLTEXT index needs from other tables
 *   (brand name, category name, tags, SKU, variant SKUs), kept by the app
 *   (App\Services\SearchIndex), because a FULLTEXT index can only cover
 *   columns of one table.
 * - A FULLTEXT index on name, description and search_text (InnoDB, MySQL),
 *   used in natural-language mode for relevance.
 * - search_vocabulary: the distinct words shoppers can find (names, brands,
 *   categories, tags of products for sale) with how many products use them,
 *   for typo correction.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->text('search_text')->nullable()->after('tags');
        });
        Schema::table('products', function (Blueprint $table) {
            $table->fullText(['name', 'description', 'search_text'], 'products_search_fulltext');
        });

        Schema::create('search_vocabulary', function (Blueprint $table) {
            $table->string('word', 64)->primary();
            $table->unsignedInteger('count');
            $table->unsignedTinyInteger('length')->index(); // characters, so candidates can be picked by length
            $table->timestamp('updated_at')->nullable();
        });

        // Fill both for the products that already exist (plain queries, no model events).
        app(SearchIndex::class)->rebuild();
    }

    public function down(): void
    {
        Schema::dropIfExists('search_vocabulary');
        Schema::table('products', function (Blueprint $table) {
            $table->dropFullText('products_search_fulltext');
        });
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('search_text');
        });
    }
};
