import { useEffect } from 'react'
import { useLocation } from 'react-router'

/**
 * Scrolls to the top whenever the path changes. Client-side navigation
 * doesn't reload the page, so the browser won't do this for us.
 * Renders nothing — it exists only for its side effect.
 */
function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

export default ScrollToTop
