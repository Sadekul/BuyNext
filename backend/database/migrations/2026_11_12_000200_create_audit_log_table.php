<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Who did what in the admin (Magento's Action Log). Rows are only ever
 * added, never changed. admin_id is null for failed sign-ins (nobody is
 * signed in) and stays when an admin is deactivated (admins are never deleted).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_log', function (Blueprint $table) {
            $table->id();
            $table->foreignId('admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->string('action', 60);            // e.g. "product.updated"
            $table->string('subject_type', 40)->nullable(); // e.g. "product"
            $table->unsignedBigInteger('subject_id')->nullable();
            $table->string('summary', 255);
            $table->json('changes')->nullable();      // { before: {...}, after: {...} }, changed fields only
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['action', 'created_at']);
            $table->index(['subject_type', 'subject_id']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_log');
    }
};
