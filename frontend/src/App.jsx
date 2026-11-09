import AppRoutes from './routes/AppRoutes'
import CartProvider from './context/CartProvider'

/**
 * Root component: app-wide providers wrap the routes, so every page can
 * read shared state (cart now; wishlist and auth in later phases).
 */
function App() {
  return (
    <CartProvider>
      <AppRoutes />
    </CartProvider>
  )
}

export default App
