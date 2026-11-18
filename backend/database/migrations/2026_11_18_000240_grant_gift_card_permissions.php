<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/*
 * Phase 10 (part B) permission keys for the starter roles that already exist
 * (a fresh database gets them from Permissions::seededRoles()): Marketing
 * gets gift_cards.view and gift_cards.manage, Viewer gets gift_cards.view.
 * Owner always has every key. Roles staff renamed or made are left alone.
 */
return new class extends Migration
{
    private const GRANTS = [
        'Marketing' => ['gift_cards.view', 'gift_cards.manage'],
        'Viewer' => ['gift_cards.view'],
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
