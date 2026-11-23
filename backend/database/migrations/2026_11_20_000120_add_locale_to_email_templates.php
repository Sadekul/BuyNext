<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 13: each email template has an English and a Bangla version. A saved
 * customization is per language (unique key + locale); every row saved
 * before this phase is English (the column default back-fills it).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('email_templates', function (Blueprint $table) {
            $table->char('locale', 2)->default('en')->after('key');
        });
        Schema::table('email_templates', function (Blueprint $table) {
            $table->dropUnique(['key']);
            $table->unique(['key', 'locale']);
        });
    }

    public function down(): void
    {
        Schema::table('email_templates', function (Blueprint $table) {
            $table->dropUnique(['key', 'locale']);
        });
        DB::table('email_templates')->where('locale', '!=', 'en')->delete();
        Schema::table('email_templates', function (Blueprint $table) {
            $table->unique('key');
            $table->dropColumn('locale');
        });
    }
};
