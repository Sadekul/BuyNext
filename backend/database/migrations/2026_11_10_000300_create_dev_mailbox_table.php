<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * The local test inbox (/dev/mailbox): a copy of every email the app sends,
 * recorded only when APP_ENV=local and DEV_MAILBOX=true. Never used in production.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('dev_mailbox', function (Blueprint $table) {
            $table->id();
            $table->string('to', 190)->index();
            $table->string('subject');
            $table->longText('html')->nullable();
            $table->longText('text')->nullable();
            $table->timestamp('created_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dev_mailbox');
    }
};
