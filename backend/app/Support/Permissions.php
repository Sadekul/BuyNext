<?php

namespace App\Support;

/**
 * Every admin permission key, grouped by area (Magento's "Role Resources").
 * The keys are what routes check (can.admin:<key>) and what roles store.
 * Add a key here first; the role form (GET /api/admin/v1/permissions) and the
 * Owner role pick it up automatically.
 */
final class Permissions
{
    public const GROUPS = [
        'dashboard' => ['label' => 'Dashboard', 'permissions' => [
            'dashboard.view' => 'View the dashboard',
        ]],
        'catalog' => ['label' => 'Catalog', 'permissions' => [
            'products.view' => 'View products',
            'products.edit' => 'Create and edit products',
            'products.delete' => 'Delete products',
            'categories.edit' => 'Edit categories',
        ]],
        'sales' => ['label' => 'Sales', 'permissions' => [
            'orders.view' => 'View orders, invoices, and refunds',
            'orders.edit' => 'Change order status, add notes, cancel',
            'invoices.create' => 'Create invoices (record payments)',
            'shipments.create' => 'Create shipments',
            'credit_memos.create' => 'Create credit memos (refunds)',
        ]],
        'customers' => ['label' => 'Customers', 'permissions' => [
            'customers.view' => 'View customers',
            'customers.edit' => 'Block and unblock customers',
        ]],
        'marketing' => ['label' => 'Marketing', 'permissions' => [
            'coupons.view' => 'View coupons',
            'coupons.edit' => 'Create, edit, and delete coupons',
        ]],
        'content' => ['label' => 'Content', 'permissions' => [
            'content.view' => 'View pages and home page content',
            'content.edit' => 'Edit pages and home page content',
        ]],
        'reports' => ['label' => 'Reports', 'permissions' => [
            'reports.view' => 'View and download reports',
        ]],
        'settings' => ['label' => 'Settings', 'permissions' => [
            'settings.view' => 'View store settings',
            'settings.edit' => 'Change store settings',
        ]],
        'system' => ['label' => 'System', 'permissions' => [
            'admins.manage' => 'Manage admin users and roles',
            'audit.view' => 'View the audit log',
        ]],
    ];

    /** Every key, in catalog order. */
    public static function all(): array
    {
        return array_merge(...array_map(fn (array $group) => array_keys($group['permissions']), array_values(self::GROUPS)));
    }

    public static function exists(string $key): bool
    {
        return in_array($key, self::all(), true);
    }

    /** The answer of GET /api/admin/v1/permissions: [{ group, label, permissions: [{ key, label }] }]. */
    public static function catalog(): array
    {
        return array_map(fn (string $group, array $info) => [
            'group' => $group,
            'label' => $info['label'],
            'permissions' => array_map(fn ($key, $label) => ['key' => $key, 'label' => $label],
                array_keys($info['permissions']), $info['permissions']),
        ], array_keys(self::GROUPS), self::GROUPS);
    }

    /**
     * The seeded roles. Only Owner is a system role: it can't be deleted or
     * edited, and always has every key (even ones added later).
     */
    public static function seededRoles(): array
    {
        $views = array_values(array_filter(self::all(), fn ($key) => str_ends_with($key, '.view')));

        return [
            ['name' => 'Owner', 'description' => 'Everything, including admin users and roles.', 'is_system' => true, 'permissions' => self::all()],
            ['name' => 'Sales staff', 'description' => 'Orders, invoices, shipments, refunds; can look up customers.', 'is_system' => false,
                'permissions' => ['orders.view', 'orders.edit', 'invoices.create', 'shipments.create', 'credit_memos.create', 'customers.view']],
            ['name' => 'Catalog manager', 'description' => 'Products and categories.', 'is_system' => false,
                'permissions' => ['products.view', 'products.edit', 'products.delete', 'categories.edit']],
            ['name' => 'Marketing', 'description' => 'Coupons and content.', 'is_system' => false,
                'permissions' => ['coupons.view', 'coupons.edit', 'content.view', 'content.edit']],
            ['name' => 'Viewer', 'description' => 'Can look at everything, change nothing.', 'is_system' => false, 'permissions' => $views],
        ];
    }
}
