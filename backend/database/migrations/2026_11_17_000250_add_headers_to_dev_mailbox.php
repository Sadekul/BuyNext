<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/* Phase 7: the local test inbox also keeps a few headers (List-Unsubscribe), so newsletters can be checked by hand. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('dev_mailbox', function (Blueprint $table) {
            $table->json('headers')->nullable()->after('text');
        });
    }

    public function down(): void
    {
        Schema::table('dev_mailbox', function (Blueprint $table) {
            $table->dropColumn('headers');
        });
    }
};
