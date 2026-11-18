import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { csvRowProblems, describeRange, rateErrors, rateFormValues, toRateValues } from '../utils/shippingRates'
import { adjustmentErrors, giftCardErrors } from '../utils/giftCards'
import { giftCardSplit } from '../utils/orders'

/*
 * Phase 10 (docs/backend/PHASE10_CONTRACT.md): PDF downloads, PayPal on the
 * order page, shipping table rates, gift cards, and the documents and
 * analytics settings. BuyNest's backend.
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
  return call && (typeof call[1].body === 'string' ? JSON.parse(call[1].body) : call[1].body)
}
const nav = () => within(screen.getByRole('navigation', { name: 'Admin' }))
const withRole = (permissions) => ({ ...ADMIN, role: { id: 9, name: 'Custom' }, permissions })

const ADDRESS = { firstName: 'Ava', lastName: 'Guest', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' }
const NO_PAYMENT = { provider: null, reference: null, dashboardUrl: null, mode: null, paidAt: null, url: null, expiresAt: null, canPay: false }
const CAPTURE = '8MC585209K746392H'
const ORDER = {
  id: 'BN-100001', number: 'BN-100001', status: 'processing', paymentStatus: 'paid', paymentMethod: 'paypal',
  shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' }, email: 'ava@example.com', phone: null,
  shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null,
  customer: { id: null, guest: true, firstName: 'Ava', lastName: 'Guest', email: 'ava@example.com' },
  lines: [
    { id: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 10, quantity: 1, discountedTotal: 10 },
    { id: 3, sku: 'GIFT', title: 'BuyNest gift card', thumbnail: 'g.webp', price: 50, quantity: 1, discountedTotal: 50, giftCard: { amount: 50, recipientName: 'Ana', recipientEmail: 'ana@example.com', message: 'Happy birthday' } },
  ],
  totals: { itemCount: 2, subtotal: 60, discount: 0, shipping: 0, tax: 0, total: 60, paid: 60, refunded: 0 }, items: 2, placedAt: '2026-11-16T10:00:00Z',
  invoices: [{ number: 'INV-100001', amount: 60, createdAt: '2026-11-16T10:05:00Z', adminName: null, note: 'Paid through PayPal.' }],
  creditMemos: [{ number: 'CM-100001', total: 5, createdAt: '2026-11-16T11:00:00Z' }],
  history: [{ status: 'processing', paymentStatus: 'paid', note: 'Paid through PayPal.', adminName: null, customerNotified: true, createdAt: '2026-11-16T10:05:00Z' }],
  payment: { ...NO_PAYMENT, provider: 'paypal', reference: CAPTURE, dashboardUrl: `https://www.sandbox.paypal.com/activity/payment/${CAPTURE}`, mode: 'sandbox', paidAt: '2026-11-16T10:05:00Z' },
  giftCardPayment: { last4: 'ZZ99', amount: 20 },
  giftCardsIssued: [{ id: 8, last4: 'AB12', amount: 50, recipientEmail: 'ana@example.com', status: 'active' }],
  live: true,
}
const LIMITS = { items: [{ orderItemId: 11, name: 'Mascara', variantLabel: null, sku: 'BEA-1', ordered: 1, refunded: 0, refundable: 1, unitRefund: 10 }], shippingRefundable: 0, maxTotal: 55, giftCardRefundable: 20 }

describe('helpers', () => {
  it('checks table rate rows and describes ranges as the server applies them', () => {
    const values = rateFormValues({ method: 'express' })
    expect(values).toEqual({ method: 'express', country: '*', minWeightGrams: '0', maxWeightGrams: '', minSubtotal: '0', maxSubtotal: '', price: '' })
    expect(Object.keys(rateErrors(values))).toEqual(['price'])
    expect(rateErrors({ ...values, price: '4.5', minWeightGrams: '900', maxWeightGrams: '100' })).toEqual({ maxWeightGrams: ['The maximum weight must be more than the minimum.'] })
    expect(toRateValues({ ...values, country: ' Germany ', price: '4.5', maxSubtotal: '100' })).toEqual({ method: 'express', country: 'Germany', minWeightGrams: 0, maxWeightGrams: null, minSubtotal: 0, maxSubtotal: 100, price: 4.5 })
    expect(describeRange(0, null, String)).toBe('Any')
    expect(describeRange(0, 1000, String)).toBe('Under 1000')
    expect(describeRange(500, 1000, String)).toBe('500 to under 1000')
    expect(csvRowProblems({ 'rows.3.minWeightGrams': ['Bad.'], 'rows.2': ['Short row.'], file: ['x'] })).toEqual([
      { key: 'rows.2', row: 2, column: null, message: 'Short row.' },
      { key: 'rows.3.minWeightGrams', row: 3, column: 'min_weight_grams', message: 'Bad.' },
    ])
  })

  it('checks gift card forms, and splits a refund between the gift card and the other method', () => {
    expect(Object.keys(giftCardErrors({ amount: '0.5', recipientName: '', recipientEmail: '', message: '', expiresAt: '' }, { sendEmail: true })).sort()).toEqual(['amount', 'recipientEmail'])
    expect(giftCardErrors({ amount: '25', recipientName: '', recipientEmail: '', message: '', expiresAt: '' }, { sendEmail: false })).toEqual({})
    expect(adjustmentErrors({ amount: '-40', note: 'Refund' }, 30)).toEqual({ amount: ['The card has $30.00: you can take away at most that.'] })
    expect(adjustmentErrors({ amount: '5', note: ' ' }, 30)).toEqual({ note: ['Say why the balance changes (kept in the history).'] })
    expect(giftCardSplit(ORDER, 3000, LIMITS)).toEqual({ last4: 'ZZ99', toCardCents: 2000, otherCents: 1000 })
    expect(giftCardSplit(ORDER, 500, { ...LIMITS, giftCardRefundable: 0 })).toEqual({ last4: 'ZZ99', toCardCents: 0, otherCents: 500 })
    expect(giftCardSplit({ ...ORDER, giftCardPayment: null }, 500, LIMITS)).toBeNull()
  })
})

describe('navigation', () => {
  it('shows Gift cards with gift_cards.view and the table rates with settings.edit only', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: withRole(['gift_cards.view', 'settings.view']) }, 'GET /api/admin/gift-cards': { body: { giftCards: [], total: 0 } } })
    renderApp('/gift-cards')
    expect(await screen.findByRole('heading', { name: 'Gift cards' })).toBeInTheDocument()
    expect(nav().getByRole('link', { name: 'Gift cards' })).toBeInTheDocument()
    expect(nav().queryByRole('link', { name: 'Shipping table rates' })).not.toBeInTheDocument()
    // gift_cards.manage is needed to create one.
    expect(screen.queryByRole('button', { name: 'Create gift card' })).not.toBeInTheDocument()
  })
})

describe('the order page', () => {
  it('links the PDFs, shows PayPal with the capture id on its sandbox dashboard, and gift card lines and payment', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/orders/BN-100001': { body: ORDER } })
    renderApp('/orders/BN-100001')
    const pdf = await screen.findByRole('link', { name: 'Download PDF of invoice INV-100001' })
    expect(pdf).toHaveAttribute('href', '/api/admin/invoices/INV-100001/pdf')
    expect(pdf).toHaveAttribute('download')
    expect(screen.getByRole('link', { name: 'PDF of credit memo CM-100001' })).toHaveAttribute('href', '/api/admin/credit-memos/CM-100001/pdf')

    const panel = screen.getByRole('heading', { name: 'Delivery and payment' }).closest('section')
    expect(within(panel).getByText('Paid through').nextElementSibling).toHaveTextContent('PayPal Sandbox')
    expect(within(panel).getByText('Capture ID')).toBeInTheDocument()
    const capture = within(panel).getByRole('link', { name: new RegExp(CAPTURE) })
    expect(capture).toHaveAttribute('href', `https://www.sandbox.paypal.com/activity/payment/${CAPTURE}`)
    expect(capture).toHaveAccessibleName(/opens the payment in PayPal's sandbox dashboard, in a new tab/)
    expect(screen.getByRole('link', { name: 'INV-100001' }).closest('li')).toHaveTextContent('by PayPal')
    expect(screen.getByText('Paid through PayPal.', { selector: '.history p' }).closest('li')).toHaveTextContent('by PayPal')

    // The gift card bought for Ana, and the card that paid part of the order.
    expect(screen.getByText(/For Ana/)).toHaveTextContent('For Ana <ana@example.com>')
    expect(screen.getByText('“Happy birthday”')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ending AB12' })).toHaveAttribute('href', '/gift-cards/8')
    expect(screen.getByRole('rowheader', { name: 'Paid by gift card (ending ZZ99)' }).closest('tr')).toHaveTextContent('−$20.00')
    expect(screen.getByRole('rowheader', { name: 'Paid by PayPal' }).closest('tr')).toHaveTextContent('$40.00')
  })

  it('an unpaid PayPal order offers its approval link with PayPal wording', async () => {
    withSession()
    const unpaid = {
      ...ORDER, status: 'pending_payment', paymentStatus: 'unpaid', invoices: [], creditMemos: [], giftCardPayment: null, giftCardsIssued: [],
      payment: { ...NO_PAYMENT, provider: 'paypal', canPay: true, url: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T', expiresAt: '2026-11-16T13:00:00Z' },
    }
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/orders/BN-100001': { body: unpaid } })
    renderApp('/orders/BN-100001')
    expect(await screen.findByLabelText('Payment link for order BN-100001')).toHaveValue(unpaid.payment.url)
    expect(screen.getByText(/the order is marked paid when PayPal confirms the payment/)).toBeInTheDocument()
    expect(screen.getByText(/The customer pays on PayPal's page/)).toBeInTheDocument()
  })

  it("the refund dialog says it goes back through PayPal, shows the gift card split, and PayPal's refusal", async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': { body: ORDER },
      'GET /api/admin/orders/BN-100001/refundable': { body: LIMITS },
      'POST /api/admin/orders/BN-100001/credit-memos': { status: 422, body: { message: 'Invalid.', errors: { refund: ['PayPal refused the refund: The capture has already been fully refunded.'] } } },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    await user.click(await screen.findByRole('button', { name: 'Refund' }))
    const dialog = await screen.findByRole('dialog', { name: 'Refund order BN-100001' })
    expect(dialog).toHaveAccessibleDescription(/goes back through PayPal.*if PayPal refuses it, nothing is saved.*Money goes back to the gift card first/)

    await user.type(within(dialog).getByLabelText(/Quantity of Mascara to refund/), '1')
    await user.type(within(dialog).getByLabelText('Adjustment (USD)'), '15')
    const split = within(dialog).getByText('How the refund is split').closest('div')
    expect(split).toHaveTextContent('Back to the gift card ending ZZ99$20.00')
    expect(split).toHaveTextContent('Through PayPal$5.00')

    await user.click(within(dialog).getByRole('button', { name: 'Refund $25.00' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('PayPal refused the refund: The capture has already been fully refunded.')
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/credit-memos')).toMatchObject({ items: [{ orderItemId: 11, quantity: 1 }], adjustment: 15 })
  })
})

describe('invoice and credit memo pages', () => {
  it('each has Download PDF', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/invoices/INV-100001': { body: { number: 'INV-100001', orderNumber: 'BN-100001', amount: 60, createdAt: '2026-11-16T10:05:00Z', adminName: null, items: [], totals: ORDER.totals } },
      'GET /api/admin/credit-memos/CM-100001': { body: { number: 'CM-100001', orderNumber: 'BN-100001', items: [], subtotal: 0, shippingRefund: 0, adjustment: 30, total: 30, giftCardRefund: 20, otherRefund: 10, restocked: false, createdAt: '2026-11-16T11:00:00Z' } },
    })
    const { unmount } = renderApp('/invoices/INV-100001')
    expect(await screen.findByRole('link', { name: 'Download PDF of invoice INV-100001' })).toHaveAttribute('href', '/api/admin/invoices/INV-100001/pdf')
    unmount()
    renderApp('/credit-memos/CM-100001')
    expect(await screen.findByRole('link', { name: 'Download PDF of credit memo CM-100001' })).toHaveAttribute('href', '/api/admin/credit-memos/CM-100001/pdf')
    expect(screen.getByRole('rowheader', { name: 'Returned to gift card' }).closest('tr')).toHaveTextContent('$20.00')
    expect(screen.getByRole('rowheader', { name: 'Refunded by the other payment method' }).closest('tr')).toHaveTextContent('$10.00')
  })
})

const RATES = {
  rates: [
    { id: 4, method: 'express', country: 'United States', minWeightGrams: 0, maxWeightGrams: 2000, minSubtotal: 0, maxSubtotal: null, price: 9.5, position: 0 },
    { id: 6, method: 'express', country: '*', minWeightGrams: 0, maxWeightGrams: null, minSubtotal: 0, maxSubtotal: null, price: 19, position: 1 },
  ],
  defaultWeightGrams: 500,
  methods: [{ id: 'standard', label: 'Standard', flatPrice: 4.99, rows: 0 }, { id: 'express', label: 'Express', flatPrice: 12.99, rows: 2 }],
  live: true,
}

describe('Settings → Shipping → Table rates', () => {
  it('lists rows per method, adds one, moves one with the keyboard, and deletes one', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/settings': { body: { checkout: { allowedCountries: ['United States', 'Germany'] } } },
      'GET /api/admin/shipping-rates': { body: RATES },
      'POST /api/admin/shipping-rates': { status: 201, body: { rate: { ...RATES.rates[0], id: 9, method: 'standard', country: 'Germany', price: 6 } } },
      'POST /api/admin/shipping-rates/reorder': { body: { rates: [{ ...RATES.rates[1], position: 0 }, { ...RATES.rates[0], position: 1 }] } },
      'DELETE /api/admin/shipping-rates/6': { body: { deleted: true } },
    })
    const user = userEvent.setup()
    renderApp('/settings/shipping-rates')
    expect(await screen.findByText(/Standard keeps its flat price of \$4\.99/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Shipping table rates' })).toBeInTheDocument()
    const express = screen.getByRole('table', { name: 'Express rates, in the order they are tried' })
    expect(within(express).getAllByRole('row')[1]).toHaveTextContent('United StatesUnder 2,000 gAny$9.50')
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/admin/shipping-rates/export.csv')

    await user.click(screen.getByRole('button', { name: 'Add a standard rate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a standard rate' })
    await user.click(within(dialog).getByRole('button', { name: 'Add rate' }))
    expect(within(dialog).getByLabelText('Price (USD)')).toHaveAccessibleDescription(/Enter an amount\./)
    await user.clear(within(dialog).getByLabelText('Country'))
    await user.type(within(dialog).getByLabelText('Country'), 'Germany')
    await user.type(within(dialog).getByLabelText('Price (USD)'), '6')
    await user.click(within(dialog).getByRole('button', { name: 'Add rate' }))
    expect(await screen.findByText('Standard rate for Germany added at the end of the standard rates.')).toHaveFocus()
    expect(sentTo(fetchMock, 'POST', '/api/admin/shipping-rates')).toEqual({ method: 'standard', country: 'Germany', minWeightGrams: 0, maxWeightGrams: null, minSubtotal: 0, maxSubtotal: null, price: 6 })

    const down = screen.getByRole('button', { name: 'Move express rate 1 down' })
    down.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(sentTo(fetchMock, 'POST', '/api/admin/shipping-rates/reorder')).toEqual({ method: 'express', ids: [6, 4] }))
    expect(screen.getByText('Express rate moved to position 2 of 2.')).toBeInTheDocument()
    // At the end now: focus moves to its "up" button, which still works.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move express rate 2 up' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Delete express rate 1' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete Express rate for any country?' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Express rate for any country deleted.')).toBeInTheDocument()
  })

  it('checks a cart and lists the rows a refused CSV import had', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/settings': { body: {} },
      'GET /api/admin/shipping-rates': { body: RATES },
      'POST /api/admin/shipping-rates/check': {
        body: { methods: [{ method: 'standard', label: 'Standard', available: true, price: 4.99, source: 'flat', rateId: null }, { method: 'express', label: 'Express', available: false, price: null, source: 'table', rateId: null }], country: 'Germany', weightGrams: 2500, subtotal: 40 },
      },
      'POST /api/admin/shipping-rates/import': { status: 422, body: { message: 'Please check the highlighted fields.', errors: { 'rows.3.price': ['The price must be a number.'] } } },
    })
    const user = userEvent.setup()
    renderApp('/settings/shipping-rates')
    const check = (await screen.findByRole('heading', { name: 'Check a cart' })).closest('section')
    await user.type(within(check).getByLabelText('Country'), 'Germany')
    await user.type(within(check).getByLabelText('Cart weight (g)'), '2500')
    await user.type(within(check).getByLabelText('Order value (USD)'), '40')
    await user.click(within(check).getByRole('button', { name: 'Check prices' }))
    const answer = await within(check).findByRole('table', { name: /Shipping for Germany, 2,500 g, \$40\.00/ })
    expect(within(answer).getByRole('row', { name: /Standard/ })).toHaveTextContent('$4.99')
    expect(within(answer).getByRole('row', { name: /Express/ })).toHaveTextContent('Not offered')
    expect(sentTo(fetchMock, 'POST', '/api/admin/shipping-rates/check')).toEqual({ country: 'Germany', weightGrams: 2500, subtotal: 40 })

    const upload = screen.getByRole('heading', { name: 'Import from CSV' }).closest('section')
    await user.upload(within(upload).getByLabelText('CSV file'), new File(['method,country\n'], 'rates.csv', { type: 'text/csv' }))
    await user.click(within(upload).getByLabelText('Keep them and add the file\'s rows after them'))
    await user.click(within(upload).getByRole('button', { name: 'Import rates' }))
    expect(await within(upload).findByRole('alert')).toHaveTextContent('Nothing was imported: fix these rows and try again.Row 3 (price): The price must be a number.')
    expect(sentTo(fetchMock, 'POST', '/api/admin/shipping-rates/import').get('mode')).toBe('append')
  })
})

const CARD = {
  id: 7, last4: 'K7Q2', initialBalance: 50, balance: 30, currency: 'USD', status: 'active', expiresAt: null, recipientName: 'Ana', recipientEmail: 'ana@example.com',
  message: 'Sorry!', orderNumber: null, createdByAdmin: 'Store Owner', createdAt: '2026-11-17T10:00:00Z',
}

describe('Marketing → Gift cards', () => {
  it('lists cards and creates one, showing the code once', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/gift-cards': { body: { giftCards: [CARD], total: 1 } },
      'POST /api/admin/gift-cards': { status: 201, body: { giftCard: { ...CARD, id: 9, last4: 'M3X8', initialBalance: 25, balance: 25 }, code: 'ABCD-EFGH-JKMN-M3X8' } },
    })
    const user = userEvent.setup()
    renderApp('/gift-cards')
    const row = (await screen.findByRole('link', { name: 'Gift card ending K7Q2' })).closest('tr')
    expect(row).toHaveTextContent('$30.00of $50.00')
    expect(row).toHaveTextContent('Active')
    expect(row).toHaveTextContent('Anaana@example.com')
    expect(row).toHaveTextContent('Made by Store Owner')

    await user.click(screen.getByRole('button', { name: 'Create gift card' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create a gift card' })
    await user.type(within(dialog).getByLabelText('Amount (USD)'), '25')
    await user.click(within(dialog).getByRole('button', { name: 'Create gift card' }))
    expect(within(dialog).getByLabelText('Recipient email')).toHaveAccessibleDescription(/Enter the email to send the card to/)
    await user.type(within(dialog).getByLabelText('Recipient email'), 'bo@example.com')
    await user.type(within(dialog).getByLabelText('Message (optional)'), 'For the late parcel')
    await user.click(within(dialog).getByRole('button', { name: 'Create gift card' }))

    const created = await screen.findByText(/Gift card ending M3X8 created with \$25\.00/)
    expect(created.closest('.gift-card-created')).toHaveFocus()
    expect(screen.getByText('ABCD-EFGH-JKMN-M3X8')).toBeInTheDocument()
    expect(screen.getByText(/This is the only time the full code is shown/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/gift-cards')).toEqual({ amount: 25, recipientName: null, recipientEmail: 'bo@example.com', message: 'For the late parcel', expiresAt: null, sendEmail: true })
  })

  it('shows one card with its history, adjusts the balance with a reason, and disables it', async () => {
    withSession()
    let card = { ...CARD, transactions: [{ id: 1, amount: 50, balanceAfter: 50, note: 'Created by Store Owner', orderNumber: null, creditMemoNumber: null, adminName: 'Store Owner', createdAt: '2026-11-17T10:00:00Z' }, { id: 2, amount: -20, balanceAfter: 30, note: null, orderNumber: 'BN-100004', creditMemoNumber: null, adminName: null, createdAt: '2026-11-17T12:00:00Z' }] }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/gift-cards/7': () => ({ body: card }),
      'POST /api/admin/gift-cards/7/adjust': () => {
        card = { ...card, balance: 25 }
        return { body: { giftCard: card } }
      },
      'POST /api/admin/gift-cards/7/disable': () => {
        card = { ...card, status: 'disabled' }
        return { body: { giftCard: card } }
      },
    })
    const user = userEvent.setup()
    renderApp('/gift-cards/7')
    expect(await screen.findByRole('heading', { level: 1, name: 'Gift card ending K7Q2' })).toBeInTheDocument()
    const history = screen.getByRole('heading', { name: 'History' }).closest('section')
    expect(within(history).getAllByRole('row')[2]).toHaveTextContent('−$20.00$30.00Spent · Order BN-100004')

    await user.click(screen.getByRole('button', { name: 'Adjust balance' }))
    const dialog = await screen.findByRole('dialog', { name: 'Adjust Gift card ending K7Q2' })
    await user.type(within(dialog).getByLabelText('Amount (USD)'), '-5')
    expect(within(dialog).getByText('New balance: $25.00')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save adjustment' }))
    expect(within(dialog).getByLabelText('Reason')).toHaveAccessibleDescription(/Say why the balance changes/)
    await user.type(within(dialog).getByLabelText('Reason'), 'Goodwill correction')
    await user.click(within(dialog).getByRole('button', { name: 'Save adjustment' }))
    expect(await screen.findByText('Balance reduced by $5.00. Gift card ending K7Q2 now has $25.00.')).toHaveFocus()
    expect(sentTo(fetchMock, 'POST', '/api/admin/gift-cards/7/adjust')).toEqual({ amount: -5, note: 'Goodwill correction' })

    await user.click(screen.getByRole('button', { name: 'Disable' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Disable Gift card ending K7Q2?' })).getByRole('button', { name: 'Disable' }))
    expect(await screen.findByText(/is disabled\. It can no longer be used at checkout\./)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Adjust balance' })).not.toBeInTheDocument())
  })
})

describe('product form and settings', () => {
  it('a gift card product takes its amount choices and weight, sent as numbers', async () => {
    withSession()
    const PRODUCT = { id: 3, title: 'BuyNest gift card', brand: '', category: 'gifts', description: '', price: 0, discountPercentage: 0, stock: 0, status: 'active', metaTitle: '', metaDescription: '', type: 'simple', weight: null, imageList: [], options: [], variants: [], live: true }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [{ id: 1, name: 'Gifts', slug: 'gifts', parentId: null }] },
      'GET /api/admin/products/3': { body: PRODUCT },
      'PUT /api/admin/products/3': (url, init) => ({ body: { product: { ...PRODUCT, ...JSON.parse(init.body) }, live: true } }),
    })
    const user = userEvent.setup()
    renderApp('/products/3')
    await user.selectOptions(await screen.findByLabelText('Product type'), 'gift_card')
    const amounts = screen.getByLabelText('Amount choices (USD)')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(amounts).toHaveAccessibleDescription(/Give at least one amount, or a custom amount range\./)
    await user.type(amounts, '100, 25,50')
    await user.type(screen.getByLabelText('Weight (g, optional)'), '20')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PUT', '/api/admin/products/3')).toMatchObject({ type: 'gift_card', weight: 20, giftCardAmounts: [25, 50, 100], giftCardMinAmount: null, giftCardMaxAmount: null }))
  })

  it('saves Documents and Analytics, and checks the GA4 measurement ID', async () => {
    withSession()
    const SETTINGS = {
      general: { storeName: 'BuyNest' }, shipping: { enabledMethods: ['standard'], defaultWeightGrams: 500 }, tax: {}, checkout: {}, inventory: { lowStockThreshold: 10 },
      documents: { paperSize: 'a4', attachPdfToEmails: true }, analytics: { ga4MeasurementId: null }, live: true,
    }
    const fetchMock = mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/settings': { body: SETTINGS }, 'PATCH /api/admin/settings': { body: SETTINGS } })
    const user = userEvent.setup()
    renderApp('/settings')
    const documents = (await screen.findByRole('heading', { name: 'Documents' })).closest('form')
    await user.click(within(documents).getByLabelText('US Letter (8.5 × 11 in)'))
    await user.click(within(documents).getByLabelText('Attach the PDF to invoice emails'))
    await user.click(within(documents).getByRole('button', { name: 'Save documents' }))
    expect(await within(documents).findByText('Documents saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ documents: { paperSize: 'letter', attachPdfToEmails: false } })

    const analytics = screen.getByRole('heading', { name: 'Analytics' }).closest('form')
    await user.type(within(analytics).getByLabelText('GA4 measurement ID'), 'UA-12345')
    await user.click(within(analytics).getByRole('button', { name: 'Save analytics' }))
    expect(within(analytics).getByLabelText('GA4 measurement ID')).toHaveAccessibleDescription(/Enter a GA4 measurement ID like G-ABC123XYZ/)
    await user.clear(within(analytics).getByLabelText('GA4 measurement ID'))
    await user.type(within(analytics).getByLabelText('GA4 measurement ID'), 'g-abc123xyz')
    await user.click(within(analytics).getByRole('button', { name: 'Save analytics' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ analytics: { ga4MeasurementId: 'G-ABC123XYZ' } }))

    const shipping = screen.getByRole('heading', { name: 'Shipping' }).closest('form')
    expect(within(shipping).getByLabelText('Weight of products without one (grams)')).toHaveValue(500)
    expect(within(shipping).getByRole('link', { name: 'Table rates' })).toHaveAttribute('href', '/settings/shipping-rates')
  })
})
