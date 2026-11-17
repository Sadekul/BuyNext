<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 9 (part A): two-step sign-in for admins (TOTP, RFC 6238).
 * - two_factor_secret: the authenticator key, encrypted with APP_KEY. Set
 *   while enrolling; two-step is on only once two_factor_confirmed_at is set.
 * - two_factor_recovery_codes: keyed hashes of the 10 one-time codes (JSON).
 * - two_factor_last_step: the 30-second step of the last accepted code, so a
 *   code can't be used twice (replay guard).
 * - admin_two_factor_challenges: the second sign-in step. Only a hash of
 *   the challenge is stored; 5 minutes, 5 wrong codes, used once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('admins', function (Blueprint $table) {
            $table->text('two_factor_secret')->nullable()->after('password');
            $table->timestamp('two_factor_confirmed_at')->nullable()->after('two_factor_secret');
            $table->text('two_factor_recovery_codes')->nullable()->after('two_factor_confirmed_at');
            $table->unsignedBigInteger('two_factor_last_step')->nullable()->after('two_factor_recovery_codes');
        });

        Schema::create('admin_two_factor_challenges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('admin_id')->constrained('admins')->cascadeOnDelete();
            $table->char('token_hash', 64)->unique();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_two_factor_challenges');
        Schema::table('admins', function (Blueprint $table) {
            $table->dropColumn(['two_factor_secret', 'two_factor_confirmed_at', 'two_factor_recovery_codes', 'two_factor_last_step']);
        });
    }
};
