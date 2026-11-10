import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import AdminAuthProvider from '../auth/AdminAuthProvider'
import AdminLayout from '../layouts/AdminLayout'
import LoginPage from '../pages/LoginPage'
import OverviewPage from '../pages/OverviewPage'
import ProductFormPage from '../pages/ProductFormPage'
import CustomersPage from '../pages/CustomersPage'
import ProductsPage from '../pages/ProductsPage'
import OrdersPage from '../pages/OrdersPage'
import OrderDetailPage from '../pages/OrderDetailPage'

/** The admin app's real providers and the routes the tests need, at `route`. */
export function renderApp(route = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
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
            </Route>
          </Routes>
        </AdminAuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
