import { Route, Routes } from 'react-router'
import MainLayout from '../layouts/MainLayout'
import HomePage from '../pages/HomePage'
import ProductListingPage from '../pages/ProductListingPage'
import ProductDetailsPage from '../pages/ProductDetailsPage'
import CartPage from '../pages/CartPage'
import WishlistPage from '../pages/WishlistPage'
import LoginPage from '../pages/LoginPage'
import RegisterPage from '../pages/RegisterPage'
import ForgotPasswordPage from '../pages/ForgotPasswordPage'
import ProfilePage from '../pages/ProfilePage'
import AccountLayout from '../layouts/AccountLayout'
import CheckoutPage from '../pages/CheckoutPage'
import OrderConfirmationPage from '../pages/OrderConfirmationPage'
import OrdersPage from '../pages/OrdersPage'
import OrderDetailsPage from '../pages/OrderDetailsPage'
import ProtectedRoute from './ProtectedRoute'
import GuestOnlyRoute from './GuestOnlyRoute'
import NotFoundPage from '../pages/NotFoundPage'
import ComponentLabPage from '../pages/ComponentLabPage'

/**
 * All application routes in one place. Routes nested inside the
 * MainLayout route share its header and footer.
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
        <Route path="cart" element={<CartPage />} />
        <Route path="wishlist" element={<WishlistPage />} />
        <Route element={<GuestOnlyRoute />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
        </Route>
        <Route path="forgot-password" element={<ForgotPasswordPage />} />

        {/* Signed-in customers only (UX guard; the API enforces real access). */}
        <Route element={<ProtectedRoute />}>
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="order-confirmation/:orderId" element={<OrderConfirmationPage />} />
          <Route path="account" element={<AccountLayout />}>
            <Route index element={<ProfilePage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrderDetailsPage />} />
          </Route>
        </Route>
        <Route path="learn" element={<ComponentLabPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default AppRoutes
