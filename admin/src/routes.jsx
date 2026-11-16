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
import { firstAllowedPath } from './utils/permissions'

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
        {/* Sales documents, coupons, and everything of phases 4 and 5 exist only with BuyNest's backend. */}
        {LIVE_DATA && (
          <>
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
          </>
        )}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
