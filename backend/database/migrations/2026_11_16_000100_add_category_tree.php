<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 5: categories become a tree (Magento's Catalog → Categories), at most
 * 3 levels deep. Existing categories become top-level and active.
 * A category is "visible" in the store when it and all its ancestors are active.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            // restrict: a category with children can't be deleted (the API says so first, with a count).
            $table->foreignId('parent_id')->nullable()->after('id')->constrained('categories')->restrictOnDelete();
            $table->text('description')->nullable()->after('name');
            $table->boolean('is_active')->default(true)->after('description');
            $table->string('meta_title', 190)->nullable()->after('image_url');
            $table->string('meta_description', 500)->nullable()->after('meta_title');
        });
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_id');
            $table->dropColumn(['description', 'is_active', 'meta_title', 'meta_description']);
        });
    }
};
