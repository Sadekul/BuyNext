import { api } from './client'

/*
 * Phase 12 (docs/backend/PHASE12_CONTRACT.md), BuyNest's backend only: the
 * store currency (taka or dollars, a deployment setting), SSLCommerz
 * (bKash, Nagad, cards) and "Check payment" on an order
 * (server/adminPhase12Api.js in the frontend project). Payment settings
 * ride on Settings (settings.edit); payment links and refunds on the
 * existing order routes. Permissions: none for the store info, orders.edit
 * for Check payment.
 */

export const phase12Keys = {
  store: ['store-info'],
}

/**
 * The store's public settings (the storefront's GET /api/catalog/store,
 * no permission needed), the parts the admin uses: the store currency and
 * whether each online payment provider works now.
 *   → { currency: { code, symbol, decimals }, cardPayments, paypalPayments, sslcommerzPayments }
 * Missing values come back null (an older API: USD and today's behaviour).
 */
export async function getStoreInfo({ signal } = {}) {
  const answer = await api.get('/api/catalog/store', { signal })
  return storeInfo(answer?.data)
}

const word = (value) => (typeof value === 'string' && value ? value : null)

/** The API's snake_case store settings → what the admin needs from them. */
export function storeInfo(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const currency = data.currency && typeof data.currency === 'object' && /^[A-Z]{3}$/.test(data.currency.code ?? '') ? data.currency : null
  return {
    currency: currency
      ? { code: currency.code, symbol: word(currency.symbol) ?? currency.code, decimals: Number.isInteger(currency.decimals) ? currency.decimals : 2 }
      : /^[A-Z]{3}$/.test(data.currencies?.base ?? '')
        ? { code: data.currencies.base, symbol: data.currencies.base, decimals: 2 }
        : null,
    cardPayments: word(data.card_payments),
    paypalPayments: word(data.paypal_payments),
    sslcommerzPayments: word(data.sslcommerz_payments),
  }
}

/** orders.edit: asks SSLCommerz about the order's attempts and records the payment if it went through → { found, status, message, order }. */
export const checkOrderPayment = (number) => api.post(`/api/admin/orders/${encodeURIComponent(number)}/payment/check`, {})
