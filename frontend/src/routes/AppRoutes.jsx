import { Route, Routes } from 'react-router'
import MainLayout from '../layouts/MainLayout'
import HomePage from '../pages/HomePage'
import ComingSoonPage from '../pages/ComingSoonPage'
import ProductListingPage from '../pages/ProductListingPage'
import ProductDetailsPage from '../pages/ProductDetailsPage'
import NotFoundPage from '../pages/NotFoundPage'
import ComponentLabPage from '../pages/ComponentLabPage'

/**
 * All application routes in one place. Routes nested inside the
 * MainLayout route share its header and footer.
 * ComingSoonPage entries are replaced as each phase is built.
 */
function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<HomePage />} />
        <Route path="products" element={<ProductListingPage />} />
        <Route path="products/:productId" element={<ProductDetailsPage />} />
        <Route path="categories/:categorySlug" element={<ProductListingPage />} />
        <Route path="deals" element={<ProductListingPage title="Deals" defaultSort="discount-desc" />} />
        <Route path="cart" element={<ComingSoonPage title="Shopping cart" phase={6} />} />
        <Route path="wishlist" element={<ComingSoonPage title="Wishlist" phase={7} />} />
        <Route path="account" element={<ComingSoonPage title="My account" phase={9} />} />
        <Route path="learn" element={<ComponentLabPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default AppRoutes
