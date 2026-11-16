<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 7: email templates (Magento's Marketing → Email templates).
 * The defaults live in code (App\Support\EmailTemplateCatalog); a row here is
 * a customization staff saved. "Reset to default" deletes the row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_templates', function (Blueprint $table) {
            $table->id();
            $table->string('key', 60)->unique();
            $table->string('subject', 200);
            $table->mediumText('body');
            $table->boolean('is_customized')->default(true);
            $table->foreignId('updated_by_admin_id')->nullable()->constrained('admins')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_templates');
    }
};
