<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Phase 7 (part A): the existing "Marketing" starter role gets
 * price_rules.manage (a fresh database gets it from Permissions::seededRoles()).
 * Owner always has every key; renamed or custom roles are left alone.
 */
return new class extends Migration
{
    private const GRANTS = ['Marketing' => ['price_rules.manage']];

    public function up(): void
    {
        foreach (self::GRANTS as $name => $keys) {
            $this->change($name, fn (array $permissions) => array_values(array_unique([...$permissions, ...$keys])));
        }
    }

    public function down(): void
    {
        foreach (self::GRANTS as $name => $keys) {
            $this->change($name, fn (array $permissions) => array_values(array_diff($permissions, $keys)));
        }
    }

    private function change(string $name, callable $change): void
    {
        $role = DB::table('admin_roles')->where('name', $name)->where('is_system', false)->first();
        if ($role) {
            $permissions = json_decode($role->permissions, true) ?: [];
            DB::table('admin_roles')->where('id', $role->id)->update(['permissions' => json_encode($change($permissions)), 'updated_at' => now()]);
        }
    }
};
