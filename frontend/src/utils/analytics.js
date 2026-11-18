import { STORE_SETTINGS } from '../constants/store'

/*
 * Visitor statistics with Google Analytics 4, ONLY with the visitor's
 * consent (docs/backend/PHASE10_CONTRACT.md §6).
 *
 * Two switches must both be on:
 *   1. the build: VITE_ANALYTICS=ga4. Only then does the production
 *      Content-Security-Policy allow Google's script and endpoints
 *      (vite.config.js), so a build without it can't load them at all;
 *   2. the store: a measurement id in the admin's settings
 *      (`analytics.ga4_measurement_id`, read from GET /store at runtime).
 * With both, the cookie banner (components/layout/CookieConsent.jsx) asks.
 *
 * NOTHING LOADS BEFORE "Accept": no script element, no request to Google,
 * no Google cookie. "Reject" loads nothing either. Only after Accept is
 * gtag.js added (a plain <script> element: no npm package), with Consent
 * Mode v2 defaults set to "denied" first and then updated to grant only
 * analytics_storage (never ads). The choice is kept for 6 months in a
 * first-party cookie, `buynest_consent`.
 *
 * Events carry no personal data: no emails, names, addresses, or gift card
 * recipients; page addresses are sent without their query string (it can
 * hold tokens from email links).
 */

export const CONSENT_COOKIE = 'buynest_consent'
const CONSENT_MAX_AGE = 60 * 60 * 24 * 182 // about 6 months, in seconds
const GTAG_ORIGIN = 'https://www.googletagmanager.com'
const PURCHASES_KEY = 'buynest.analytics.purchases.v1'

/** The footer's "Cookie settings" link opens the banner again (components/layout/CookieConsent.jsx listens). */
export const COOKIE_SETTINGS_EVENT = 'buynest:cookie-settings'
export const openCookieSettings = () => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))

/** Whether this build may load Google Analytics (its CSP allows it). Read on each call, so tests can switch it. */
export const analyticsBuild = () => import.meta.env.VITE_ANALYTICS === 'ga4'

/** Whether to ask for consent at all: the build allows it and the store has a measurement id. */
export const analyticsAvailable = (settings) => analyticsBuild() && typeof settings?.ga4MeasurementId === 'string' && /^G-[A-Z0-9]{4,20}$/.test(settings.ga4MeasurementId)

/** The visitor's saved choice: 'granted', 'denied', or null (not asked yet). */
export function readConsent() {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${CONSENT_COOKIE}=`))
  const value = entry ? decodeURIComponent(entry.slice(CONSENT_COOKIE.length + 1)) : ''
  const match = /^v1\.statistics=(granted|denied)$/.exec(value)
  return match ? match[1] : null
}

/** Saves the choice for 6 months (first-party cookie; never sent to Google). */
export function saveConsent(statistics) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${CONSENT_COOKIE}=v1.statistics=${statistics ? 'granted' : 'denied'}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`
}

// What this page has loaded (one page = one start at most).
const state = { id: null, granted: false }

function gtag() {
  // gtag.js reads the `arguments` object itself from the data layer (not an array copy).
  window.dataLayer.push(arguments)
}

/**
 * Starts Google Analytics after consent: Consent Mode v2 defaults (all
 * denied), then the update granting statistics only, then gtag.js itself.
 * Calling it again (e.g. consent given again after withdrawing) only updates the consent.
 */
export function startAnalytics(measurementId) {
  if (!analyticsBuild() || !/^G-[A-Z0-9]{4,20}$/.test(measurementId ?? '')) return false
  window.dataLayer = window.dataLayer || []
  if (state.id) {
    gtag('consent', 'update', { analytics_storage: 'granted' })
    state.granted = true
    return true
  }
  window.gtag = gtag
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' })
  gtag('consent', 'update', { analytics_storage: 'granted' })
  gtag('js', new Date())
  // Page views are sent by the router (trackPageView), without query strings; no ads features.
  gtag('config', measurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false })
  const script = document.createElement('script')
  script.async = true
  script.src = `${GTAG_ORIGIN}/gtag/js?id=${encodeURIComponent(measurementId)}`
  script.dataset.buynestAnalytics = 'ga4'
  document.head.appendChild(script)
  state.id = measurementId
  state.granted = true
  return true
}

/** Consent withdrawn: Google may not store anything any more, and its cookies on this site are deleted. */
export function stopAnalytics() {
  if (state.id && window.dataLayer) gtag('consent', 'update', { analytics_storage: 'denied' })
  state.granted = false
  for (const cookie of document.cookie.split('; ')) {
    const name = cookie.split('=')[0]
    if (name === '_ga' || name.startsWith('_ga_')) {
      document.cookie = `${name}=; Max-Age=0; Path=/`
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${window.location.hostname.replace(/^www\./, '')}`
    }
  }
}

/** Whether events are being sent now (consent given and Google Analytics started). */
export const isTracking = () => state.granted && Boolean(state.id)

/** Sends one event, only while tracking. */
export function track(name, params = {}) {
  if (!isTracking() || typeof window.gtag !== 'function') return
  window.gtag('event', name, params)
}

// ---- e-commerce events (GA4's recommended names), without personal data ----

const currency = STORE_SETTINGS.currency
const round = (value) => Math.round((Number(value) || 0) * 100) / 100

/** A cart line, order line, or product → a GA4 item. Gift cards are "Gift card", never with their recipient. */
export function toAnalyticsItem(item, quantity = item.quantity ?? 1) {
  const price = item.salePrice ?? (item.price !== undefined ? round(item.price * (1 - (item.discountPercentage ?? 0) / 100)) : 0)
  return {
    item_id: String(item.productId ?? item.id ?? item.sku ?? ''),
    item_name: item.title ?? '',
    ...(item.giftCard || item.type === 'gift_card' || item.productType === 'gift_card' ? { item_category: 'gift_card' } : item.category && { item_category: item.category }),
    ...(item.brand && { item_brand: item.brand }),
    ...(item.variantLabel && { item_variant: item.variantLabel }),
    price: round(price),
    quantity,
  }
}

/** page_view: the path only (query strings can hold tokens from email links). */
export function trackPageView(pathname) {
  track('page_view', { page_location: `${window.location.origin}${pathname}`, page_path: pathname, page_title: document.title })
}

export function trackViewItem(product) {
  const item = toAnalyticsItem(product, 1)
  track('view_item', { currency, value: item.price, items: [item] })
}

export function trackAddToCart(product, quantity) {
  const item = toAnalyticsItem(product, quantity)
  track('add_to_cart', { currency, value: round(item.price * quantity), items: [item] })
}

export function trackBeginCheckout(items, total) {
  track('begin_checkout', { currency, value: round(total), items: items.filter((item) => !item.isUnavailable).map((item) => toAnalyticsItem(item)) })
}

/** purchase: once per order on this device (a reload or a revisit doesn't count it again). */
export function trackPurchase(order) {
  if (!isTracking() || !order?.number) return
  let sent
  try {
    const stored = JSON.parse(window.localStorage.getItem(PURCHASES_KEY) ?? '[]')
    sent = Array.isArray(stored) ? stored : []
  } catch {
    sent = []
  }
  if (sent.includes(order.number)) return
  track('purchase', {
    transaction_id: order.number,
    currency,
    value: round(order.totals?.total),
    tax: round(order.totals?.tax),
    shipping: round(order.totals?.shipping),
    ...(order.couponCode && { coupon: order.couponCode }),
    items: (order.items ?? []).map((item) => toAnalyticsItem(item)),
  })
  try {
    window.localStorage.setItem(PURCHASES_KEY, JSON.stringify([...sent, order.number].slice(-50)))
  } catch {
    // Without storage a revisit could count it twice; nothing else breaks.
  }
}

/** For tests: forget what this page loaded. */
export function resetAnalyticsForTests() {
  state.id = null
  state.granted = false
  delete window.gtag
  delete window.dataLayer
  for (const script of document.querySelectorAll('script[data-buynest-analytics]')) script.remove()
}
