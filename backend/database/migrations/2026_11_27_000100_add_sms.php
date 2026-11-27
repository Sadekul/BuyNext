<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 20: SMS order notifications (docs/backend/PHASE20_CONTRACT.md).
 *
 * sms_messages is the outbox and the log in one: a row is written (queued)
 * before the provider is called, then marked sent or failed, so a failed
 * text can be retried and staff can see what each customer was told.
 * dedupe_key ("{order}:{event}", "{order}:order_shipped:{shipment}") makes
 * each order text go out once even if two requests race; test sends have none.
 *
 * orders.sms_confirm_token_hash: the SHA-256 of the one-tap confirmation
 * link's token (the token itself is only in the text), with its expiry.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sms_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->nullable()->constrained()->nullOnDelete();
            $table->string('event', 40)->nullable(); // null: a test send
            $table->string('dedupe_key', 80)->nullable()->unique();
            $table->string('to', 20); // +8801XXXXXXXXX
            $table->text('body');
            $table->string('locale', 2);
            $table->unsignedTinyInteger('segments');
            $table->string('encoding', 10); // gsm | unicode
            $table->string('provider', 20);
            $table->string('status', 10); // queued | sent | failed
            $table->string('provider_message_id', 100)->nullable();
            $table->string('error', 300)->nullable();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('sent_at')->nullable();
            $table->foreignId('admin_id')->nullable()->constrained('admins')->nullOnDelete(); // test sends
            $table->timestamps();
            $table->index(['status', 'created_at']);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->string('sms_confirm_token_hash', 64)->nullable()->after('confirmed_at')->index();
            $table->timestamp('sms_confirm_expires_at')->nullable()->after('sms_confirm_token_hash');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['sms_confirm_token_hash']);
            $table->dropColumn(['sms_confirm_token_hash', 'sms_confirm_expires_at']);
        });
        Schema::dropIfExists('sms_messages');
    }
};
