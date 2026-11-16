<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 7 SEO: products get a meta title and description (categories and
 * pages already have them), and URL redirects (Magento's URL rewrites) send
 * old addresses to new ones.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('meta_title', 190)->nullable()->after('description');
            $table->string('meta_description', 500)->nullable()->after('meta_title');
        });

        Schema::create('url_redirects', function (Blueprint $table) {
            $table->id();
            $table->string('from_path', 255)->unique(); // lower-case, starts with "/", no query, no trailing slash
            $table->string('to_path', 2048);            // a store path or an https:// URL
            $table->unsignedSmallInteger('status_code')->default(301); // 301 | 302
            $table->unsignedInteger('hits')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('url_redirects');
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['meta_title', 'meta_description']);
        });
    }
};
