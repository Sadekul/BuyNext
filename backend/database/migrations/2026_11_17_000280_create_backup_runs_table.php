<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 9 (part B): one row per database backup attempt (php artisan
 * buynest:backup, the daily schedule, or "Back up now" in the admin), so
 * System → Backups can show the last result even when it failed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('backup_runs', function (Blueprint $table) {
            $table->id();
            $table->string('status', 10)->default('running'); // running | ok | failed
            $table->string('trigger', 10);                    // schedule | admin | cli
            $table->string('file_name', 100)->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();
            $table->string('error', 1000)->nullable();
            $table->foreignId('admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamp('started_at');
            $table->timestamp('finished_at')->nullable();
            $table->index('started_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('backup_runs');
    }
};
