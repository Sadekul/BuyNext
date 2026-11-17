import { useQuery } from '@tanstack/react-query'
import { COUNTRIES, PAYMENT_METHODS, SHIPPING_METHODS, SHIPPING_RULES } from '../constants/store'
import { SITE } from '../constants/site'
import { REAL_SHOP } from '../constants/shop'
import { storeSettingsQuery } from '../queries/contentQueries'

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
