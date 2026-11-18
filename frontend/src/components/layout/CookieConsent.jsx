import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import Button from '../ui/Button'
import { ROUTES } from '../../constants/routes'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import { COOKIE_SETTINGS_EVENT, analyticsAvailable, readConsent, saveConsent, startAnalytics, stopAnalytics, trackPageView } from '../../utils/analytics'
import './CookieConsent.css'

/**
 * The cookie consent banner (phase 10, §6), and the page views it allows.
 *
 * Shown only when this build may load Google Analytics (VITE_ANALYTICS=ga4)
 * AND the store set a measurement id. It asks once; the choice is kept for
 * 6 months. Accept all → Google Analytics starts (utils/analytics.js);
 * Reject → nothing loads, ever, until the visitor changes their mind in
 * "Cookie settings" (footer). Settings shows the one optional category,
 * Statistics, off until switched on.
 *
 * Accessibility: a labelled region (not a dialog): the page stays usable
 * and nothing traps the focus. It comes early in the page, so keyboard users
 * reach it right after the "Skip to main content" link. The three buttons look
 * the same, so neither answer is pushed. Opened from the footer, focus moves
 * to its heading.
 */
function CookieConsent() {
  const { settings } = useStoreSettings()
  const available = analyticsAvailable(settings)
  const measurementId = settings.ga4MeasurementId
  const [consent, setConsent] = useState(() => readConsent())
  const [isOpen, setIsOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [statistics, setStatistics] = useState(false)
  const headingRef = useRef(null)
  const focusOnOpen = useRef(false)
  const focusSettings = useRef(false)
  const checkboxRef = useRef(null)
  const titleId = useId()
  const statisticsId = useId()
  const { pathname } = useLocation()

  // Statistics start only with consent given (now, or on an earlier visit).
  useEffect(() => {
    if (available && consent === 'granted') startAnalytics(measurementId)
  }, [available, consent, measurementId])

  // One page view per route change (sent only while statistics are on).
  useEffect(() => {
    if (!available || consent !== 'granted') return
    // After the page has rendered, so its <title> is the new page's.
    const timer = setTimeout(() => trackPageView(pathname), 0)
    return () => clearTimeout(timer)
  }, [available, consent, pathname])

  // "Cookie settings" in the footer.
  useEffect(() => {
    const open = () => {
      setStatistics(readConsent() === 'granted')
      setShowSettings(true)
      setIsOpen(true)
      focusOnOpen.current = true
    }
    window.addEventListener(COOKIE_SETTINGS_EVENT, open)
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, open)
  }, [])
  useEffect(() => {
    if (isOpen && focusOnOpen.current) {
      focusOnOpen.current = false
      headingRef.current?.focus()
    }
  }, [isOpen])

  // "Settings" is replaced by "Save choices": the focus moves on to the Statistics switch.
  useEffect(() => {
    if (showSettings && focusSettings.current) {
      focusSettings.current = false
      checkboxRef.current?.focus()
    }
  }, [showSettings])

  if (!available || (!isOpen && consent !== null)) return null

  function choose(granted) {
    saveConsent(granted)
    setConsent(granted ? 'granted' : 'denied')
    if (!granted) stopAnalytics()
    setIsOpen(false)
    setShowSettings(false)
  }

  return (
    <section className="cookie-consent" aria-labelledby={titleId}>
      <div className="cookie-consent__inner container">
        <h2 id={titleId} className="cookie-consent__title" ref={headingRef} tabIndex={-1}>
          Cookies and visitor statistics
        </h2>
        <p className="cookie-consent__text">
          With your permission, we use Google Analytics to count visits and see which pages and products are popular. It sets cookies and tells Google how this
          site is used, never your name, email, or address. It stays off unless you accept. The cookies that keep you signed in and remember your cart are
          always on. <Link to={ROUTES.page('privacy')}>Privacy policy</Link>
        </p>

        {showSettings && (
          <fieldset className="cookie-consent__settings">
            <legend className="visually-hidden">Optional cookies</legend>
            <div className="cookie-consent__option">
              <input ref={checkboxRef} id={statisticsId} type="checkbox" checked={statistics} onChange={(event) => setStatistics(event.target.checked)} aria-describedby={`${statisticsId}-hint`} />
              <label htmlFor={statisticsId}>Statistics</label>
            </div>
            <p id={`${statisticsId}-hint`} className="cookie-consent__hint">
              Google Analytics 4: which pages are viewed, and which products are looked at, added to the cart, or bought. Off until you switch it on.
            </p>
          </fieldset>
        )}

        <div className="cookie-consent__actions">
          <Button variant="outline" onClick={() => choose(true)}>
            Accept all
          </Button>
          <Button variant="outline" onClick={() => choose(false)}>
            Reject
          </Button>
          {showSettings ? (
            <Button variant="outline" onClick={() => choose(statistics)}>
              Save choices
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                focusSettings.current = true
                setShowSettings(true)
              }}
            >
              Settings
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

export default CookieConsent
