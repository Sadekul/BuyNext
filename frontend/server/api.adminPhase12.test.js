// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { settingsStore, sslCommerzDetails } from './shop/adminPhase12.js'
import { validateAdminOrder } from './adminSalesApi.js'

/*
 * Phase 12 admin routes (adminPhase12Api.js, shop/adminPhase12.js) and the
 * phase 12 fields on orders, documents, settings, and the sales report.
 * Laravel is faked; shapes from "Implementation notes — backend" in
 * docs/backend/PHASE12_CONTRACT.md.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['orders.view', 'orders.edit', 'settings.edit', 'reports.view'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
}
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((entry) => entry.path !== '/api/admin/v1/me')

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const SSL = {
  tran_id: 'BN-100001-2', val_id: '2311191051061SgN6TUYrMZUjo1', bank_tran_id: '231119105106oBbRF4kc63bGOtN', card_type: 'BKASH-BKash', card_brand: 'MOBILEBANKING',
  card_issuer: 'BKash Mobile Banking', risk_level: '0', risk_title: 'Safe', attempts: 2, mode: 'sandbox', can_check: false,
}
const ORDER = {
  number: 'BN-100001', currency: 'BDT', status: 'processing', payment_status: 'paid', payment_method: 'sslcommerz', email: 'nadia@example.com',
  items: [{ id: 11, product_id: 3, name: 'Mascara', sku: 'BEA-1', quantity: 2, price: '1250.00', sale_price: '1250.00', line_total: '2500.00' }],
  totals: { item_count: 2, subtotal: '2500.00', discount: '0.00', shipping: '60.00', tax: '0.00', total: '2560.00' },
  invoices: [{ number: 'INV-100001', order_number: 'BN-100001', amount: '2560.00', currency: 'BDT', created_at: '2026-11-19T10:51:00Z' }],
  credit_memos: [{ number: 'CM-100001', order_number: 'BN-100001', total: '100.00', currency: 'BDT', refund_reference: 'SSLCZ_TEST_5f3b', created_at: '2026-11-19T12:00:00Z', items: [] }],
  payment: { provider: 'sslcommerz', reference: SSL.bank_tran_id, paid_at: '2026-11-19T10:51:00Z', url: null, expires_at: null, can_pay: false, method_label: 'bKash', sslcommerz: SSL },
  history: [],
}

describe('helpers', () => {
  it('maps the settings meta: the store currency, the guide, and each provider’s status', () => {
    expect(
      settingsStore({
        currency: 'BDT',
        store_currency: { code: 'BDT', symbol: '৳', decimals: 2 },
        currency_docs: 'docs/CURRENCY.md',
        payment_providers: {
          stripe: { status: 'test', message: 'Test mode' },
          paypal: { status: 'unavailable', message: 'Not available in BDT' },
          sslcommerz: { status: 'not_configured', message: 'Not configured: set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD' },
          klarna: { status: 'live', message: 'Live' },
        },
      }),
    ).toEqual({
      store: {
        currency: { code: 'BDT', symbol: '৳', decimals: 2 },
        currencyDocs: 'docs/CURRENCY.md',
        paymentProviders: {
          stripe: { status: 'test', message: 'Test mode' },
          paypal: { status: 'unavailable', message: 'Not available in BDT' },
          sslcommerz: { status: 'not_configured', message: 'Not configured: set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD' },
        },
      },
    })
    // Before phase 12 (meta.currency only): nothing. A bad guide link or status is dropped.
    expect(settingsStore({ currency: 'USD' })).toEqual({})
    expect(settingsStore({ store_currency: { code: 'usd' }, payment_providers: { paypal: { status: 'broken' } }, currency_docs: 'javascript:alert(1)' })).toEqual({ store: { currency: null, currencyDocs: null, paymentProviders: {} } })
  })

  it('keeps only safe SSLCommerz ids and known risk levels', () => {
    expect(sslCommerzDetails(null)).toBeNull()
    expect(sslCommerzDetails({ ...SSL, val_id: '<script>', bank_tran_id: 'a b', risk_level: 7, mode: 'other', attempts: 'x' })).toMatchObject({ valId: null, bankTranId: null, riskLevel: null, mode: null, attempts: 0 })
  })
})

describe('orders', () => {
  it("gives the order its currency, SSLCommerz's details, and the documents' currency", async () => {
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: ORDER } } })
    const order = await (await admin('orders/BN-100001')).json()
    expect(order.currency).toBe('BDT')
    expect(order.payment).toEqual({
      provider: 'sslcommerz', reference: SSL.bank_tran_id, dashboardUrl: null, mode: 'sandbox', paidAt: '2026-11-19T10:51:00Z', url: null, expiresAt: null, canPay: false, methodLabel: 'bKash',
      sslcommerz: {
        tranId: 'BN-100001-2', valId: SSL.val_id, bankTranId: SSL.bank_tran_id, cardType: 'BKASH-BKash', cardBrand: 'MOBILEBANKING', cardIssuer: 'BKash Mobile Banking',
        riskLevel: 0, riskTitle: 'Safe', attempts: 2, mode: 'sandbox', canCheck: false,
      },
    })
    expect(order.invoices[0]).toMatchObject({ number: 'INV-100001', amount: 2560, currency: 'BDT' })
    expect(order.creditMemos[0]).toMatchObject({ number: 'CM-100001', total: 100, currency: 'BDT' })
    expect(order.totals.total).toBe(2560)
  })

  it('keeps the old shapes for orders without phase 12 fields, and adds methodLabel for other providers when sent', async () => {
    const stripe = { ...ORDER, currency: undefined, payment: { provider: 'stripe', reference: 'pi_123', paid_at: '2026-11-19T10:51:00Z', can_pay: false, method_label: null } }
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: stripe } } })
    const order = await (await admin('orders/BN-100001')).json()
    expect(order.currency).toBeUndefined()
    expect(order.payment).toMatchObject({ provider: 'stripe', reference: 'pi_123', mode: 'test', methodLabel: null })
    expect(order.payment.sslcommerz).toBeUndefined()
  })

  it('an SSLCommerz order before its first payment page is still SSLCommerz', async () => {
    const fresh = { ...ORDER, status: 'pending_payment', payment_status: 'unpaid', payment: { provider: null, reference: null, paid_at: null, url: null, expires_at: null, can_pay: true, method_label: null, sslcommerz: { ...SSL, val_id: null, bank_tran_id: null, card_type: null, risk_level: null, attempts: 0, can_check: false } } }
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: fresh } } })
    const order = await (await admin('orders/BN-100001')).json()
    expect(order.payment).toMatchObject({ provider: 'sslcommerz', reference: null, dashboardUrl: null, canPay: true, sslcommerz: { attempts: 0, canCheck: false, riskLevel: null } })
  })

  it('gives every grid row its currency', async () => {
    fakeLaravel({
      'GET /api/admin/v1/orders': { body: { data: [{ ...ORDER, customer: null }, { ...ORDER, number: 'BN-100000', currency: 'USD', totals: { ...ORDER.totals, total: '42.50' } }], meta: { total: 2 } } },
    })
    const list = await (await admin('orders?limit=20&skip=0')).json()
    expect(list.orders.map((row) => [row.number, row.total, row.currency])).toEqual([
      ['BN-100001', 2560, 'BDT'],
      ['BN-100000', 42.5, 'USD'],
    ])
  })

  it('accepts SSLCommerz for admin-created orders (the customer pays by the payment link)', () => {
    const body = { customerId: 5, items: [{ productId: 3, quantity: 1 }], shippingMethod: 'standard', paymentMethod: 'sslcommerz', sameAsShipping: true }
    expect(validateAdminOrder(body, { quote: true }).values.paymentMethod).toBe('sslcommerz')
    expect(validateAdminOrder({ ...body, paymentMethod: 'bkash' }, { quote: false }).errors.paymentMethod).toEqual(['Choose a payment method.'])
    expect(validateAdminOrder(body, { quote: false }).errors?.paymentMethod).toBeUndefined()
  })
})

describe('Check payment', () => {
  it('asks the API and answers the reloaded order with the outcome', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/orders/BN-100001/payment/check': { body: { data: ORDER, result: { found: true, status: 'paid', message: 'SSLCommerz confirmed the payment (bKash).' } } },
    })
    const answer = await admin('orders/BN-100001/payment/check', { method: 'POST', body: {} })
    expect(answer.status).toBe(200)
    const body = await answer.json()
    expect(body.result).toEqual({ found: true, status: 'paid', message: 'SSLCommerz confirmed the payment (bKash).' })
    expect(body.order).toMatchObject({ number: 'BN-100001', currency: 'BDT', paymentStatus: 'paid' })
    expect(toApi(calls).map((entry) => `${entry.method} ${entry.path}`)).toEqual(['POST /api/admin/v1/orders/BN-100001/payment/check'])
  })

  it("passes the API's refusal and permission errors on, and an unknown outcome stays unknown", async () => {
    fakeLaravel({
      'POST /api/admin/v1/orders/BN-100001/payment/check': { status: 422, body: { message: 'Invalid.', errors: { order: ['This order is already paid.'] } } },
      'POST /api/admin/v1/orders/BN-100002/payment/check': { status: 403, body: { message: 'No.', code: 'permission_denied', permission: 'orders.edit' } },
      'POST /api/admin/v1/orders/BN-100003/payment/check': { body: { data: ORDER, result: { found: 'yes', status: 'weird', message: 42 } } },
    })
    const refused = await admin('orders/BN-100001/payment/check', { method: 'POST', body: {} })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ order: ['This order is already paid.'] })
    const denied = await admin('orders/BN-100002/payment/check', { method: 'POST', body: {} })
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'permission_denied', permission: 'orders.edit' })
    expect((await (await admin('orders/BN-100003/payment/check', { method: 'POST', body: {} })).json()).result).toEqual({ found: false, status: 'unknown', message: null })
  })

  it('refuses malformed addresses and other methods before any call, and needs the BuyNest backend', async () => {
    const calls = fakeLaravel({})
    expect((await admin('orders/BN-1x/payment/check', { method: 'POST', body: {} })).status).toBe(404)
    expect((await admin('orders/BN-100001/payment', { method: 'POST', body: {} })).status).toBe(404)
    expect((await admin('orders/BN-100001/payment/check/now', { method: 'POST', body: {} })).status).toBe(404)
    expect((await admin('orders/BN-100001/payment/check')).status).toBe(404)
    expect(toApi(calls)).toEqual([])

    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    expect((await admin('orders/BN-100001/payment/check', { method: 'POST', body: {} })).status).toBe(404)
    expect(toApi(calls)).toEqual([])
  })
})

describe('settings and reports', () => {
  const SETTINGS = { checkout: { allowed_countries: ['Bangladesh'], guest_checkout: true, enabled_payment_methods: ['card', 'sslcommerz', 'cod'] } }
  const META = {
    currency: 'BDT',
    store_currency: { code: 'BDT', symbol: '৳', decimals: 2 },
    currency_docs: 'docs/CURRENCY.md',
    payment_providers: { stripe: { status: 'test', message: 'Test mode' }, paypal: { status: 'unavailable', message: 'Not available in BDT' }, sslcommerz: { status: 'sandbox', message: 'Sandbox' } },
  }

  it('reads the store currency and providers with the settings, and saves SSLCommerz as a payment method', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/settings': { body: { data: SETTINGS, meta: META } }, 'PATCH /api/admin/v1/settings': { body: { data: SETTINGS, meta: META } } })
    const settings = await (await admin('settings')).json()
    expect(settings.checkout.enabledPaymentMethods).toEqual(['card', 'sslcommerz', 'cod'])
    expect(settings.store).toEqual({
      currency: { code: 'BDT', symbol: '৳', decimals: 2 },
      currencyDocs: 'docs/CURRENCY.md',
      paymentProviders: { stripe: { status: 'test', message: 'Test mode' }, paypal: { status: 'unavailable', message: 'Not available in BDT' }, sslcommerz: { status: 'sandbox', message: 'Sandbox' } },
    })

    const saved = await admin('settings', { method: 'PATCH', body: { checkout: { enabledPaymentMethods: ['card', 'sslcommerz'] } } })
    expect(saved.status).toBe(200)
    expect((await saved.json()).store.currency.code).toBe('BDT')
    expect(sent(toApi(calls).find((entry) => entry.method === 'PATCH'))).toEqual({ checkout: { enabled_payment_methods: ['card', 'sslcommerz'] } })

    const bad = await admin('settings', { method: 'PATCH', body: { checkout: { enabledPaymentMethods: ['bkash'] } } })
    expect(bad.status).toBe(422)
    expect((await bad.json()).errors).toEqual({ 'checkout.enabledPaymentMethods': ['Keep at least one payment method.'] })
  })

  it("gives the sales report its currency and the period's other currencies", async () => {
    fakeLaravel({
      'GET /api/admin/v1/reports/sales': {
        body: {
          data: {
            currency: 'BDT',
            totals: { orders: 3, units: 5, gross: '12000.00', discounts: '0.00', shipping: '120.00', tax: '0.00', refunds: '0.00', net: '12000.00', average_order: '4000.00' },
            series: [],
            other_currencies: [{ currency: 'USD', orders: 2, gross: '80.00', refunds: '20.00', net: '60.00' }, { currency: 'nope', orders: 1 }],
          },
          meta: { from: '2026-11-01', to: '2026-11-19', group_by: 'day' },
        },
      },
    })
    const report = await (await admin('reports/sales?from=2026-11-01&to=2026-11-19&groupBy=day')).json()
    expect(report.currency).toBe('BDT')
    expect(report.totals.net).toBe(12000)
    expect(report.otherCurrencies).toEqual([{ currency: 'USD', orders: 2, gross: 80, refunds: 20, net: 60 }])
  })
})
