import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router'
import AdminAuthProvider from './auth/AdminAuthProvider'
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
import { LIVE_DATA } from './api/mode'

const queryClient = new QueryClient({
  defaultOptions: {
    // Admin data changes underneath you; a short freshness window, and no retry on 4xx.
    queries: { staleTime: 30_000, retry: (count, error) => count < 2 && !(error?.status >= 400 && error?.status < 500) },
    mutations: { retry: false },
  },
})

/** Routes are relative to /admin (BrowserRouter basename in main.jsx). */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminAuthProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route element={<AdminLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/new" element={<ProductFormPage />} />
            <Route path="products/:productId" element={<ProductFormPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrderDetailPage />} />
            <Route path="customers" element={<CustomersPage />} />
            {/* Sales documents and coupons exist only with BuyNest's backend. */}
            {LIVE_DATA && (
              <>
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="invoices/:number" element={<InvoiceDetailPage />} />
                <Route path="credit-memos" element={<CreditMemosPage />} />
                <Route path="credit-memos/:number" element={<CreditMemoDetailPage />} />
                <Route path="coupons" element={<CouponsPage />} />
                <Route path="coupons/new" element={<CouponFormPage />} />
                <Route path="coupons/:couponId" element={<CouponFormPage />} />
              </>
            )}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AdminAuthProvider>
    </QueryClientProvider>
  )
}

export default App
