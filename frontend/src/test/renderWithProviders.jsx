import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import AuthProvider from '../context/AuthProvider'
import CartProvider from '../context/CartProvider'
import WishlistProvider from '../context/WishlistProvider'
import OrdersProvider from '../context/OrdersProvider'

/**
 * Renders UI inside the same providers the app uses, with a fresh
 * QueryClient (no retries: failures show immediately) and an in-memory router.
 *
 *   renderWithProviders(<ProductDetailsPage />, { route: '/products/1', path: '/products/:productId' })
 */
export function renderWithProviders(ui, { route = '/', path, extraRoutes = null } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })

  const content = path ? (
    <Routes>
      <Route path={path} element={ui} />
      {extraRoutes}
    </Routes>
  ) : (
    ui
  )

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <CartProvider>
              <WishlistProvider>
                <OrdersProvider>{content}</OrdersProvider>
              </WishlistProvider>
            </CartProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}
