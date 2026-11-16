<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Phase 5 permission keys for the starter roles that already exist
 * (a fresh database gets them from Permissions::seededRoles()):
 * Catalog manager gets import/export and reviews; Viewer gets reviews.view.
 * Owner needs nothing: it always has every key. Roles staff renamed or made
 * themselves are left alone.
 */
return new class extends Migration
{
    private const GRANTS = [
        'Catalog manager' => ['products.import', 'reviews.view', 'reviews.moderate'],
        'Viewer' => ['reviews.view'],
    ];

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
