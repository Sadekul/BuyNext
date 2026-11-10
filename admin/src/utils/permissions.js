import {
  LuBoxes,
  LuChartColumn,
  LuFileText,
  LuHouse,
  LuLayoutDashboard,
  LuNewspaper,
  LuReceipt,
  LuScrollText,
  LuSettings,
  LuShieldCheck,
  LuTicketPercent,
  LuUndo2,
  LuUserCog,
  LuUsers,
} from 'react-icons/lu'
import { LIVE_DATA } from '../api/mode'

/*
 * Admin permissions (docs/backend/PHASE4_CONTRACT.md §1). The server checks
 * them on every request; this app only uses them to hide what the role can't
 * do, and to name a missing permission in plain words.
 */
export const PERMISSION_LABELS = {
  'dashboard.view': 'View the dashboard',
  'products.view': 'View products',
  'products.edit': 'Add and edit products',
  'products.delete': 'Delete products',
  'categories.edit': 'Edit categories',
  'orders.view': 'View orders',
  'orders.edit': 'Change orders (status, notes, cancel)',
  'invoices.create': 'Create invoices',
  'shipments.create': 'Create shipments',
  'credit_memos.create': 'Create refunds (credit memos)',
  'customers.view': 'View customers',
  'customers.edit': 'Block and unblock customers',
  'coupons.view': 'View coupons',
  'coupons.edit': 'Create and edit coupons',
  'content.view': 'View content pages and the home page',
  'content.edit': 'Edit content pages and the home page',
  'reports.view': 'View reports',
  'settings.view': 'View store settings',
  'settings.edit': 'Change store settings',
  'admins.manage': 'Manage admin users and roles',
  'audit.view': 'View the audit log',
}
export const permissionLabel = (key) => PERMISSION_LABELS[key] ?? key

/*
 * The sidebar, grouped like Magento's admin. `permission` hides an entry the
 * role can't open. Demo data (DummyJSON) has only the first four screens.
 */
const DEMO_NAV = [
  { to: '/', label: 'Overview', icon: LuLayoutDashboard, end: true, permission: 'dashboard.view' },
  { to: '/products', label: 'Products', icon: LuBoxes, permission: 'products.view' },
  { to: '/orders', label: 'Orders', icon: LuReceipt, permission: 'orders.view' },
  { to: '/customers', label: 'Customers', icon: LuUsers, permission: 'customers.view' },
]
const LIVE_NAV = [
  { to: '/', label: 'Overview', icon: LuLayoutDashboard, end: true, permission: 'dashboard.view' },
  { to: '/products', label: 'Products', icon: LuBoxes, permission: 'products.view' },
  {
    heading: 'Sales',
    items: [
      { to: '/orders', label: 'Orders', icon: LuReceipt, permission: 'orders.view' },
      { to: '/invoices', label: 'Invoices', icon: LuFileText, permission: 'orders.view' },
      { to: '/credit-memos', label: 'Credit memos', icon: LuUndo2, permission: 'orders.view' },
    ],
  },
  { to: '/customers', label: 'Customers', icon: LuUsers, permission: 'customers.view' },
  { heading: 'Marketing', items: [{ to: '/coupons', label: 'Coupons', icon: LuTicketPercent, permission: 'coupons.view' }] },
  {
    heading: 'Content',
    items: [
      { to: '/pages', label: 'Pages', icon: LuNewspaper, permission: 'content.view' },
      { to: '/home-page', label: 'Home page', icon: LuHouse, permission: 'content.view' },
    ],
  },
  { to: '/reports', label: 'Reports', icon: LuChartColumn, permission: 'reports.view' },
  { to: '/settings', label: 'Settings', icon: LuSettings, permission: 'settings.view' },
  {
    heading: 'System',
    items: [
      { to: '/admins', label: 'Admin users', icon: LuUserCog, permission: 'admins.manage' },
      { to: '/roles', label: 'Roles', icon: LuShieldCheck, permission: 'admins.manage' },
      { to: '/audit', label: 'Audit log', icon: LuScrollText, permission: 'audit.view' },
    ],
  },
]
export const NAV = LIVE_DATA ? LIVE_NAV : DEMO_NAV

/** The sidebar with only what `can` allows (empty groups left out). */
export const allowedNav = (can) =>
  NAV.map((entry) => (entry.heading ? { ...entry, items: entry.items.filter((item) => can(item.permission)) } : entry)).filter((entry) =>
    entry.heading ? entry.items.length > 0 : can(entry.permission),
  )

/** The first screen the role may open (for admins without the dashboard). */
export const firstAllowedPath = (can) => {
  for (const entry of allowedNav(can)) return entry.heading ? entry.items[0].to : entry.to
  return null
}
