import { json } from './http.js'
import { laravelPhase12Data } from './shop/adminPhase12.js'

/*
 * Phase 12 admin routes (docs/backend/PHASE12_CONTRACT.md and its
 * implementation notes), BuyNest's Laravel API only. Matched by adminApi.js
 * before its own routes, so the admin session check there runs first; the
 * API then checks the role's permission and answers 403 { code:
 * "permission_denied", permission }, passed on unchanged.
 *
 * CHECK PAYMENT (orders.edit), SSLCommerz orders:
 *   POST   /api/admin/orders/:number/payment/check → { order, result: { found, status, message } }
 *          asks SSLCommerz about every attempt (by tran_id) and records a VALID/VALIDATED one.
 *          status: paid | review | already_paid | not_found | mismatch | unreachable.
 *          422 errors.order when the order isn't an SSLCommerz order, has no attempt yet, or is already paid.
 *
 * Everything else of phase 12 rides on existing routes:
 *   GET/PATCH settings          + store: { currency: { code, symbol, decimals }, currencyDocs, paymentProviders:
 *                                 { stripe|paypal|sslcommerz: { status: live|sandbox|test|not_configured|unavailable, message } } }
 *                                 checkout.enabledPaymentMethods may hold "sslcommerz"
 *   orders, invoices, credit memos, grid rows, dashboard and customer order rows: + currency ("BDT", "USD" for old orders)
 *   an order's payment          + methodLabel ("bKash"), and for SSLCommerz: sslcommerz: { tranId, valId, bankTranId,
 *                                 cardType, cardBrand, cardIssuer, riskLevel, riskTitle, attempts, mode, canCheck }; reference = bank_tran_id
 *   POST orders/:number/payment-link  an SSLCommerz order gets a new attempt (SSLCommerz's payment page)
 *   POST orders/:number/credit-memos  refunds through SSLCommerz first (422 errors.refund when it refuses)
 *   GET reports/sales           + currency, otherCurrencies: [{ currency, orders, gross, refunds, net }]
 *   the store currency itself   the storefront's public GET /api/catalog/store (currency, *_payments)
 */

const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const LIVE_ONLY = 'This needs the BuyNest backend; the demo data has no online payments to check.'
const live = (handler) => (ctx) => (realData() ? handler(ctx) : json({ message: LIVE_ONLY }, 404))
const fromLaravel = (result) => (result.ok ? json(result.data, result.status) : json(result.body, result.status))
const isOrderNumber = (value) => /^BN-\d{1,12}$/.test(value ?? '')

const PHASE12_ROUTES = {
  'POST orders/:id/payment/check': live(async (ctx) => fromLaravel(await laravelPhase12Data.checkPayment(ctx.token, ctx.id, ctx.request))),
}

/**
 * The phase 12 routes in adminApi.js's matcher: { route, id } for one of
 * them, null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchPhase12Route(method, segments) {
  const [first, second, third, fourth, ...rest] = segments
  if (first === 'orders' && third === 'payment') {
    if (!isOrderNumber(second) || fourth !== 'check' || rest.length > 0) return null
    return { route: PHASE12_ROUTES[`${method} orders/:id/payment/check`], id: second }
  }
  return undefined
}
