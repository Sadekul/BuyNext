<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 16 (configurable products like Magento's product page):
 * - product_options.type: "text" (buttons: Size, Storage) or "color" (round colour swatches).
 * - product_option_values.swatch: "#RRGGBB" for values of a color option (null for text, or a colour
 *   value saved before phase 16: the store shows a neutral swatch with the name).
 * - product_images.option_value_id: the image belongs to one choice ("Blue"); null = shown for every choice.
 *   Deleting the value sets it back to null.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_options', fn (Blueprint $table) => $table->string('type', 16)->default('text')->after('name'));
        Schema::table('product_option_values', fn (Blueprint $table) => $table->string('swatch', 7)->nullable()->after('value'));
        Schema::table('product_images', function (Blueprint $table) {
            $table->foreignId('option_value_id')->nullable()->after('product_id')->constrained('product_option_values')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('product_images', function (Blueprint $table) {
            $table->dropConstrainedForeignId('option_value_id');
        });
        Schema::table('product_option_values', fn (Blueprint $table) => $table->dropColumn('swatch'));
        Schema::table('product_options', fn (Blueprint $table) => $table->dropColumn('type'));
    }
};
