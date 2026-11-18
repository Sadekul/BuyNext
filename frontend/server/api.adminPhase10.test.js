// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 10 admin routes (adminPhase10Api.js, shop/adminPhase10.js) and the
 * phase 10 fields on orders, refunds, products, and settings. Laravel is
 * faked; shapes from "Implementation notes — part A and part B" in
 * docs/backend/PHASE10_CONTRACT.md.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['orders.view', 'settings.edit', 'gift_cards.manage'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    if (route.raw) return route.raw()
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body, headers = {}, raw } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
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

const PDF = new TextEncoder().encode('%PDF-1.7\n%test\n%%EOF')
const pdfAnswer = (name) => () =>
  new Response(PDF, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': String(PDF.byteLength) } })

describe('PDF documents', () => {
  it('streams the invoice and credit memo PDFs with their type and attachment name', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/invoices/INV-100001.pdf': { raw: pdfAnswer('INV-100001.pdf') },
      'GET /api/admin/v1/credit-memos/CM-100002.pdf': { raw: pdfAnswer('CM-100002.pdf') },
    })
    const invoice = await admin('invoices/INV-100001/pdf')
    expect(invoice.status).toBe(200)
    expect(invoice.headers.get('content-type')).toBe('application/pdf')
    expect(invoice.headers.get('content-disposition')).toBe('attachment; filename="INV-100001.pdf"')
    expect(invoice.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await invoice.arrayBuffer())).toEqual(PDF)
    expect(toApi(calls).at(-1).headers.Authorization).toBe('Bearer 9|ADMIN')

    const memo = await admin('credit-memos/CM-100002/pdf')
    expect(memo.headers.get('content-disposition')).toBe('attachment; filename="CM-100002.pdf"')
  })

  it("passes the API's 404 on, refuses malformed numbers, and never trusts an odd file name", async () => {
    fakeLaravel({
      'GET /api/admin/v1/invoices/INV-100009.pdf': { status: 404, body: { message: 'Invoice not found.' } },
      'GET /api/admin/v1/invoices/INV-100003.pdf': { raw: pdfAnswer('../../etc/passwd') },
    })
    const missing = await admin('invoices/INV-100009/pdf')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ message: 'Invoice not found.' })
    expect((await admin('invoices/BN-1/pdf')).status).toBe(404)
    expect((await admin('invoices/INV-1/pdf/x')).status).toBe(404)
    expect((await admin('invoices/INV-100003/pdf')).headers.get('content-disposition')).toBe('attachment; filename="INV-100003.pdf"')
  })

  it('without the BuyNest backend there are no PDFs', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    fakeLaravel({})
    expect((await admin('invoices/INV-100001/pdf')).status).toBe(404)
  })
})

const ROW = { id: 4, method: 'express', country: 'United States', min_weight_grams: 0, max_weight_grams: 2000, min_subtotal: '0.00', max_subtotal: null, price: '9.50', position: 1 }

describe('shipping table rates', () => {
  it('lists rows with the flat prices, and creates one with money as 2-decimal strings', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/shipping-rates': {
        body: { data: [ROW], meta: { default_weight_grams: 500, methods: [{ id: 'express', label: 'Express', flat_price: '12.99', rows: 1 }, { id: 'evil', label: 'x' }] } },
      },
      'POST /api/admin/v1/shipping-rates': { status: 201, body: { data: { ...ROW, id: 5, country: '*', price: '4.00', position: 2 } } },
    })
    expect(await (await admin('shipping-rates')).json()).toEqual({
      rates: [{ id: 4, method: 'express', country: 'United States', minWeightGrams: 0, maxWeightGrams: 2000, minSubtotal: 0, maxSubtotal: null, price: 9.5, position: 1 }],
      defaultWeightGrams: 500,
      methods: [{ id: 'express', label: 'Express', flatPrice: 12.99, rows: 1 }],
      live: true,
    })
    const created = await admin('shipping-rates', { method: 'POST', body: { method: 'express', country: ' * ', minWeightGrams: 0, maxWeightGrams: null, minSubtotal: 0, maxSubtotal: 100, price: 4 } })
    expect(created.status).toBe(201)
    expect((await created.json()).rate).toMatchObject({ id: 5, country: '*', price: 4, position: 2 })
    expect(sent(toApi(calls).at(-1))).toEqual({ method: 'express', country: '*', min_weight_grams: 0, max_weight_grams: null, min_subtotal: '0.00', max_subtotal: '100.00', price: '4.00' })
  })

  it('checks rows here first, and passes the API field errors on in the form names', async () => {
    fakeLaravel({ 'PATCH /api/admin/v1/shipping-rates/4': { status: 422, body: { message: 'Invalid.', errors: { max_weight_grams: ['Must be larger.'] } } } })
    const bad = await admin('shipping-rates', { method: 'POST', body: { method: 'drone', country: '', minWeightGrams: -1, price: 1.234, maxSubtotal: 'x' } })
    expect(bad.status).toBe(422)
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(['country', 'maxSubtotal', 'method', 'minWeightGrams', 'price'])
    const backwards = await admin('shipping-rates', { method: 'POST', body: { method: 'standard', country: 'Germany', minWeightGrams: 500, maxWeightGrams: 100, price: 1 } })
    expect((await backwards.json()).errors).toEqual({ maxWeightGrams: ['The maximum weight must be more than the minimum.'] })
    const refused = await admin('shipping-rates/4', { method: 'PATCH', body: { maxWeightGrams: 10 } })
    expect((await refused.json()).errors).toEqual({ maxWeightGrams: ['Must be larger.'] })
  })

  it('deletes, reorders one method, and checks a cart', async () => {
    const calls = fakeLaravel({
      'DELETE /api/admin/v1/shipping-rates/4': { status: 204 },
      'POST /api/admin/v1/shipping-rates/reorder': { body: { data: [{ ...ROW, id: 6, position: 0 }, { ...ROW, position: 1 }] } },
      'POST /api/admin/v1/shipping-rates/check': {
        body: {
          data: [
            { method: 'standard', label: 'Standard', available: true, price: '4.99', source: 'flat', rate_id: null },
            { method: 'express', label: 'Express', available: false, price: null, source: 'table', rate_id: null },
          ],
        },
      },
    })
    expect(await (await admin('shipping-rates/4', { method: 'DELETE' })).json()).toEqual({ deleted: true, live: true })
    const reordered = await (await admin('shipping-rates/reorder', { method: 'POST', body: { method: 'express', ids: [6, 4] } })).json()
    expect(reordered.rates.map((rate) => rate.id)).toEqual([6, 4])
    expect(sent(toApi(calls).at(-1))).toEqual({ method: 'express', ids: [6, 4] })
    expect((await admin('shipping-rates/reorder', { method: 'POST', body: { method: 'express', ids: [6, 6] } })).status).toBe(422)

    const checked = await (await admin('shipping-rates/check', { method: 'POST', body: { country: 'Germany', weightGrams: 1200, subtotal: 35 } })).json()
    expect(sent(toApi(calls).at(-1))).toEqual({ country: 'Germany', weight_grams: 1200, subtotal: '35.00' })
    expect(checked).toEqual({
      methods: [
        { method: 'standard', label: 'Standard', available: true, price: 4.99, source: 'flat', rateId: null },
        { method: 'express', label: 'Express', available: false, price: null, source: 'table', rateId: null },
      ],
      country: 'Germany',
      weightGrams: 1200,
      subtotal: 35,
      live: true,
    })
    expect((await (await admin('shipping-rates/check', { method: 'POST', body: { weightGrams: 1.5, subtotal: -1 } })).json()).errors).toMatchObject({ weightGrams: expect.any(Array), subtotal: expect.any(Array) })
  })

  it('imports a CSV as multipart (row errors in the form names) and exports the CSV', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/shipping-rates/import': { status: 422, body: { message: 'Invalid.', errors: { 'rows.3.min_weight_grams': ['Must be a whole number.'] } } },
      'GET /api/admin/v1/shipping-rates/export.csv': {
        raw: () => new Response('method,country\nexpress,*\n', { status: 200, headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="shipping-rates-2026-11-17.csv"' } }),
      },
    })
    const form = new FormData()
    form.append('file', new Blob(['method,country\n'], { type: 'text/csv' }), 'rates.csv')
    form.append('mode', 'append')
    const request = new Request(`${SITE}/x`, { method: 'POST', body: form })
    const refused = await admin('shipping-rates/import', { method: 'POST', headers: { 'Content-Type': request.headers.get('content-type') }, raw: await request.arrayBuffer() })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ 'rows.3.minWeightGrams': ['Must be a whole number.'] })
    expect(toApi(calls).at(-1).headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    expect((await admin('shipping-rates/import', { method: 'POST', body: { file: 'x' } })).status).toBe(422)

    const csv = await admin('shipping-rates/export.csv')
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="shipping-rates-2026-11-17.csv"')
    expect(await csv.text()).toBe('method,country\nexpress,*\n')
  })
})

const CARD = {
  id: 7, last4: 'K7Q2', initial_balance: '50.00', balance: '30.00', currency: 'USD', status: 'active', expires_at: null,
  recipient_name: 'Ana', recipient_email: 'ana@example.com', message: 'Sorry!', purchase_order_number: null,
  created_by_admin: { id: 1, name: 'Store Owner' }, created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:00:00Z',
  code_hash: 'never-sent',
}

describe('gift cards', () => {
  it('lists with search and status, never with the code', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/gift-cards': { body: { data: [CARD], meta: { total: 1 } } } })
    const list = await (await admin('gift-cards?q=ana&status=disabled&limit=10&skip=10')).json()
    expect(toApi(calls).at(-1).search).toBe('?page=2&per_page=10&search=ana&status=disabled')
    expect(list).toEqual({
      giftCards: [
        {
          id: 7, last4: 'K7Q2', initialBalance: 50, balance: 30, currency: 'USD', status: 'active', expiresAt: null, recipientName: 'Ana',
          recipientEmail: 'ana@example.com', message: 'Sorry!', orderNumber: null, createdByAdmin: 'Store Owner', createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:00:00Z',
        },
      ],
      total: 1,
      limit: 10,
      skip: 10,
      live: true,
    })
    await admin('gift-cards?status=nope')
    expect(toApi(calls).at(-1).search).toBe('?page=1&per_page=20')
  })

  it('shows one card with its history', async () => {
    fakeLaravel({
      'GET /api/admin/v1/gift-cards/7': {
        body: { data: { ...CARD, transactions: [{ id: 2, amount: '-20.00', balance_after: '30.00', note: 'Order', order_number: 'BN-100004', credit_memo_number: null, admin_name: null, created_at: 'T' }] } },
      },
    })
    const card = await (await admin('gift-cards/7')).json()
    expect(card.transactions).toEqual([{ id: 2, amount: -20, balanceAfter: 30, note: 'Order', orderNumber: 'BN-100004', creditMemoNumber: null, adminName: null, createdAt: 'T' }])
    expect(card).not.toHaveProperty('codeHash')
  })

  it('creates a card (the code once), adjusts it with a note, and disables it', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/gift-cards': { status: 201, body: { data: { ...CARD, code: 'ABCD-EFGH-JKMN-K7Q2' } } },
      'POST /api/admin/v1/gift-cards/7/adjust': { body: { data: { ...CARD, balance: '25.00' } } },
      'PATCH /api/admin/v1/gift-cards/7': { body: { data: { ...CARD, status: 'disabled' } } },
    })
    const created = await admin('gift-cards', { method: 'POST', body: { amount: 50, recipientName: ' Ana ', recipientEmail: 'ana@example.com', message: '', expiresAt: '2027-01-31', sendEmail: true } })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ code: 'ABCD-EFGH-JKMN-K7Q2', giftCard: { id: 7, last4: 'K7Q2' } })
    expect(sent(toApi(calls).at(-1))).toEqual({ amount: '50.00', recipient_name: 'Ana', recipient_email: 'ana@example.com', message: null, expires_at: '2027-01-31T23:59:59Z', notify_recipient: true })

    const noEmail = await admin('gift-cards', { method: 'POST', body: { amount: 0.5, sendEmail: true } })
    expect((await noEmail.json()).errors).toMatchObject({ amount: expect.any(Array), recipientEmail: expect.any(Array) })

    expect((await (await admin('gift-cards/7/adjust', { method: 'POST', body: { amount: -5, note: ' Goodwill ' } })).json()).giftCard.balance).toBe(25)
    expect(sent(toApi(calls).at(-1))).toEqual({ amount: '-5.00', note: 'Goodwill' })
    expect((await admin('gift-cards/7/adjust', { method: 'POST', body: { amount: 0, note: '' } })).status).toBe(422)

    expect((await (await admin('gift-cards/7/disable', { method: 'POST', body: {} })).json()).giftCard.status).toBe('disabled')
    expect(toApi(calls).at(-1)).toMatchObject({ method: 'PATCH', path: '/api/admin/v1/gift-cards/7' })
    expect(sent(toApi(calls).at(-1))).toEqual({ status: 'disabled' })
    expect((await admin('gift-cards/7/delete', { method: 'POST', body: {} })).status).toBe(404)
  })

  it('passes a 403 permission_denied on unchanged', async () => {
    fakeLaravel({ 'POST /api/admin/v1/gift-cards/7/adjust': { status: 403, body: { message: 'No.', code: 'permission_denied', permission: 'gift_cards.manage' } } })
    const refused = await admin('gift-cards/7/adjust', { method: 'POST', body: { amount: 5, note: 'Goodwill' } })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ message: 'No.', code: 'permission_denied', permission: 'gift_cards.manage' })
  })
})

const ORDER = {
  number: 'BN-100001', status: 'processing', payment_status: 'paid', payment_method: 'paypal', email: 'x@example.com',
  items: [
    { id: 11, product_id: 3, name: 'Gift card', sku: 'GIFT', quantity: 1, price: '50.00', sale_price: '50.00', line_total: '50.00', gift_card: { amount: '50.00', recipient_name: 'Ana', recipient_email: 'ana@example.com', message: 'Happy birthday' } },
  ],
  totals: { item_count: 1, subtotal: '50.00', discount: '0.00', shipping: '0.00', tax: '0.00', total: '50.00', gift_card: '20.00', amount_due: '30.00' },
  gift_card: { last4: 'ZZ99', amount: '20.00' },
  gift_cards_issued: [{ id: 8, last4: 'AB12', amount: '50.00', recipient_email: 'ana@example.com', status: 'active' }],
  payment: { provider: 'paypal', reference: '8MC585209K746392H', dashboard_url: 'https://www.sandbox.paypal.com/activity/payment/8MC585209K746392H', paid_at: '2026-11-17T10:00:00Z', url: null, expires_at: null, can_pay: false },
  history: [],
}

describe('orders, refunds, and credit memos', () => {
  it('shows a PayPal capture with its sandbox dashboard link, the gift card part, and gift card lines', async () => {
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: ORDER } } })
    const order = await (await admin('orders/BN-100001')).json()
    expect(order.payment).toEqual({
      provider: 'paypal', reference: '8MC585209K746392H', dashboardUrl: 'https://www.sandbox.paypal.com/activity/payment/8MC585209K746392H', mode: 'sandbox',
      paidAt: '2026-11-17T10:00:00Z', url: null, expiresAt: null, canPay: false,
    })
    expect(order.giftCardPayment).toEqual({ last4: 'ZZ99', amount: 20 })
    expect(order.giftCardsIssued).toEqual([{ id: 8, last4: 'AB12', amount: 50, recipientEmail: 'ana@example.com', status: 'active' }])
    expect(order.lines[0].giftCard).toEqual({ amount: 50, recipientName: 'Ana', recipientEmail: 'ana@example.com', message: 'Happy birthday' })
  })

  it('live PayPal links are kept; anything else is dropped, never guessed', async () => {
    const live = { ...ORDER.payment, dashboard_url: 'https://www.paypal.com/activity/payment/8MC585209K746392H' }
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: { ...ORDER, payment: live } } } })
    expect((await (await admin('orders/BN-100001')).json()).payment).toMatchObject({ mode: 'live', dashboardUrl: live.dashboard_url })
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: { ...ORDER, payment: { ...live, dashboard_url: 'https://evil.example/8MC' } } } } })
    expect((await (await admin('orders/BN-100001')).json()).payment).toMatchObject({ mode: null, dashboardUrl: null, reference: '8MC585209K746392H' })
  })

  it('an order without a gift card has none', async () => {
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: { ...ORDER, gift_card: null, gift_cards_issued: undefined, totals: { ...ORDER.totals, gift_card: '0.00' } } } } })
    const order = await (await admin('orders/BN-100001')).json()
    expect(order.giftCardPayment).toBeNull()
    expect(order.giftCardsIssued).toEqual([])
  })

  it("adds what can go back to the gift card, the credit memo's split, and passes PayPal's refusal on", async () => {
    fakeLaravel({
      'GET /api/admin/v1/orders/BN-100001/refundable': { body: { data: { items: [], shipping_refundable: '0.00', max_total: '50.00', gift_card_refundable: '20.00' } } },
      'GET /api/admin/v1/credit-memos/CM-100001': { body: { data: { number: 'CM-100001', total: '30.00', gift_card_refund: '20.00', other_refund: '10.00', refund_reference: '1JU08902781691411', items: [] } } },
      'POST /api/admin/v1/orders/BN-100001/credit-memos': { status: 422, body: { message: 'Invalid.', errors: { refund: ['PayPal refused the refund: The capture has already been fully refunded.'] } } },
    })
    expect(await (await admin('orders/BN-100001/refundable')).json()).toMatchObject({ maxTotal: 50, giftCardRefundable: 20 })
    expect(await (await admin('credit-memos/CM-100001')).json()).toMatchObject({ total: 30, giftCardRefund: 20, otherRefund: 10, refundReference: '1JU08902781691411' })
    const refused = await admin('orders/BN-100001/credit-memos', { method: 'POST', body: { items: [], shippingRefund: 0, adjustment: 30, restock: false, notifyCustomer: false } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ refund: ['PayPal refused the refund: The capture has already been fully refunded.'] })
  })
})

describe('products and settings', () => {
  it('maps gift card products and weight both ways', async () => {
    const PRODUCT = { id: 3, name: 'Gift card', status: 'active', price: '0.00', stock_quantity: 0, weight: null, type: 'gift_card', gift_card: { amounts: ['25.00', '50.00'], custom: { min: '10.00', max: '500.00' } } }
    const calls = fakeLaravel({
      'GET /api/admin/v1/products/3': { body: { data: PRODUCT } },
      'PATCH /api/admin/v1/products/3': (entry) => ({ body: { data: { ...PRODUCT, ...sent(entry), gift_card: { amounts: ['25.00'], custom: null } } } }),
    })
    expect(await (await admin('products/3')).json()).toMatchObject({ type: 'gift_card', weight: null, giftCardAmounts: [25, 50], giftCardMinAmount: 10, giftCardMaxAmount: 500 })
    const saved = await (await admin('products/3', { method: 'PUT', body: { type: 'gift_card', weight: 120, giftCardAmounts: [25], giftCardMinAmount: null, giftCardMaxAmount: null } })).json()
    expect(sent(toApi(calls).at(-1))).toEqual({ type: 'gift_card', weight: 120, gift_card_amounts: [25], gift_card_min_amount: null, gift_card_max_amount: null })
    expect(saved.product).toMatchObject({ giftCardAmounts: [25], giftCardMinAmount: null, weight: 120 })
    const bad = await admin('products/3', { method: 'PUT', body: { type: 'voucher', weight: -1, giftCardAmounts: [0] } })
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(['giftCardAmounts', 'type', 'weight'])
  })

  it('reads and saves the documents and analytics groups and the default weight', async () => {
    const SETTINGS = { shipping: { default_weight_grams: 500 }, documents: { paper_size: 'a4', attach_pdf_to_emails: true }, analytics: { ga4_measurement_id: null } }
    const calls = fakeLaravel({ 'GET /api/admin/v1/settings': { body: { data: SETTINGS } }, 'PATCH /api/admin/v1/settings': { body: { data: SETTINGS } } })
    expect(await (await admin('settings')).json()).toMatchObject({ shipping: { defaultWeightGrams: 500 }, documents: { paperSize: 'a4', attachPdfToEmails: true }, analytics: { ga4MeasurementId: null } })
    await admin('settings', { method: 'PATCH', body: { documents: { paperSize: 'letter', attachPdfToEmails: false }, analytics: { ga4MeasurementId: '' }, shipping: { defaultWeightGrams: 750 } } })
    expect(sent(toApi(calls).at(-1))).toEqual({ documents: { paper_size: 'letter', attach_pdf_to_emails: false }, analytics: { ga4_measurement_id: null }, shipping: { default_weight_grams: 750 } })
    const bad = await admin('settings', { method: 'PATCH', body: { documents: { paperSize: 'a5' }, analytics: { ga4MeasurementId: 'UA-1234' }, shipping: { defaultWeightGrams: 100_001 } } })
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(['analytics.ga4MeasurementId', 'documents.paperSize', 'shipping.defaultWeightGrams'])
  })
})
