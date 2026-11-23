import { useQuery } from '@tanstack/react-query'
import { COUNTRIES, PAYMENT_METHODS, SHIPPING_METHODS, SHIPPING_RULES } from '../constants/store'
import { SITE } from '../constants/site'
import { REAL_SHOP } from '../constants/shop'
import { storeSettingsQuery } from '../queries/contentQueries'
import { DEFAULT_STORE_CURRENCY } from '../utils/displayCurrency'

/**
 * The demo's rules (constants/store.js), in the same shape as the server's
 * settings (services/adapters/contentAdapter.js). Also the fallback in
 * REAL_SHOP while the settings load or if they can't be loaded: the server
 * applies its own rules to the order either way.
 */
export const DEFAULT_STORE_SETTINGS = {
  storeName: SITE.name,
  supportEmail: SITE.supportEmail,
  supportPhone: SITE.supportPhone,
  shippingMethods: SHIPPING_METHODS,
  standardShippingCost: SHIPPING_RULES.standardShippingCost,
  freeShippingThreshold: SHIPPING_RULES.freeShippingThreshold,
  countries: COUNTRIES,
  paymentMethods: PAYMENT_METHODS,
  guestCheckout: true,
  taxEnabled: false,
  // Phase 8: no payment provider in the demo (or while the real settings load).
  cardPayments: 'manual',
  // Phase 10: no PayPal connection and no statistics in the demo (or while the real settings load).
  paypalPayments: 'manual',
  ga4MeasurementId: null,
  // Phase 11: no display currencies and no reward points in the demo (or while the real settings load).
  currencies: { base: 'USD', display: [] },
  rewards: null,
  // Phase 12: the demo charges in USD and has no SSLCommerz (never offered; see constants/store.js).
  currency: DEFAULT_STORE_CURRENCY,
  sslcommerzPayments: 'manual',
  // Phase 13: both languages, English first, Bangla digits in Bangla.
  locales: ['en', 'bn'],
  defaultLocale: 'en',
  banglaDigits: true,
}

/**
 * Store settings: from the server with BuyNest's API (REAL_SHOP), the demo
 * constants otherwise (no request). `isPending` is true only while the real
 * settings are loading for the first time. `enabled: false` reads them only
 * if they're already cached (no request).
 */
export function useStoreSettings({ enabled = true } = {}) {
  const request = useQuery({ ...storeSettingsQuery(), enabled: REAL_SHOP && enabled })
  if (!REAL_SHOP) return { settings: DEFAULT_STORE_SETTINGS, isPending: false, error: null }
  return { settings: request.data ?? DEFAULT_STORE_SETTINGS, isPending: enabled && request.isPending, error: request.error, refetch: request.refetch }
}

/** Standard delivery when the store offers it, else the first enabled method. */
export const defaultShippingMethodId = (settings) =>
  (settings.shippingMethods.find((method) => method.id === 'standard') ?? settings.shippingMethods[0])?.id ?? 'standard'
