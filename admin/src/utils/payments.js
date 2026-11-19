/*
 * Phase 12 §5: Settings → Checkout → Payment methods shows, under each
 * online method, whether its provider works now (the API's
 * meta.payment_providers: live, sandbox/test, not configured, or not
 * available in the store currency, like PayPal in BDT).
 */

/** Which provider takes the money for each payment method. */
export const METHOD_PROVIDERS = { card: 'stripe', paypal: 'paypal', sslcommerz: 'sslcommerz' }

const STATUS_BADGES = {
  live: { tone: 'success', label: 'Live' },
  sandbox: { tone: 'info', label: 'Sandbox' },
  test: { tone: 'info', label: 'Test mode' },
  not_configured: { tone: 'warning', label: 'Not configured' },
  unavailable: { tone: 'neutral', label: 'Not available' },
}

// What the status means for shoppers and staff (after the API's own words).
const STATUS_TEXTS = {
  sandbox: 'Test payments only: no real money moves.',
  test: 'Test payments only: no real money moves.',
  not_configured: 'Shoppers can still choose it if it is on; staff invoice those orders by hand once the money arrives.',
  unavailable: "Shoppers don't see it, even when it is ticked here.",
}

/**
 * A payment method's status note for the settings checkbox ({ tone, label, text }),
 * or null when the method has no provider (cash on delivery) or the API doesn't say.
 */
export function paymentProviderNote(methodId, providers) {
  const provider = METHOD_PROVIDERS[methodId]
  const info = provider ? providers?.[provider] : null
  const badge = info && STATUS_BADGES[info.status]
  if (!badge) return null
  return { tone: badge.tone, label: info.message || badge.label, text: STATUS_TEXTS[info.status] ?? '' }
}
