import { QueryClientProvider } from '@tanstack/react-query'
import AppRoutes from './routes/AppRoutes'
import AuthProvider from './context/AuthProvider'
import CartProvider from './context/CartProvider'
import WishlistProvider from './context/WishlistProvider'
import OrdersProvider from './context/OrdersProvider'
import CompareProvider from './context/CompareProvider'
import { useDisplayCurrency } from './utils/displayCurrency'
import { createQueryClient } from './lib/queryClient'
import LanguageSync from './components/layout/LanguageSync'
import { useTranslation } from 'react-i18next'

// Created once, outside the component, so re-renders never reset the cache.
const queryClient = createQueryClient()

/**
 * Root component: app-wide providers wrap the routes, so every page can
 * read shared state. WishlistProvider sits inside CartProvider because
 * "move to cart" uses the cart; AuthProvider wraps the stores so any of them
 * can use the signed-in customer (OrdersProvider shows only their orders).
 * QueryClientProvider (TanStack Query) is outermost: it holds the cache for
 * all server data, and AuthProvider clears cached profiles on sign-out.
 */
function App() {
  // Phase 11: a new display currency re-renders the whole app, so every price
  // (formatPrice, utils/formatters.js) shows in it at once.
  useDisplayCurrency()
  // Phase 13: a new language (or the Bangla digits setting) re-renders the whole app the same way.
  useTranslation()
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartProvider>
          <WishlistProvider>
            <OrdersProvider>
              <CompareProvider>
                <LanguageSync />
                <AppRoutes />
              </CompareProvider>
            </OrdersProvider>
          </WishlistProvider>
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
