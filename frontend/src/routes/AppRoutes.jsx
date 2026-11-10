import { lazy } from 'react'
import { Route, Routes } from 'react-router'
import MainLayout from '../layouts/MainLayout'
import ProtectedRoute from './ProtectedRoute'
import GuestOnlyRoute from './GuestOnlyRoute'
// Shopping pages most visitors see first stay in the main bundle…
import HomePage from '../pages/HomePage'
import ProductListingPage from '../pages/ProductListingPage'
import ProductDetailsPage from '../pages/ProductDetailsPage'
import { SHOW_LEARNING_LAB } from '../constants/site'

// …everything else is CODE-SPLIT: React.lazy downloads a page's JavaScript
// only when someone visits it (the checkout's form libraries, the account
// area, the learning lab with Axios). MainLayout's <Suspense> shows a loader
// meanwhile.
const CartPage = lazy(() => import('../pages/CartPage'))
const WishlistPage = lazy(() => import('../pages/WishlistPage'))
const LoginPage = lazy(() => import('../pages/LoginPage'))
const RegisterPage = lazy(() => import('../pages/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('../pages/ForgotPasswordPage'))
const VerifyEmailPage = lazy(() => import('../pages/VerifyEmailPage'))
const AccountLayout = lazy(() => import('../layouts/AccountLayout'))
const ProfilePage = lazy(() => import('../pages/ProfilePage'))
const OrdersPage = lazy(() => import('../pages/OrdersPage'))
const OrderDetailsPage = lazy(() => import('../pages/OrderDetailsPage'))
const CheckoutPage = lazy(() => import('../pages/CheckoutPage'))
const OrderConfirmationPage = lazy(() => import('../pages/OrderConfirmationPage'))
// The learning lab (and Axios) is left out of production builds entirely:
// with the condition written inline, Vite replaces it with `false` and the
// bundler drops the import. SHOW_LEARNING_LAB (constants/site.js) mirrors it.
const ComponentLabPage =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_LEARNING_LAB === 'true'
    ? lazy(() => import('../pages/ComponentLabPage'))
    : null
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'))

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
          <Route path="verify-email" element={<VerifyEmailPage />} />
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
        {SHOW_LEARNING_LAB && <Route path="learn" element={<ComponentLabPage />} />}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default AppRoutes
