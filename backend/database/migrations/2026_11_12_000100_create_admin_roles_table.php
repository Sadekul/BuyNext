<?php

use App\Support\Permissions;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * Admin roles (Magento's System → Permissions → User Roles). A role is a list
 * of permission keys; every admin route checks one (can.admin:<key>).
 * The seeded roles are data, so `php artisan migrate` gives an existing
 * database the same roles as a fresh one; every existing admin becomes Owner
 * (they could do everything before, so nobody loses access).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('admin_roles', function (Blueprint $table) {
            $table->id();
            $table->string('name', 60)->unique();
            $table->string('description', 255)->nullable();
            $table->json('permissions');
            $table->boolean('is_system')->default(false);
            $table->timestamps();
        });

        Schema::table('admins', function (Blueprint $table) {
            // restrict: a role that admins use can't be deleted (the API also says so, with a count).
            $table->foreignId('role_id')->nullable()->after('password')->constrained('admin_roles')->restrictOnDelete();
        });

        $now = now();
        foreach (Permissions::seededRoles() as $role) {
            DB::table('admin_roles')->insertOrIgnore([...$role, 'permissions' => json_encode($role['permissions']),
                'created_at' => $now, 'updated_at' => $now]);
        }
        DB::table('admins')->whereNull('role_id')->update(['role_id' => DB::table('admin_roles')->where('name', 'Owner')->value('id')]);
    }

    public function down(): void
    {
        Schema::table('admins', function (Blueprint $table) {
            $table->dropConstrainedForeignId('role_id');
        });
        Schema::dropIfExists('admin_roles');
    }
};
