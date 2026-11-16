<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Phase 6: customer groups (Magento's Customers → Customer groups), the
 * customer address book, and staff notes about a customer.
 *
 * Seeds General (system, 0%, the default for new sign-ups and the price
 * guests get), Wholesale (10%) and VIP (5%), and puts every existing customer
 * in General. customers.created_by_admin_id marks accounts staff created
 * (they start unverified and must not be pruned like abandoned sign-ups).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_groups', function (Blueprint $table) {
            $table->id();
            $table->string('name', 60)->unique();
            $table->string('code', 40)->unique();
            $table->decimal('discount_percent', 5, 2)->default(0);
            $table->boolean('is_system')->default(false);
            $table->timestamps();
        });

        $now = now();
        DB::table('customer_groups')->insertOrIgnore([
            ['name' => 'General', 'code' => 'general', 'discount_percent' => 0, 'is_system' => true, 'created_at' => $now, 'updated_at' => $now],
            ['name' => 'Wholesale', 'code' => 'wholesale', 'discount_percent' => 10, 'is_system' => false, 'created_at' => $now, 'updated_at' => $now],
            ['name' => 'VIP', 'code' => 'vip', 'discount_percent' => 5, 'is_system' => false, 'created_at' => $now, 'updated_at' => $now],
        ]);

        Schema::table('customers', function (Blueprint $table) {
            // restrict: a group with customers can't be deleted (the API says so first, with a count).
            $table->foreignId('group_id')->nullable()->after('phone')->constrained('customer_groups')->restrictOnDelete();
            $table->foreignId('created_by_admin_id')->nullable()->after('last_login_at')->constrained('admins')->nullOnDelete();
        });
        DB::table('customers')->whereNull('group_id')->update(['group_id' => DB::table('customer_groups')->where('code', 'general')->value('id')]);

        Schema::create('customer_addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->string('first_name', 60);
            $table->string('last_name', 60);
            $table->string('company', 100)->nullable();
            $table->string('phone', 20);
            // The same fields as orders.shipping_address.
            $table->string('line1', 120);
            $table->string('line2', 120)->nullable();
            $table->string('city', 80);
            $table->string('state', 80)->nullable();
            $table->string('postal_code', 10);
            $table->string('country', 60);
            $table->boolean('is_default_shipping')->default(false);
            $table->boolean('is_default_billing')->default(false);
            $table->timestamps();
        });

        Schema::create('customer_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained()->cascadeOnDelete();
            $table->foreignId('admin_id')->nullable()->constrained()->nullOnDelete();
            $table->text('body');
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_notes');
        Schema::dropIfExists('customer_addresses');
        Schema::table('customers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('created_by_admin_id');
            $table->dropConstrainedForeignId('group_id');
        });
        Schema::dropIfExists('customer_groups');
    }
};
