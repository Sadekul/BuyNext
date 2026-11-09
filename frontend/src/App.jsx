import AppRoutes from './routes/AppRoutes'
import AuthProvider from './context/AuthProvider'
import CartProvider from './context/CartProvider'
import WishlistProvider from './context/WishlistProvider'
import OrdersProvider from './context/OrdersProvider'

/**
 * Root component: app-wide providers wrap the routes, so every page can
 * read shared state. WishlistProvider sits inside CartProvider because
 * "move to cart" uses the cart; AuthProvider is outermost so any provider
 * could use the signed-in customer (OrdersProvider shows only their orders).
 */
function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <OrdersProvider>
            <AppRoutes />
          </OrdersProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  )
}

export default App
