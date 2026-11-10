<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * 6-digit codes emailed to customers (verify the email address, reset the
 * password). Only a keyed hash of the code is stored, so a database leak
 * doesn't reveal working codes. Each code expires, allows a few attempts,
 * and is used once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('one_time_codes', function (Blueprint $table) {
            $table->id();
            $table->string('email', 190);
            $table->string('purpose', 30); // verify_email | reset_password
            $table->string('code_hash', 64);
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
            $table->timestamps();
            $table->index(['email', 'purpose']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('one_time_codes');
    }
};
