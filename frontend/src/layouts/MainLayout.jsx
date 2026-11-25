import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router'
import Header from '../components/layout/Header'
import BottomTabBar from '../components/layout/BottomTabBar'
import Footer from '../components/layout/Footer'
import OfflineBanner from '../components/layout/OfflineBanner'
import ScrollToTop from '../components/common/ScrollToTop'
import ErrorBoundary from '../components/common/ErrorBoundary'
import CartDrawer from '../components/cart/CartDrawer'
import CookieConsent from '../components/layout/CookieConsent'
import CompareBar from '../components/layout/CompareBar'
import WishlistSyncNotice from '../components/layout/WishlistSyncNotice'
import LanguageHint from '../components/layout/LanguageHint'
import Loader from '../components/ui/Loader'
import { ROUTES } from '../constants/routes'
import { useNavLinks } from '../hooks/useNavLinks'
import { usePageMetaDefaults } from '../hooks/usePageMetaDefaults'

/**
 * Shared page shell. <Outlet /> is where React Router renders the matched
 * child route. Around it:
 * - ErrorBoundary: a crash in one page shows a fallback; header, footer, and
 *   cart keep working. key={pathname} resets it when you navigate away.
 * - Suspense: shows a loader while a lazy-loaded page's code downloads.
 */
function MainLayout() {
  const { pathname } = useLocation()
  const { links, mobileLinks } = useNavLinks()
  // Description, canonical link, and Open Graph tags on every page (utils/pageMeta.js).
  usePageMetaDefaults()
  const { t } = useTranslation('common')
  // Phase 17: the checkout keeps the shopper on task: no promo or delivery line in the top bar, no tab bar.
  const inCheckout = pathname.startsWith(ROUTES.checkout)
  // The menu drawer opens from the header's menu button and from the phone tab bar's "Categories".
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <>
      <ScrollToTop />
      <a href="#main-content" className="skip-link">
        {t('layout.skipToContent')}
      </a>
      {/* Phase 13: a browser that prefers Bangla gets one "বাংলায় দেখুন" offer. */}
      <LanguageHint />
      {/* Phase 10: asks before any statistics load (only when the store uses them); sends page views after. */}
      <CookieConsent />
      <OfflineBanner />
      {/* Phase 17: the header starts with the top bar (delivery line, promo and coupon, language, currency). */}
      <Header navLinks={links} mobileNavLinks={mobileLinks} menuOpen={isMenuOpen} onMenuOpenChange={setIsMenuOpen} compactTopBar={inCheckout} />
      <main id="main-content" tabIndex={-1}>
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      {/* Phase 11: "Compare (3) · Clear", while products are picked for comparison. */}
      <CompareBar />
      <Footer />
      {/* Phase 17: Home, Categories, Search, Wishlist, Cart on phones (never in the checkout). */}
      {!inCheckout && <BottomTabBar onOpenCategories={() => setIsMenuOpen(true)} />}
      <CartDrawer />
      {/* Phase 11: why a wishlist change didn't stick (the account's wishlist is on the server). */}
      <WishlistSyncNotice />
    </>
  )
}

function PageLoader() {
  const { t } = useTranslation('common')
  return (
    <div className="section container">
      <Loader label={t('layout.loadingPage')} />
    </div>
  )
}

export default MainLayout
