<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 19: the welcome coupon. A new customer (verified sign-up) or a
 * confirmed newsletter subscriber gets a personal, one-time code by email.
 *
 * coupons.source tells staff codes from issued welcome codes (so the admin
 * list can keep them apart); issued_to_email limits a code to one address;
 * first_order_only is a general option (staff coupons may use it too).
 *
 * welcome_coupon_grants is the "one per email address, ever" guard: its
 * unique email is inserted before the coupon is made, and the row outlives
 * a deleted coupon or customer (both foreign keys become null).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('coupons', function (Blueprint $table) {
            $table->string('source', 20)->default('staff')->after('auto_apply')->index(); // staff | welcome
            $table->string('issued_to_email', 191)->nullable()->after('source')->index(); // lower case
            $table->boolean('first_order_only')->default(false)->after('issued_to_email');
        });

        Schema::create('welcome_coupon_grants', function (Blueprint $table) {
            $table->id();
            $table->string('email', 191)->unique(); // lower case
            $table->foreignId('coupon_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('trigger', 20); // signup | newsletter
            $table->timestamp('created_at')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('welcome_coupon_grants');
        Schema::table('coupons', function (Blueprint $table) {
            $table->dropIndex(['source']);
            $table->dropIndex(['issued_to_email']);
            $table->dropColumn(['source', 'issued_to_email', 'first_order_only']);
        });
    }
};
