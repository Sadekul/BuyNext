import { Outlet } from 'react-router'
import AnnouncementBar from '../components/layout/AnnouncementBar'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import ScrollToTop from '../components/common/ScrollToTop'
import { ANNOUNCEMENTS, MAIN_NAV_LINKS } from '../constants/site'

/**
 * Shared page shell. <Outlet /> is where React Router renders the
 * matched child route (HomePage, NotFoundPage, ...).
 */
function MainLayout() {
  return (
    <>
      <ScrollToTop />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <AnnouncementBar messages={ANNOUNCEMENTS} />
      <Header navLinks={MAIN_NAV_LINKS} />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  )
}

export default MainLayout
