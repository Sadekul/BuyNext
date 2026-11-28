import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { formatMoney, formatMoneyCompact, formatTotals, getStoreCurrency, setStoreCurrency, storeCode, totalsByCurrency } from '../utils/format'
import { paidThroughProvider, sslCommerzMethod } from '../utils/orders'
import { paymentProviderNote } from '../utils/payments'
import { currencyErrors, rateExample } from '../utils/currencies'
import { storeInfo } from '../api/phase12'

/*
 * Phase 12 (docs/backend/PHASE12_CONTRACT.md): the store currency (taka) in
 * every money display, each order in its own currency, SSLCommerz (bKash,
 * Nagad, cards) on the order page with Check payment, refunds and payment
 * links through SSLCommerz, Settings → store currency and payment provider
 * status, and the sales report's other currencies. BuyNest's backend.
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

afterEach(() => {
  setStoreCurrency(null) // back to USD for the next test
})

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
  return call && (typeof call[1].body === 'string' ? JSON.parse(call[1].body) : call[1].body)
}
const called = (fetchMock, method, path) => fetchMock.mock.calls.some(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
const withRole = (permissions) => ({ ...ADMIN, role: { id: 9, name: 'Custom' }, permissions })

const BDT_STORE = { body: { data: { currency: { code: 'BDT', symbol: '৳', decimals: 2 }, currencies: { base: 'BDT', display: [] }, card_payments: 'stripe', paypal_payments: 'unavailable', sslcommerz_payments: 'sslcommerz' } } }

describe('helpers', () => {
  it('formats money in the store currency, or in the one given', () => {
    expect(formatMoney(1250)).toBe('$1,250.00')
    expect(storeCode()).toBe('USD')
    setStoreCurrency({ code: 'BDT', symbol: '৳', decimals: 2 })
    expect(getStoreCurrency()).toEqual({ code: 'BDT', symbol: '৳', decimals: 2 })
    expect(formatMoney(1250)).toBe('৳1,250.00')
    expect(formatMoney(-5)).toBe('-৳5.00')
    expect(formatMoney(12.5, 'USD')).toBe('$12.50')
    expect(formatMoneyCompact(4_200_000)).toBe('৳4.2M')
    expect(formatMoney(3, 'not a code')).toBe('৳3.00')
    // Anything that isn't a currency puts USD back.
    setStoreCurrency({ code: 'bdt' })
    expect(formatMoney(1)).toBe('$1.00')
  })

  it('never adds amounts in different currencies together', () => {
    setStoreCurrency({ code: 'BDT', symbol: '৳', decimals: 2 })
    const rows = [{ total: 1000, currency: 'BDT' }, { total: 20.5, currency: 'USD' }, { total: 250.25 }, { total: 4.5, currency: 'USD' }]
    expect(totalsByCurrency(rows)).toEqual([
      { currency: 'BDT', total: 1250.25 },
      { currency: 'USD', total: 25 },
    ])
    expect(formatTotals(totalsByCurrency(rows))).toBe('৳1,250.25 + $25.00')
    expect(formatTotals([])).toBe('৳0.00')
  })

  it("names what the customer paid with from SSLCommerz's card type", () => {
    expect(sslCommerzMethod('BKASH-BKash')).toBe('bKash')
    expect(sslCommerzMethod('NAGAD-Nagad')).toBe('Nagad')
    expect(sslCommerzMethod('DBBLMOBILEB-Dbbl Mobile Banking')).toBe('Rocket')
    expect(sslCommerzMethod('VISA-Dutch Bangla')).toBe('Visa card (Dutch Bangla)')
    expect(sslCommerzMethod('MASTER-City Bank')).toBe('Mastercard (City Bank)')
    expect(sslCommerzMethod('CITYTOUCHIB-City Bank')).toBe('Internet banking (City Bank)')
    expect(sslCommerzMethod('', 'VISA')).toBe('Visa card')
    expect(sslCommerzMethod(null)).toBe('SSLCommerz')
    expect(paidThroughProvider({ payment: { provider: 'sslcommerz', bankTranId: '231119ABC', paidAt: '2026-11-19T10:00:00Z' } })).toBe('sslcommerz')
    expect(paidThroughProvider({ payment: { provider: 'sslcommerz', paidAt: null } })).toBeNull()
  })

  it('describes each payment provider for Settings, and reads the store info', () => {
    const providers = {
      stripe: { status: 'test', message: 'Test mode' },
      paypal: { status: 'unavailable', message: 'Not available in BDT' },
      sslcommerz: { status: 'not_configured', message: 'Not configured: set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD' },
    }
    expect(paymentProviderNote('paypal', providers)).toEqual({ tone: 'neutral', label: 'Not available in BDT', text: "Shoppers don't see it, even when it is ticked here." })
    expect(paymentProviderNote('sslcommerz', providers)).toMatchObject({ tone: 'warning', label: 'Not configured: set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD' })
    expect(paymentProviderNote('card', { stripe: { status: 'live', message: null } })).toEqual({ tone: 'success', label: 'Live', text: '' })
    expect(paymentProviderNote('cod', providers)).toBeNull()
    expect(paymentProviderNote('card', undefined)).toBeNull()
    expect(storeInfo(BDT_STORE.body.data)).toEqual({ currency: { code: 'BDT', symbol: '৳', decimals: 2 }, cardPayments: 'stripe', paypalPayments: 'unavailable', sslcommerzPayments: 'sslcommerz', timezone: null })
    // Before phase 12: the display currencies' base, else nothing (USD stays).
    expect(storeInfo({ currencies: { base: 'USD' } }).currency).toEqual({ code: 'USD', symbol: 'USD', decimals: 2 })
    expect(storeInfo(null)).toEqual({ currency: null, cardPayments: null, paypalPayments: null, sslcommerzPayments: null, timezone: null })
  })

  it('checks display currencies against the store currency', () => {
    const values = { code: 'bdt', symbol: '৳', rate: '1', decimals: '2', enabled: false }
    expect(currencyErrors(values, { isNew: true, base: 'BDT' })).toEqual({ code: ['BDT is the store currency: prices are already shown in it.'] })
    expect(currencyErrors({ ...values, code: 'usd', symbol: '$', rate: 'x' }, { isNew: true, base: 'BDT' })).toEqual({ rate: ['Enter how many units make 1 BDT (0 to 1,000,000,000, at most 8 decimals).'] })
    expect(rateExample({ symbol: '$', rate: 0.0091, decimals: 2 }, 'BDT')).toBe('1 BDT = $ 0.0091')
  })
})

const ADDRESS = { firstName: 'Nadia', lastName: 'Rahman', line1: 'House 12, Road 5', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1209', country: 'Bangladesh', phone: '+8801711000000' }
const SSL = { tranId: 'BN-100001-2', valId: '2311191051061SgN6TUYrMZUjo1', bankTranId: '231119105106oBbRF4kc63bGOtN', cardType: 'BKASH-BKash', cardBrand: 'MOBILEBANKING', cardIssuer: 'BKash Mobile Banking', riskLevel: 0, riskTitle: 'Safe', attempts: 2, mode: 'sandbox', canCheck: false }
const ORDER = {
  id: 'BN-100001', number: 'BN-100001', currency: 'BDT', status: 'processing', paymentStatus: 'paid', paymentMethod: 'sslcommerz',
  shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' }, email: 'nadia@example.com', phone: '+8801711000000',
  shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null,
  customer: { id: null, guest: true, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com' },
  lines: [{ id: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 1250, quantity: 2, discountedTotal: 2500 }],
  totals: { itemCount: 2, subtotal: 2500, discount: 0, shipping: 60, tax: 0, total: 2560, paid: 2560, refunded: 0 }, items: 2, placedAt: '2026-11-19T10:00:00Z',
  invoices: [{ number: 'INV-100001', amount: 2560, currency: 'BDT', createdAt: '2026-11-19T10:51:00Z', adminName: null, note: 'Paid with bKash through SSLCommerz.' }],
  creditMemos: [],
  history: [{ status: 'processing', paymentStatus: 'paid', note: 'Paid with bKash through SSLCommerz.', adminName: null, customerNotified: true, createdAt: '2026-11-19T10:51:00Z' }],
  payment: { provider: 'sslcommerz', reference: SSL.bankTranId, dashboardUrl: null, mode: 'sandbox', paidAt: '2026-11-19T10:51:00Z', url: null, expiresAt: null, canPay: false, methodLabel: 'bKash', sslcommerz: SSL },
  giftCardPayment: null,
  giftCardsIssued: [],
  live: true,
}
const UNPAID = {
  ...ORDER, status: 'pending_payment', paymentStatus: 'unpaid', invoices: [], history: [],
  totals: { ...ORDER.totals, paid: 0 },
  payment: { ...ORDER.payment, reference: null, paidAt: null, methodLabel: null, canPay: true, url: 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde1', expiresAt: '2026-11-20T10:00:00Z', sslcommerz: { ...SSL, valId: null, bankTranId: null, cardType: null, riskLevel: null, riskTitle: null, canCheck: true } },
}

describe('the order page', () => {
  it('shows a taka order in taka, paid with bKash through SSLCommerz with its ids, risk check, and attempts', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/catalog/store': BDT_STORE, 'GET /api/admin/orders/BN-100001': { body: ORDER } })
    renderApp('/orders/BN-100001')
    expect(await screen.findByRole('rowheader', { name: 'Total' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Total' }).closest('tr')).toHaveTextContent('৳2,560.00')
    expect(screen.getByRole('link', { name: 'INV-100001' }).closest('li')).toHaveTextContent('৳2,560.00')

    const panel = within(screen.getByRole('heading', { name: 'Delivery and payment' }).closest('section'))
    expect(panel.getByText('Payment').nextElementSibling).toHaveTextContent('bKash, Nagad, cards (SSLCommerz)')
    expect(panel.getByText('Paid through').nextElementSibling).toHaveTextContent('SSLCommerz Sandbox')
    expect(panel.getByText('Paid with').nextElementSibling).toHaveTextContent('bKash (SSLCommerz)')
    expect(panel.getByText('Bank transaction ID').nextElementSibling).toHaveTextContent(SSL.bankTranId)
    expect(panel.getByText('Validation ID').nextElementSibling).toHaveTextContent(SSL.valId)
    expect(panel.getByText('Transaction ID').nextElementSibling).toHaveTextContent('BN-100001-2')
    expect(panel.getByText('Risk check').nextElementSibling).toHaveTextContent('Low Safe')
    expect(panel.getByText('Payment attempts').nextElementSibling).toHaveTextContent('2')
    // A taka order in a taka store: no currency note; a paid order: no Check payment.
    expect(panel.queryByText('Currency')).not.toBeInTheDocument()
    expect(panel.queryByRole('button', { name: 'Check payment' })).not.toBeInTheDocument()
    expect(screen.getByText('Paid with bKash through SSLCommerz.', { selector: '.history p' }).closest('li')).toHaveTextContent('by SSLCommerz')
  })

  it("shows an old dollar order in dollars after the store switched to taka", async () => {
    withSession()
    const old = { ...ORDER, currency: 'USD', paymentMethod: 'card', totals: { ...ORDER.totals, total: 42.5 }, payment: { provider: null, canPay: false }, invoices: [{ ...ORDER.invoices[0], amount: 42.5 }], history: [] }
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/catalog/store': BDT_STORE, 'GET /api/admin/orders/BN-100001': { body: old } })
    renderApp('/orders/BN-100001')
    const panel = within((await screen.findByRole('heading', { name: 'Delivery and payment' })).closest('section'))
    await waitFor(() => expect(panel.getByText('Currency').nextElementSibling).toHaveTextContent('USD · the store charges in BDT now'))
    expect(screen.getByRole('rowheader', { name: 'Total' }).closest('tr')).toHaveTextContent('$42.50')
    expect(screen.getByRole('link', { name: 'INV-100001' }).closest('li')).toHaveTextContent('$42.50')
  })

  it('an unpaid SSLCommerz order offers a new payment link and Check payment, which records the payment', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': BDT_STORE,
      'GET /api/admin/orders/BN-100001': { body: UNPAID },
      'POST /api/admin/orders/BN-100001/payment-link': {
        body: { payment: { provider: 'sslcommerz', url: 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde3', expiresAt: '2026-11-20T11:00:00Z' }, order: { ...UNPAID, payment: { ...UNPAID.payment, url: 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde3', sslcommerz: { ...UNPAID.payment.sslcommerz, attempts: 3 } } } },
      },
      'POST /api/admin/orders/BN-100001/payment/check': { body: { order: ORDER, result: { found: true, status: 'paid', message: 'SSLCommerz confirmed the payment (bKash). Invoice INV-100001 was created.' } } },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    expect(await screen.findByLabelText('Payment link for order BN-100001')).toHaveValue(UNPAID.payment.url)
    expect(screen.getByText(/the order is marked paid when SSLCommerz confirms the payment/)).toBeInTheDocument()
    expect(screen.getByText(/pays with bKash, Nagad, or a card on SSLCommerz's page/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Get a new link' }))
    await waitFor(() => expect(screen.getByLabelText('Payment link for order BN-100001')).toHaveValue('https://sandbox.sslcommerz.com/EasyCheckOut/testcde3'))

    await user.click(screen.getByRole('button', { name: 'Check payment' }))
    expect(called(fetchMock, 'POST', '/api/admin/orders/BN-100001/payment/check')).toBe(true)
    // The answer is announced and stays; the order reloads as paid (no more button or link).
    expect(await screen.findByText('SSLCommerz confirmed the payment (bKash). Invoice INV-100001 was created.')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Bank transaction ID').nextElementSibling).toHaveTextContent(SSL.bankTranId)
    expect(screen.queryByRole('button', { name: 'Check payment' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Payment link for order BN-100001')).not.toBeInTheDocument()
  })

  it("Check payment says when SSLCommerz has nothing, and needs orders.edit", async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': BDT_STORE,
      'GET /api/admin/orders/BN-100001': { body: UNPAID },
      'POST /api/admin/orders/BN-100001/payment/check': { body: { order: UNPAID, result: { found: false, status: 'not_found', message: 'SSLCommerz has no completed payment for BN-100001-2.' } } },
    })
    const user = userEvent.setup()
    const view = renderApp('/orders/BN-100001')
    await user.click(await screen.findByRole('button', { name: 'Check payment' }))
    expect(await screen.findByText('SSLCommerz has no completed payment for BN-100001-2.')).toHaveAttribute('role', 'status')
    view.unmount()

    mockFetch({ 'GET /api/admin/me': { body: withRole(['orders.view']) }, 'GET /api/catalog/store': BDT_STORE, 'GET /api/admin/orders/BN-100001': { body: UNPAID } })
    renderApp('/orders/BN-100001')
    expect(await screen.findByText('Transaction ID')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check payment' })).not.toBeInTheDocument()
  })

  it('a risky payment waits on hold, with what staff can do', async () => {
    withSession()
    const held = { ...UNPAID, paymentStatus: 'review', payment: { ...UNPAID.payment, canPay: false, url: null, methodLabel: 'Visa card', sslcommerz: { ...SSL, riskLevel: 1, riskTitle: 'Risky card', canCheck: false } } }
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/catalog/store': BDT_STORE, 'GET /api/admin/orders/BN-100001': { body: held } })
    renderApp('/orders/BN-100001')
    expect(await screen.findByText(/flagged it as risky, so the order is on hold/)).toBeInTheDocument()
    expect(screen.getAllByText('On hold (risk check)').length).toBeGreaterThan(0)
    expect(screen.getByText('Risk check').nextElementSibling).toHaveTextContent('High: on hold Risky card')
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument()
  })

  it("refunds through SSLCommerz in the order's currency, and shows SSLCommerz's refusal", async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': BDT_STORE,
      'GET /api/admin/orders/BN-100001': { body: ORDER },
      'GET /api/admin/orders/BN-100001/refundable': { body: { items: [{ orderItemId: 11, name: 'Mascara', variantLabel: null, sku: 'BEA-1', ordered: 2, refunded: 0, refundable: 2, unitRefund: 1250 }], shippingRefundable: 60, maxTotal: 2560 } },
      'POST /api/admin/orders/BN-100001/credit-memos': { status: 422, body: { message: 'Invalid.', errors: { refund: ['SSLCommerz refused the refund: Bank transaction not found.'] } } },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    await user.click(await screen.findByRole('button', { name: 'Refund' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Refund order BN-100001' }))
    expect(screen.getByRole('dialog', { name: 'Refund order BN-100001' })).toHaveAccessibleDescription(/goes back through SSLCommerz to the customer's bKash, Nagad, or card/)
    expect(dialog.getByLabelText('Shipping refund (BDT)')).toBeInTheDocument()
    expect(dialog.getByLabelText('Adjustment (BDT)')).toBeInTheDocument()
    await user.type(dialog.getByLabelText('Quantity of Mascara to refund (up to 2)'), '1')
    expect(dialog.getByText('Estimated total to refund').closest('p')).toHaveTextContent('৳1,250.00 of ৳2,560.00 left')
    await user.click(dialog.getByRole('button', { name: 'Refund ৳1,250.00' }))
    expect(await dialog.findByText('SSLCommerz refused the refund: Bank transaction not found.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/credit-memos')).toMatchObject({ items: [{ orderItemId: 11, quantity: 1 }] })
  })
})

describe('grids in the store currency, rows in their own', () => {
  it('shows each order of the grid in its own currency', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': BDT_STORE,
      'GET /api/admin/orders': {
        body: {
          orders: [
            { id: 'BN-100002', number: 'BN-100002', customer: 'Nadia Rahman', email: 'nadia@example.com', guest: false, items: 2, total: 2560, currency: 'BDT', status: 'processing', paymentStatus: 'paid', placedAt: '2026-11-19T10:00:00Z', source: 'storefront' },
            { id: 'BN-100001', number: 'BN-100001', customer: 'Ava Guest', email: 'ava@example.com', guest: true, items: 1, total: 42.5, currency: 'USD', status: 'delivered', paymentStatus: 'paid', placedAt: '2026-11-01T10:00:00Z', source: 'storefront' },
          ],
          total: 2,
          live: true,
        },
      },
    })
    renderApp('/orders')
    const taka = (await screen.findByRole('link', { name: 'BN-100002' })).closest('tr')
    await waitFor(() => expect(taka).toHaveTextContent('৳2,560.00'))
    expect(screen.getByRole('link', { name: 'BN-100001' }).closest('tr')).toHaveTextContent('$42.50')
  })

  it("labels amounts typed in with the store currency's code", async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': BDT_STORE,
      'GET /api/admin/settings': { body: { checkout: { allowedCountries: ['Bangladesh'] } } },
      'GET /api/admin/shipping-rates': { body: { rates: [], defaultWeightGrams: 500, methods: [{ id: 'standard', label: 'Standard', flatPrice: 60, rows: 0 }] } },
    })
    const user = userEvent.setup()
    renderApp('/settings/shipping-rates')
    expect(await screen.findByText(/Standard keeps its flat price of ৳60\.00/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a standard rate' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Add a standard rate' }))
    expect(dialog.getByLabelText('Price (BDT)')).toBeInTheDocument()
    expect(dialog.getByLabelText('Order value from (BDT)')).toBeInTheDocument()
  })
})

describe('Settings', () => {
  const SETTINGS = {
    general: { storeName: 'BuyNest' }, shipping: { enabledMethods: ['standard'] }, tax: {}, inventory: { lowStockThreshold: 10 },
    checkout: { allowedCountries: ['Bangladesh'], guestCheckout: true, enabledPaymentMethods: ['card', 'paypal', 'cod'] },
    store: {
      currency: { code: 'BDT', symbol: '৳', decimals: 2 },
      currencyDocs: 'docs/CURRENCY.md',
      paymentProviders: {
        stripe: { status: 'test', message: 'Test mode' },
        paypal: { status: 'unavailable', message: 'Not available in BDT' },
        sslcommerz: { status: 'sandbox', message: 'Sandbox' },
      },
    },
    live: true,
  }

  it('shows the store currency read-only and where to change it', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/catalog/store': BDT_STORE, 'GET /api/admin/settings': { body: SETTINGS }, 'GET /api/admin/currencies': { body: { base: 'BDT', currencies: [] } } })
    renderApp('/settings')
    const panel = within((await screen.findByRole('heading', { name: 'Store currency' })).closest('section'))
    expect(panel.getByText('Currency').nextElementSibling).toHaveTextContent('BDT (৳) · for example ৳1,250.00')
    expect(panel.getByText('docs/CURRENCY.md')).toBeInTheDocument()
    expect(panel.queryByRole('textbox')).not.toBeInTheDocument()
    expect(panel.queryByRole('combobox')).not.toBeInTheDocument()
    // Shipping prices are typed in taka.
    expect(await screen.findByText('Prices in BDT.')).toBeInTheDocument()
  })

  it("turns SSLCommerz on, with each provider's status read with its checkbox", async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': BDT_STORE,
      'GET /api/admin/settings': { body: SETTINGS },
      'PATCH /api/admin/settings': { body: { ...SETTINGS, checkout: { ...SETTINGS.checkout, enabledPaymentMethods: ['card', 'paypal', 'sslcommerz', 'cod'] } } },
      'GET /api/admin/currencies': { body: { base: 'BDT', currencies: [] } },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const form = within((await screen.findByRole('heading', { name: 'Checkout' })).closest('form'))
    expect(form.getByRole('checkbox', { name: 'PayPal' })).toHaveAccessibleDescription(/Not available in BDT.*Shoppers don't see it/)
    expect(form.getByRole('checkbox', { name: 'Credit or debit card' })).toHaveAccessibleDescription(/Test mode/)
    const ssl = form.getByRole('checkbox', { name: 'bKash, Nagad, cards (SSLCommerz)' })
    expect(ssl).not.toBeChecked()
    expect(ssl).toHaveAccessibleDescription(/Sandbox.*Test payments only/)
    expect(form.getByRole('checkbox', { name: 'Cash on delivery' })).not.toHaveAccessibleDescription()
    await user.click(ssl)
    await user.click(form.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ checkout: { allowedCountries: ['Bangladesh'], guestCheckout: true, enabledPaymentMethods: ['card', 'paypal', 'sslcommerz', 'cod'] } }))
    expect(await form.findByText('Checkout saved.')).toBeInTheDocument()
  })
})

describe('reports', () => {
  it('counts the store currency in the totals and lists other currencies on their own', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': BDT_STORE,
      'GET /api/admin/reports/sales': {
        body: {
          currency: 'BDT',
          totals: { orders: 3, units: 5, gross: 12000, discounts: 0, shipping: 120, refunds: 0, net: 12000, averageOrder: 4000 },
          series: [{ period: '2026-11-19', orders: 3, gross: 12000, refunds: 0, net: 12000 }],
          otherCurrencies: [{ currency: 'USD', orders: 2, gross: 80, refunds: 20, net: 60 }],
        },
      },
    })
    renderApp('/reports?from=2026-11-19&to=2026-11-19&groupBy=day')
    expect((await screen.findByText('Net revenue')).nextElementSibling).toHaveTextContent('৳12K')
    expect(screen.getByText(/3 orders · after discounts and refunds · BDT orders only/)).toBeInTheDocument()
    const table = within(screen.getByRole('region', { name: 'Amounts by currency' }))
    expect(table.getByRole('row', { name: 'USD 2 $80.00 $20.00 $60.00' })).toBeInTheDocument()
    expect(screen.getByText(/never added together/)).toBeInTheDocument()
  })
})
