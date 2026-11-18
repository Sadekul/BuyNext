import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyticsAvailable,
  readConsent,
  resetAnalyticsForTests,
  saveConsent,
  startAnalytics,
  stopAnalytics,
  toAnalyticsItem,
  track,
  trackPurchase,
} from './analytics'
import { withGiftCard } from './giftCards'

// Phase 10 §6: Google Analytics 4, only with consent, never with personal data.
const ID = 'G-TEST12345'
const gtagScripts = () => document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]')
const commands = () => (window.dataLayer ?? []).map((entry) => Array.from(entry))

beforeEach(() => vi.stubEnv('VITE_ANALYTICS', 'ga4'))
afterEach(() => {
  resetAnalyticsForTests()
  document.cookie = 'buynest_consent=; Max-Age=0; Path=/'
  vi.unstubAllEnvs()
})

describe('consent cookie', () => {
  it('is unset at first, then remembers the choice', () => {
    expect(readConsent()).toBeNull()
    saveConsent(true)
    expect(readConsent()).toBe('granted')
    expect(document.cookie).toContain('buynest_consent=v1.statistics=granted')
    saveConsent(false)
    expect(readConsent()).toBe('denied')
  })

  it('ignores a value it did not write', () => {
    document.cookie = 'buynest_consent=yes please; Path=/'
    expect(readConsent()).toBeNull()
  })
})

describe('switches', () => {
  it('needs both the build flag and a measurement id', () => {
    expect(analyticsAvailable({ ga4MeasurementId: ID })).toBe(true)
    expect(analyticsAvailable({ ga4MeasurementId: null })).toBe(false)
    expect(analyticsAvailable({ ga4MeasurementId: 'UA-1234' })).toBe(false)
    vi.stubEnv('VITE_ANALYTICS', '')
    expect(analyticsAvailable({ ga4MeasurementId: ID })).toBe(false)
    expect(startAnalytics(ID)).toBe(false)
    expect(gtagScripts()).toHaveLength(0)
  })
})

describe('loading Google Analytics', () => {
  it('nothing is loaded or sent before startAnalytics (consent)', () => {
    track('page_view', { page_path: '/' })
    expect(gtagScripts()).toHaveLength(0)
    expect(window.dataLayer).toBeUndefined()
  })

  it('sets Consent Mode v2 defaults to denied, grants statistics only, then adds gtag.js once', () => {
    expect(startAnalytics(ID)).toBe(true)
    const [defaults, update, , config] = commands()
    expect(defaults).toEqual(['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }])
    expect(update).toEqual(['consent', 'update', { analytics_storage: 'granted' }])
    expect(config).toEqual(['config', ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false }])
    expect(gtagScripts()).toHaveLength(1)
    expect(gtagScripts()[0].src).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`)
    expect(gtagScripts()[0].async).toBe(true)

    startAnalytics(ID) // again: no second script
    expect(gtagScripts()).toHaveLength(1)
  })

  it('refuses an id that is not a GA4 measurement id', () => {
    expect(startAnalytics('G-1"><script>')).toBe(false)
    expect(gtagScripts()).toHaveLength(0)
  })

  it('withdrawing consent denies storage, stops events, and deletes Google’s cookies', () => {
    startAnalytics(ID)
    document.cookie = '_ga=GA1.1.123; Path=/'
    document.cookie = '_ga_TEST12345=GS1.1; Path=/'
    stopAnalytics()
    expect(commands().at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    expect(document.cookie).not.toMatch(/_ga/)
    const count = window.dataLayer.length
    track('view_item', {})
    expect(window.dataLayer).toHaveLength(count)
  })
})

describe('events without personal data', () => {
  it('a gift card is "gift_card" with its amount: no recipient, email, or message', () => {
    const card = withGiftCard({ id: 30, title: 'BuyNest Gift Card', type: 'gift_card', price: 25 }, { amount: 50, recipientName: 'Sam Lee', recipientEmail: 'sam@example.com', message: 'Happy birthday' })
    const item = toAnalyticsItem({ ...card, productId: 30, quantity: 1 })
    expect(item).toEqual({ item_id: '30', item_name: 'BuyNest Gift Card', item_category: 'gift_card', price: 50, quantity: 1 })
    expect(JSON.stringify(item)).not.toMatch(/Sam|example\.com|birthday/)
  })

  it('purchase: once per order, with the order number, value, and items, and no email or address', () => {
    startAnalytics(ID)
    const order = {
      number: 'BN-100001', email: 'ava@example.com', shippingAddress: { firstName: 'Ava', line1: '12 Market Street' }, couponCode: 'NEST10',
      totals: { total: 22.87, tax: 1.5, shipping: 4.99 },
      items: [{ productId: 1, title: 'Mascara', salePrice: 8.94, quantity: 2 }],
    }
    trackPurchase(order)
    trackPurchase(order)
    const purchases = commands().filter(([type, name]) => type === 'event' && name === 'purchase')
    expect(purchases).toHaveLength(1)
    expect(purchases[0][2]).toEqual({
      transaction_id: 'BN-100001', currency: 'USD', value: 22.87, tax: 1.5, shipping: 4.99, coupon: 'NEST10',
      items: [{ item_id: '1', item_name: 'Mascara', price: 8.94, quantity: 2 }],
    })
    expect(JSON.stringify(purchases[0])).not.toMatch(/ava@|Market Street/)
  })
})
