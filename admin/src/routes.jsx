import { Navigate, Route, Routes } from 'react-router'
import { LIVE_DATA } from './api/mode'
import { useAdminAuth } from './auth/useAdminAuth'
import { NoPermission, RequirePermission } from './components/NoPermission'
import AdminLayout from './layouts/AdminLayout'
import LoginPage from './pages/LoginPage'
import OverviewPage from './pages/OverviewPage'
import ProductsPage from './pages/ProductsPage'
import ProductFormPage from './pages/ProductFormPage'
import OrdersPage from './pages/OrdersPage'
import OrderDetailPage from './pages/OrderDetailPage'
import CustomersPage from './pages/CustomersPage'
import NotFoundPage from './pages/NotFoundPage'
import { CreditMemoDetailPage, CreditMemosPage, InvoiceDetailPage, InvoicesPage } from './pages/SalesDocumentsPages'
import CouponsPage from './pages/CouponsPage'
import CouponFormPage from './pages/CouponFormPage'
import AdminUsersPage from './pages/AdminUsersPage'
import RolesPage from './pages/RolesPage'
import AuditLogPage from './pages/AuditLogPage'
import { ContentPagesPage, PageEditorPage } from './pages/ContentPages'
import HomeEditorPage from './pages/HomeEditorPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import CategoriesPage from './pages/CategoriesPage'
import ImportExportPage from './pages/ImportExportPage'
import ReviewsPage from './pages/ReviewsPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import CustomerGroupsPage from './pages/CustomerGroupsPage'
import CreateOrderPage from './pages/CreateOrderPage'
import { ShipmentDetailPage, ShipmentsPage } from './pages/ShipmentsPages'
import { ReturnDetailPage, ReturnsPage } from './pages/ReturnsPages'
import { InvoicesPrintPage, PackingSlipsPrintPage } from './pages/PrintPages'
import { firstAllowedPath } from './utils/permissions'
// Phase 7 (system): email templates and URL redirects.
import { EmailTemplateEditorPage, EmailTemplatesPage } from './pages/EmailTemplatesPages'
import RedirectsPage from './pages/RedirectsPage'
// Phase 7 (marketing): price rules, newsletter, abandoned carts, search terms.
import { CatalogRuleFormPage, CatalogRulesPage } from './pages/CatalogRulesPages'
import { CampaignEditorPage, CampaignsPage, SubscribersPage } from './pages/NewsletterPages'
import AbandonedCartsPage from './pages/AbandonedCartsPage'
import SearchTermsPage from './pages/SearchTermsPage'
// Phase 9: two-step sign-in (BuyNest accounts) and backups.
import { REAL_ACCOUNTS } from './auth/accounts'
import TwoFactorPage from './pages/TwoFactorPage'
import BackupsPage from './pages/BackupsPage'
// Phase 10: shipping table rates and gift cards.
import ShippingRatesPage from './pages/ShippingRatesPage'
import { GiftCardDetailPage, GiftCardsPage } from './pages/GiftCardsPages'
// Phase 14: Settings → Delivery zones, Sales → To confirm.
import DeliveryZonesPage from './pages/DeliveryZonesPage'
import ToConfirmPage from './pages/ToConfirmPage'
// Phase 18: Settings → Couriers (Steadfast, Pathao).
import CouriersPage from './pages/CouriersPage'

/** The dashboard, or the first screen the role may open (e.g. Sales staff without dashboard.view). */
function Home() {
  const { can } = useAdminAuth()
  if (can('dashboard.view')) return <OverviewPage />
  const first = firstAllowedPath(can)
  return first && first !== '/' ? <Navigate to={first} replace /> : <NoPermission permission="dashboard.view" />
}

// Each screen with the permission it needs (docs/backend/PHASE4_CONTRACT.md). Hiding is for
// convenience: the API refuses the same things with 403 permission_denied.
const guarded = (permission, element) => <RequirePermission permission={permission}>{element}</RequirePermission>

/** Every admin route, relative to /admin. Shared by App.jsx and the tests. */
export function AdminRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route element={<AdminLayout />}>
        <Route index element={<Home />} />
        <Route path="products" element={guarded('products.view', <ProductsPage />)} />
        <Route path="products/new" element={guarded('products.edit', <ProductFormPage />)} />
        <Route path="products/:productId" element={guarded('products.view', <ProductFormPage />)} />
        <Route path="orders" element={guarded('orders.view', <OrdersPage />)} />
        <Route path="orders/:orderId" element={guarded('orders.view', <OrderDetailPage />)} />
        <Route path="customers" element={guarded('customers.view', <CustomersPage />)} />
        {/* Phase 9: Account → Two-step sign-in, for every admin (no permission). */}
        {REAL_ACCOUNTS && <Route path="account/two-factor" element={<TwoFactorPage />} />}
        {/* Sales documents, coupons, and everything of phases 4 and 5 exist only with BuyNest's backend. */}
        {LIVE_DATA && (
          <>
            {/* Phase 6: customers and sales. */}
            <Route path="orders/new" element={guarded('orders.create', <CreateOrderPage />)} />
            <Route path="customers/:customerId" element={guarded('customers.view', <CustomerDetailPage />)} />
            <Route path="customer-groups" element={guarded('customers.view', <CustomerGroupsPage />)} />
            <Route path="shipments" element={guarded('orders.view', <ShipmentsPage />)} />
            <Route path="shipments/:number" element={guarded('orders.view', <ShipmentDetailPage />)} />
            <Route path="returns" element={guarded('returns.view', <ReturnsPage />)} />
            <Route path="returns/:number" element={guarded('returns.view', <ReturnDetailPage />)} />
            <Route path="print/packing-slips" element={guarded('orders.view', <PackingSlipsPrintPage />)} />
            <Route path="print/invoices" element={guarded('orders.view', <InvoicesPrintPage />)} />
            <Route path="categories" element={guarded('products.view', <CategoriesPage />)} />
            <Route path="import-export" element={guarded('products.import', <ImportExportPage />)} />
            <Route path="reviews" element={guarded('reviews.view', <ReviewsPage />)} />
            <Route path="invoices" element={guarded('orders.view', <InvoicesPage />)} />
            <Route path="invoices/:number" element={guarded('orders.view', <InvoiceDetailPage />)} />
            <Route path="credit-memos" element={guarded('orders.view', <CreditMemosPage />)} />
            <Route path="credit-memos/:number" element={guarded('orders.view', <CreditMemoDetailPage />)} />
            <Route path="coupons" element={guarded('coupons.view', <CouponsPage />)} />
            <Route path="coupons/new" element={guarded('coupons.edit', <CouponFormPage />)} />
            <Route path="coupons/:couponId" element={guarded('coupons.view', <CouponFormPage />)} />
            <Route path="pages" element={guarded('content.view', <ContentPagesPage />)} />
            <Route path="pages/new" element={guarded('content.edit', <PageEditorPage />)} />
            <Route path="pages/:pageId" element={guarded('content.view', <PageEditorPage />)} />
            <Route path="home-page" element={guarded('content.view', <HomeEditorPage />)} />
            <Route path="reports" element={guarded('reports.view', <ReportsPage />)} />
            <Route path="settings" element={guarded('settings.view', <SettingsPage />)} />
            <Route path="admins" element={guarded('admins.manage', <AdminUsersPage />)} />
            <Route path="roles" element={guarded('admins.manage', <RolesPage />)} />
            <Route path="audit" element={guarded('audit.view', <AuditLogPage />)} />
            {/* Phase 7 (system): email templates and URL redirects. */}
            <Route path="email-templates" element={guarded('email_templates.manage', <EmailTemplatesPage />)} />
            <Route path="email-templates/:templateKey" element={guarded('email_templates.manage', <EmailTemplateEditorPage />)} />
            <Route path="redirects" element={guarded('seo.manage', <RedirectsPage />)} />
            {/* Phase 7 (marketing): price rules (read with coupons.view), newsletter, abandoned carts, search terms. */}
            <Route path="catalog-rules" element={guarded('coupons.view', <CatalogRulesPage />)} />
            <Route path="catalog-rules/new" element={guarded('price_rules.manage', <CatalogRuleFormPage />)} />
            <Route path="catalog-rules/:ruleId" element={guarded('coupons.view', <CatalogRuleFormPage />)} />
            <Route path="newsletter/subscribers" element={guarded('newsletter.view', <SubscribersPage />)} />
            <Route path="newsletter/campaigns" element={guarded('newsletter.view', <CampaignsPage />)} />
            <Route path="newsletter/campaigns/new" element={guarded('newsletter.send', <CampaignEditorPage />)} />
            <Route path="newsletter/campaigns/:campaignId" element={guarded('newsletter.view', <CampaignEditorPage />)} />
            <Route path="abandoned-carts" element={guarded('reports.view', <AbandonedCartsPage />)} />
            <Route path="search-terms" element={guarded('reports.view', <SearchTermsPage />)} />
            {/* Phase 9: System → Backups (Owner only by default). */}
            <Route path="backups" element={guarded('backups.view', <BackupsPage />)} />
            {/* The backup_failed notification links here. */}
            <Route path="system/backups" element={<Navigate to="/backups" replace />} />
            {/* Phase 10: Settings → Shipping → Table rates, Marketing → Gift cards. */}
            <Route path="settings/shipping-rates" element={guarded('settings.edit', <ShippingRatesPage />)} />
            <Route path="gift-cards" element={guarded('gift_cards.view', <GiftCardsPage />)} />
            <Route path="gift-cards/:giftCardId" element={guarded('gift_cards.view', <GiftCardDetailPage />)} />
            {/* Phase 14: Bangladesh delivery zones (changed with settings.edit), cash on delivery orders to confirm by phone. */}
            <Route path="settings/delivery-zones" element={guarded('settings.view', <DeliveryZonesPage />)} />
            <Route path="to-confirm" element={guarded('orders.edit', <ToConfirmPage />)} />
            {/* Phase 18: couriers and their booking defaults (changed with settings.edit). */}
            <Route path="settings/couriers" element={guarded('settings.view', <CouriersPage />)} />
          </>
        )}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
