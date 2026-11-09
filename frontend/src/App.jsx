import AppRoutes from './routes/AppRoutes'

/**
 * Root component. Kept intentionally thin: app-wide providers
 * (cart, wishlist, auth) will wrap <AppRoutes /> here in later phases.
 */
function App() {
  return <AppRoutes />
}

export default App
