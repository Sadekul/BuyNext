<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 7: the newsletter (Magento's Marketing → Newsletter).
 * Subscribers confirm by email (double opt-in): only the SHA-256 hash of the
 * confirmation token is stored, like one-time codes. Campaigns keep their
 * sanitized HTML body and how many emails went out.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('newsletter_subscribers', function (Blueprint $table) {
            $table->id();
            $table->string('email', 190)->unique();
            $table->foreignId('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->string('status', 20)->default('pending')->index(); // pending | subscribed | unsubscribed
            $table->string('confirm_token_hash', 64)->nullable()->unique();
            $table->timestamp('confirm_sent_at')->nullable(); // the token expires 7 days after this
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamp('unsubscribed_at')->nullable();
            $table->string('source', 20)->default('footer'); // footer | account | checkout | admin
            $table->timestamps();
        });

        Schema::create('newsletter_campaigns', function (Blueprint $table) {
            $table->id();
            $table->string('subject', 150);
            $table->string('preheader', 150)->nullable();
            $table->mediumText('body');
            $table->string('status', 20)->default('draft')->index(); // draft | sending | sent
            $table->unsignedInteger('recipient_count')->default(0);
            $table->unsignedInteger('sent_count')->default(0);
            $table->unsignedInteger('failed_count')->default(0);
            $table->unsignedInteger('batches_total')->default(0);
            $table->unsignedInteger('batches_done')->default(0);
            $table->foreignId('created_by_admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('newsletter_campaigns');
        Schema::dropIfExists('newsletter_subscribers');
    }
};
