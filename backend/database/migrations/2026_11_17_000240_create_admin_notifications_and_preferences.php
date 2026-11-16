<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 7: the admin's notification bell (Magento's System → Notifications)
 * and per-admin grid preferences (visible columns, page size, saved filters).
 * A notification names the permission needed to see it; reads are per admin.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('admin_notifications', function (Blueprint $table) {
            $table->id();
            $table->string('type', 40);
            $table->string('severity', 10)->default('info'); // info | warning | critical
            $table->string('title', 190);
            $table->string('body', 1000)->default('');
            $table->string('link', 255)->nullable();
            $table->string('permission', 60);
            $table->string('subject_key', 100)->nullable(); // "product:12": no duplicates while unread
            $table->timestamp('created_at')->useCurrent();
            $table->index(['type', 'subject_key']);
        });

        Schema::create('admin_notification_reads', function (Blueprint $table) {
            $table->foreignId('admin_id')->constrained('admins')->cascadeOnDelete();
            $table->foreignId('notification_id')->constrained('admin_notifications')->cascadeOnDelete();
            $table->timestamp('read_at')->useCurrent();
            $table->primary(['admin_id', 'notification_id']);
            $table->index('notification_id');
        });

        Schema::create('admin_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('admin_id')->constrained('admins')->cascadeOnDelete();
            $table->string('key', 60);
            $table->json('value');
            $table->timestamps();
            $table->unique(['admin_id', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_preferences');
        Schema::dropIfExists('admin_notification_reads');
        Schema::dropIfExists('admin_notifications');
    }
};
