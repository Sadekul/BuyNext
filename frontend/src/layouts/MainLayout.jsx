import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router'
import AnnouncementBar from '../components/layout/AnnouncementBar'
import Header from '../components/layout/Header'
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
import { storeAnnouncements } from '../constants/site'
import { ROUTES } from '../constants/routes'
import { useNavLinks } from '../hooks/useNavLinks'
import { usePageMetaDefaults } from '../hooks/usePageMetaDefaults'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { formatBasePrice } from '../utils/formatters'

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
  // Phase 12: the free-shipping threshold in the store's currency (৳ in a taka store).
  const { settings } = useStoreSettings()
  const { t } = useTranslation('common')

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
      {/* Redesign: one closable message; not in the checkout, where nothing should pull the shopper away. */}
      {!pathname.startsWith(ROUTES.checkout) && <AnnouncementBar messages={storeAnnouncements(settings.freeShippingThreshold, formatBasePrice)} />}
      <Header navLinks={links} mobileNavLinks={mobileLinks} />
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
