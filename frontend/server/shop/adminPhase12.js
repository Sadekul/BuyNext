import { laravel } from '../http.js'
import { failed } from './adminSystem.js'
import { camelPath } from './laravel.js'
import { adminOrderDetail } from './admin.js'

/*
 * Phase 12 admin data from BuyNest's Laravel API (docs/backend/PHASE12_CONTRACT.md
 * and its "Implementation notes — backend"): the store currency and the
 * payment providers' status (Settings), each order's currency, SSLCommerz's
 * details on an order's payment, the sales report's other currencies, and
 * "Check payment". Only listed fields go either way; snake_case becomes
 * camelCase, money strings become numbers.
 * Every function resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

const str = (value) => (typeof value === 'string' && value !== '' ? value : null)
const money = (value) => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null)
const int = (value) => (Number.isInteger(value) ? value : typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : null)
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result, camelPath))

// ---- §1 currencies ----

/** An ISO 4217 code ("BDT"), else null. */
export const currencyCode = (value) => (typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null)

/** { code, symbol, decimals } (the store currency), else null. */
export function storeCurrency(raw) {
  if (!raw || typeof raw !== 'object' || !currencyCode(raw.code)) return null
  const decimals = int(raw.decimals)
  return { code: raw.code, symbol: str(raw.symbol)?.slice(0, 8) ?? raw.code, decimals: decimals !== null && decimals <= 3 ? decimals : 2 }
}

/** `{ currency }` for an order, invoice, credit memo, or grid row that says it (old answers: nothing). */
export const withCurrency = (raw) => (currencyCode(raw?.currency) ? { currency: raw.currency } : {})

// ---- §5 Settings: the store currency (read-only) and the payment providers ----

const PROVIDER_STATUSES = ['live', 'sandbox', 'test', 'not_configured', 'unavailable']
const PROVIDERS = ['stripe', 'paypal', 'sslcommerz']
// Only a docs path in the repository ("docs/CURRENCY.md") or an https page.
const docsLink = (value) => (typeof value === 'string' && (/^docs\/[A-Za-z0-9_./-]{1,100}\.md$/.test(value) || /^https:\/\/[^\s"'<>]{1,300}$/.test(value)) ? value : null)

/**
 * The settings answer's `meta` → `{ store: { currency, currencyDocs, paymentProviders } }`
 * (nothing before phase 12). paymentProviders: { stripe|paypal|sslcommerz: { status, message } }.
 */
export function settingsStore(meta) {
  if (!meta || typeof meta !== 'object') return {}
  const currency = storeCurrency(meta.store_currency)
  const providers = meta.payment_providers && typeof meta.payment_providers === 'object' ? meta.payment_providers : null
  if (!currency && !providers) return {}
  const paymentProviders = Object.fromEntries(
    PROVIDERS.filter((name) => PROVIDER_STATUSES.includes(providers?.[name]?.status)).map((name) => [name, { status: providers[name].status, message: str(providers[name].message)?.slice(0, 300) ?? null }]),
  )
  return { store: { currency, currencyDocs: docsLink(meta.currency_docs), paymentProviders } }
}

// ---- §3 SSLCommerz on an order's payment ----

// SSLCommerz's ids: letters, digits and a few separators only (they are shown, never put in a URL).
const sslId = (value) => (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,255}$/.test(value) ? value : null)

/** The staff payment's `sslcommerz` details → camelCase (null when the order never went to SSLCommerz). */
export function sslCommerzDetails(raw) {
  if (!raw || typeof raw !== 'object') return null
  const risk = int(raw.risk_level)
  return {
    tranId: sslId(raw.tran_id),
    valId: sslId(raw.val_id),
    bankTranId: sslId(raw.bank_tran_id),
    cardType: str(raw.card_type)?.slice(0, 100) ?? null,
    cardBrand: str(raw.card_brand)?.slice(0, 50) ?? null,
    cardIssuer: str(raw.card_issuer)?.slice(0, 100) ?? null,
    riskLevel: risk === 0 || risk === 1 ? risk : null,
    riskTitle: str(raw.risk_title)?.slice(0, 100) ?? null,
    attempts: int(raw.attempts) ?? 0,
    mode: raw.mode === 'live' ? 'live' : raw.mode === 'sandbox' ? 'sandbox' : null,
    canCheck: raw.can_check === true,
  }
}

/** The phase 12 fields of an order's `payment` (staff view): the friendly method name, and SSLCommerz's details. */
export function paymentPhase12(raw) {
  const payment = raw && typeof raw === 'object' ? raw : {}
  const fields = {}
  if (payment.method_label !== undefined) fields.methodLabel = str(payment.method_label)?.slice(0, 60) ?? null
  if (payment.provider === 'sslcommerz') {
    const details = sslCommerzDetails(payment.sslcommerz)
    fields.sslcommerz = details
    // `reference` is the bank transaction id; the mode badge comes from SSLCommerz's mode (there is no dashboard link).
    fields.reference = sslId(payment.reference) ?? details?.bankTranId ?? null
    fields.dashboardUrl = null
    fields.mode = details?.mode ?? null
  }
  return fields
}

// ---- §5 reports ----

/** The sales report's currency and the other currencies of the period: { currency, otherCurrencies: [{ currency, orders, gross, refunds, net }] }. */
export function salesCurrencies(data) {
  const others = Array.isArray(data?.other_currencies) ? data.other_currencies : []
  return {
    currency: currencyCode(data?.currency),
    otherCurrencies: others
      .filter((row) => currencyCode(row?.currency))
      .map((row) => ({ currency: row.currency, orders: int(row.orders) ?? 0, gross: money(row.gross) ?? 0, refunds: money(row.refunds) ?? 0, net: money(row.net) ?? 0 })),
  }
}

// ---- §3 Check payment (orders.edit) ----

const OUTCOMES = ['paid', 'review', 'already_paid', 'not_found', 'mismatch', 'unreachable']

export const laravelPhase12Data = {
  /** → { order, result: { found, status, message } }. */
  async checkPayment(token, number, request) {
    const result = await laravel(`/api/admin/v1/orders/${number}/payment/check`, { method: 'POST', token, request, body: {} })
    return answer(result, [200], (data) => ({
      order: adminOrderDetail(data.data),
      result: {
        found: data?.result?.found === true,
        status: OUTCOMES.includes(data?.result?.status) ? data.result.status : 'unknown',
        message: str(data?.result?.message)?.slice(0, 500) ?? null,
      },
      live: true,
    }))
  },
}
