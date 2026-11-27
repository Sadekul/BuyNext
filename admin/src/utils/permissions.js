import {
  LuArrowDownUp,
  LuBoxes,
  LuChartColumn,
  LuPackageOpen,
  LuTruck,
  LuUsersRound,
  LuFolderTree,
  LuMessageSquareText,
  // Phase 20.
  LuMessageSquareMore,
  LuSmartphone,
  LuFileText,
  LuHouse,
  LuLayoutDashboard,
  // Phase 7 (marketing).
  LuMailPlus,
  LuMails,
  LuPercent,
  LuShoppingCart,
  LuTextSearch,
  LuMail,
  LuNewspaper,
  LuReceipt,
  LuScrollText,
  LuSettings,
  LuShieldCheck,
  LuSignpost,
  LuTicketPercent,
  LuUndo2,
  LuUserCog,
  LuUsers,
  // Phase 9.
  LuDatabaseBackup,
  // Phase 10.
  LuGift,
  LuTable2,
  // Phase 14.
  LuMapPinned,
  LuPhoneCall,
  // Phase 18.
  LuPackageSearch,
  // Phase 19.
  LuBadgePercent,
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
  'products.import': 'Import and export products (CSV)',
  'reviews.view': 'View product reviews',
  'reviews.moderate': 'Approve, reject, and delete reviews',
  'orders.view': 'View orders',
  'orders.edit': 'Change orders (status, notes, cancel)',
  'invoices.create': 'Create invoices',
  'shipments.create': 'Create shipments',
  'credit_memos.create': 'Create refunds (credit memos)',
  'orders.create': 'Create orders for customers',
  'returns.view': 'View returns',
  'returns.manage': 'Handle returns (approve, reject, receive, close)',
  'customers.view': 'View customers',
  'customers.edit': 'Edit customers, their addresses, and notes; block and unblock',
  'customers.create': 'Add customers',
  'customers.delete': 'Delete customers',
  'customer_groups.manage': 'Manage customer groups',
  'coupons.view': 'View coupons',
  'coupons.edit': 'Create and edit coupons',
  'content.view': 'View content pages and the home page',
  'content.edit': 'Edit content pages and the home page',
  'reports.view': 'View reports',
  'settings.view': 'View store settings',
  'settings.edit': 'Change store settings',
  'admins.manage': 'Manage admin users and roles',
  'audit.view': 'View the audit log',
  // Phase 7 (system).
  'email_templates.manage': 'Edit email templates',
  'seo.manage': 'Manage URL redirects and search-term redirects',
  // Phase 7 (marketing).
  'price_rules.manage': 'Create, edit, and delete catalog price rules',
  'newsletter.view': 'View newsletter subscribers and campaigns',
  'newsletter.send': 'Write and send newsletters, unsubscribe people, and send cart reminders',
  // Phase 9.
  'backups.view': 'View and download database backups, and start one',
  // Phase 10.
  'gift_cards.view': 'View gift cards and their history',
  'gift_cards.manage': 'Create gift cards, adjust their balance, and disable them',
  // Phase 11.
  'rewards.manage': "Adjust customers' reward point balances",
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
  {
    heading: 'Catalog',
    items: [
      { to: '/products', label: 'Products', icon: LuBoxes, permission: 'products.view' },
      { to: '/categories', label: 'Categories', icon: LuFolderTree, permission: 'products.view' },
      { to: '/import-export', label: 'Import / Export', icon: LuArrowDownUp, permission: 'products.import' },
      { to: '/reviews', label: 'Reviews', icon: LuMessageSquareText, permission: 'reviews.view' },
    ],
  },
  {
    heading: 'Sales',
    items: [
      { to: '/orders', label: 'Orders', icon: LuReceipt, permission: 'orders.view' },
      // Phase 14 §4: cash on delivery orders waiting for a phone call.
      { to: '/to-confirm', label: 'To confirm', icon: LuPhoneCall, permission: 'orders.edit' },
      { to: '/shipments', label: 'Shipments', icon: LuTruck, permission: 'orders.view' },
      { to: '/returns', label: 'Returns', icon: LuPackageOpen, permission: 'returns.view' },
      { to: '/invoices', label: 'Invoices', icon: LuFileText, permission: 'orders.view' },
      { to: '/credit-memos', label: 'Credit memos', icon: LuUndo2, permission: 'orders.view' },
      // Phase 20 §2: every order text sent (or tried).
      { to: '/sms', label: 'SMS log', icon: LuMessageSquareMore, permission: 'orders.view' },
    ],
  },
  {
    heading: 'Customers',
    items: [
      { to: '/customers', label: 'All customers', icon: LuUsers, permission: 'customers.view' },
      { to: '/customer-groups', label: 'Customer groups', icon: LuUsersRound, permission: 'customers.view' },
    ],
  },
  {
    heading: 'Marketing',
    items: [
      // Phase 7 (marketing): price rules, newsletter, abandoned carts, search terms.
      { to: '/catalog-rules', label: 'Catalog price rules', icon: LuPercent, permission: 'coupons.view' },
      { to: '/coupons', label: 'Coupons', icon: LuTicketPercent, permission: 'coupons.view' },
      // Phase 19 §2: the welcome coupon (the coupon permissions).
      { to: '/welcome-coupon', label: 'Welcome coupon', icon: LuBadgePercent, permission: 'coupons.view' },
      // Phase 10 §5.
      { to: '/gift-cards', label: 'Gift cards', icon: LuGift, permission: 'gift_cards.view' },
      { to: '/newsletter/subscribers', label: 'Newsletter subscribers', icon: LuMailPlus, permission: 'newsletter.view' },
      { to: '/newsletter/campaigns', label: 'Newsletter campaigns', icon: LuMails, permission: 'newsletter.view' },
      { to: '/abandoned-carts', label: 'Abandoned carts', icon: LuShoppingCart, permission: 'reports.view' },
      { to: '/search-terms', label: 'Search terms', icon: LuTextSearch, permission: 'reports.view' },
    ],
  },
  {
    heading: 'Content',
    items: [
      { to: '/pages', label: 'Pages', icon: LuNewspaper, permission: 'content.view' },
      { to: '/home-page', label: 'Home page', icon: LuHouse, permission: 'content.view' },
      // Phase 7 (system).
      { to: '/email-templates', label: 'Email templates', icon: LuMail, permission: 'email_templates.manage' },
      { to: '/redirects', label: 'URL redirects', icon: LuSignpost, permission: 'seo.manage' },
    ],
  },
  { to: '/reports', label: 'Reports', icon: LuChartColumn, permission: 'reports.view' },
  // `end`: Settings → Shipping → Table rates (phase 10) has its own entry.
  { to: '/settings', label: 'Settings', icon: LuSettings, end: true, permission: 'settings.view' },
  { to: '/settings/shipping-rates', label: 'Shipping table rates', icon: LuTable2, permission: 'settings.edit' },
  // Phase 14 §3.
  { to: '/settings/delivery-zones', label: 'Delivery zones', icon: LuMapPinned, permission: 'settings.edit' },
  // Phase 18 §2: Steadfast and Pathao (read with settings.view).
  { to: '/settings/couriers', label: 'Couriers', icon: LuPackageSearch, permission: 'settings.view' },
  // Phase 20 §2: SMS notifications for orders (read with settings.view).
  { to: '/settings/sms', label: 'SMS', icon: LuSmartphone, permission: 'settings.view' },
  {
    heading: 'System',
    items: [
      { to: '/admins', label: 'Admin users', icon: LuUserCog, permission: 'admins.manage' },
      { to: '/roles', label: 'Roles', icon: LuShieldCheck, permission: 'admins.manage' },
      { to: '/audit', label: 'Audit log', icon: LuScrollText, permission: 'audit.view' },
      // Phase 9.
      { to: '/backups', label: 'Backups', icon: LuDatabaseBackup, permission: 'backups.view' },
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

/** An action's error in words; a 403 permission_denied names the permission the role lacks. */
export const actionErrorMessage = (error) =>
  error?.code === 'permission_denied' && error.permission ? `Your role doesn't allow this: ${permissionLabel(error.permission)} (${error.permission}).` : (error?.message ?? 'Something went wrong.')
