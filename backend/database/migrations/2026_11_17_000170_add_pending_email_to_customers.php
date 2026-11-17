<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 9 (part A): a customer changing their email. The new address waits
 * here until the code sent to it is entered; the account keeps the old email
 * until then.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('pending_email', 190)->nullable()->after('email');
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn('pending_email');
        });
    }
};
