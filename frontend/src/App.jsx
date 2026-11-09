import AppRoutes from './routes/AppRoutes'
import CartProvider from './context/CartProvider'
import WishlistProvider from './context/WishlistProvider'

/**
 * Root component: app-wide providers wrap the routes, so every page can
 * read shared state. WishlistProvider sits inside CartProvider because
 * "move to cart" uses the cart. (Auth arrives in Phase 9.)
 */
function App() {
  return (
    <CartProvider>
      <WishlistProvider>
        <AppRoutes />
      </WishlistProvider>
    </CartProvider>
  )
}

export default App
