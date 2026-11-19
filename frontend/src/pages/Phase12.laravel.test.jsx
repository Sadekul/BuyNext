import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import CheckoutPage from './CheckoutPage'
import OrderConfirmationPage from './OrderConfirmationPage'
import OrderDetailsPage from './OrderDetailsPage'
import InvoicePage from './InvoicePage'
import ChargedInBaseNote from '../components/cart/ChargedInBaseNote'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { paymentPage } from '../utils/payment'
import { chooseDisplayCurrency, resetDisplayCurrencyForTests, setAvailableCurrencies, setStoreCurrency } from '../utils/displayCurrency'
import { SSLCOMMERZ_PHONE_MESSAGE } from '../schemas/checkoutSchema'

// Phase 12 storefront with BuyNest's API (docs/backend/PHASE12_CONTRACT.md): prices in taka from the
// store currency, orders in their own currency, and bKash / Nagad / cards through SSLCommerz.
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const SLOW = { timeout: 20_000 }
const STORE = (overrides = {}) => ({
  data: {
    store_name: 'BuyNest', support_email: 'help@buynest.test', free_shipping_threshold: '5000.00', allowed_countries: ['Bangladesh'], guest_checkout: true, tax_enabled: false,
    shipping_methods: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: '120.00' }],
    // The API already leaves PayPal out of payment_methods in a taka store; "unavailable" hides it either way.
    payment_methods: ['paypal', 'sslcommerz', 'cod'], card_payments: 'manual', paypal_payments: 'unavailable', sslcommerz_payments: 'sslcommerz',
    currency: { code: 'BDT', symbol: '৳', decimals: 2 }, currencies: { base: 'BDT', display: [] }, ga4_measurement_id: null, ...overrides,
  },
})
const ADDRESS = { firstName: 'Rahim', lastName: 'Uddin', line1: 'House 12, Road 5', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1207', country: 'Bangladesh' }
const ITEM = { productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 'm.webp', price: 1100, discountPercentage: 0, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 2 }
const seedCart = (items) => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items, couponCode: null }))
const LINE = { productId: 1, title: 'Mascara', thumbnail: 'm.webp', price: 1100, discountPercentage: 0, salePrice: 1100, quantity: 2, lineTotal: 2200, stock: 99, minimumOrderQuantity: 1, available: true }
const TOTALS = (extra = {}) => ({ itemCount: 2, subtotal: 2200, discount: 0, shipping: 120, tax: 0, total: 2320, giftCard: 0, amountDue: 2320, ...extra })
const CART = { lines: [LINE], problems: [], coupon: null, couponError: null, appliedRules: [], shippingOptions: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 120 }], requiresShipping: true, shippingError: null, giftCard: null, giftCardError: null, totals: TOTALS() }
const GATEWAY = 'https://sandbox.sslcommerz.com/EasyCheckOut/testcde5e5d1b5b0d1b0c5f'
const SSL_PAYMENT = { provider: 'sslcommerz', url: GATEWAY, expiresAt: '2026-11-19T13:00:00Z', paidAt: null, canPay: true }
const ORDER = (overrides = {}) => ({
  number: 'BN-100001', status: 'pending_payment', paymentStatus: 'unpaid', paymentMethod: 'sslcommerz', paymentProvider: 'sslcommerz', canPay: true, payment: SSL_PAYMENT,
  shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' }, email: 'rahim@example.com', phone: '+880 1711 000000', shippingAddress: ADDRESS, billingAddress: ADDRESS,
  couponCode: null, items: [LINE], totals: TOTALS(), currency: 'BDT', placedAt: '2026-11-19T10:00:00Z', history: [], shipments: [], invoices: [], creditMemos: [], ...overrides,
})
const PAID = ORDER({ status: 'processing', paymentStatus: 'paid', paidAt: '2026-11-19T10:05:00Z', canPay: false, payment: { ...SSL_PAYMENT, url: null, paidAt: '2026-11-19T10:05:00Z', canPay: false, methodLabel: 'bKash' } })
const CATALOG = (store = STORE()) => ({ 'GET /api/catalog/store': { body: store } })
const confirmation = <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />
const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
}
const ME = { 'GET /api/auth/me': { body: { id: 5, firstName: 'Nadia', email: 'nadia@example.com', role: 'customer' } } }
const sentTo = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url]) => new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const callsTo = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init = {}]) => new URL(url).pathname === path && (init.method ?? 'GET').toUpperCase() === method)

async function fillAddress(user) {
  await user.type(await screen.findByLabelText('Email'), 'rahim@example.com')
  const fields = { 'First name': 'Rahim', 'Last name': 'Uddin', 'Street address': 'House 12, Road 5', City: 'Dhaka', 'State / region': 'Dhaka', 'Postal code': '1207' }
  for (const [label, value] of Object.entries(fields)) await user.type(screen.getByLabelText(label), value)
  // The guest's email starts a fresh price check 600 ms after typing stops: let it finish before clicking.
  await new Promise((resolve) => setTimeout(resolve, 700))
  await waitFor(() => expect(screen.queryByText('Checking prices…')).toBeNull())
}

afterEach(() => {
  resetDisplayCurrencyForTests()
  window.sessionStorage.clear()
})

describe('prices in the store currency (§1, §4)', () => {
  it('checkout shows taka from the store settings; PayPal is hidden when it can’t take BDT', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': { body: CART } })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })

    expect(await screen.findByRole('button', { name: 'Place order · ৳2,320.00' })).toBeInTheDocument()
    expect(screen.getByText('Subtotal (2 items)').nextSibling).toHaveTextContent('৳2,200.00')
    expect(screen.getByRole('radio', { name: /Standard/ }).closest('label')).toHaveTextContent('৳120.00')
    expect(screen.getByText('2 × ৳1,100.00')).toBeInTheDocument()
    const payment = screen.getByRole('group', { name: 'Payment' })
    expect(within(payment).queryByRole('radio', { name: /PayPal/ })).not.toBeInTheDocument()
    expect(within(payment).getAllByRole('radio').map((radio) => radio.value)).toEqual(['sslcommerz', 'cod'])
  })

  it('"You’ll be charged" names the store currency while prices show in a display currency', () => {
    setStoreCurrency({ code: 'BDT', symbol: '৳', decimals: 2 })
    setAvailableCurrencies([{ code: 'USD', symbol: '$', rate: 0.0091, decimals: 2 }])
    chooseDisplayCurrency('USD')
    renderWithProviders(<ChargedInBaseNote amount={2320} />)
    expect(screen.getByText(/approximate/)).toHaveTextContent("Prices in USD are approximate. You'll be charged ৳2,320.00 BDT.")
  })

  it('an order is written in its own currency: an old USD order stays in dollars in a taka store', async () => {
    signIn()
    setStoreCurrency({ code: 'BDT', symbol: '৳', decimals: 2 })
    const OLD = ORDER({
      number: 'BN-100002', currency: 'USD', paymentMethod: 'cod', paymentProvider: null, status: 'processing', canPay: false, payment: null,
      items: [{ ...LINE, price: 9.99, salePrice: 9.99, lineTotal: 19.98 }], totals: TOTALS({ subtotal: 19.98, shipping: 4.99, total: 24.97, amountDue: 24.97 }),
      invoices: [{ number: 'INV-000002', amount: 24.97, createdAt: '2026-11-01T10:00:00Z', currency: 'USD' }],
    })
    mockFetch({ ...ME, ...CATALOG(), 'GET /api/shop/me/wishlist': { body: { items: [], shared: false } }, 'GET /api/shop/orders/BN-100002': { body: OLD } })
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100002', path: '/account/orders/:orderId' })
    expect(await screen.findByText('2 × $9.99')).toBeInTheDocument()
    expect(screen.getByText('Total').nextSibling).toHaveTextContent('$24.97')
    expect(screen.getByText('Invoice INV-000002').closest('p')).toHaveTextContent('$24.97')
    expect(screen.queryByText(/৳/)).not.toBeInTheDocument()
  })

  it('the printable invoice uses the invoice’s currency', async () => {
    signIn()
    const INVOICE = { number: 'INV-000003', orderNumber: 'BN-100001', amount: 2320, createdAt: '2026-11-19T10:05:00Z', billingAddress: ADDRESS, items: [LINE], totals: TOTALS(), currency: 'BDT' }
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001/invoices/INV-000003': { body: INVOICE } })
    renderWithProviders(<InvoicePage />, { route: '/account/orders/BN-100001/invoices/INV-000003', path: '/account/orders/:orderId/invoices/:invoiceNumber' })
    expect(await screen.findByRole('heading', { name: 'Invoice INV-000003' })).toBeInTheDocument()
    expect(screen.getAllByText('৳2,320.00').length).toBeGreaterThan(0)
    expect(screen.getAllByText('৳1,100.00').length).toBeGreaterThan(0)
  })
})

describe('SSLCommerz at checkout (§4)', () => {
  it('offers bKash, Nagad or card with text badges and the note; the phone is asked for with a reason', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': { body: CART } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })

    const option = await screen.findByRole('radio', { name: /bKash, Nagad or card \(SSLCommerz\)/ })
    const card = option.closest('label')
    // Plain text marks (never fetched logos), hidden from screen readers: the label already names them.
    const badges = card.querySelector('.choice-card__badges')
    expect(badges).toHaveAttribute('aria-hidden', 'true')
    expect(Array.from(badges.children).map((badge) => badge.textContent)).toEqual(['bKash', 'Nagad', 'Card'])
    expect(card.querySelector('img')).toBeNull()
    expect(card).toHaveTextContent("You'll finish paying on SSLCommerz's secure page.")
    expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription('For delivery updates only.')

    await user.click(option)
    expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription('Needed for paying through SSLCommerz, and for delivery updates.')
    expect(screen.getByText(/You'll finish paying on SSLCommerz's secure page \(bKash, Nagad, Rocket, cards, or internet banking\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to SSLCommerz' })).toBeInTheDocument()

    await fillAddress(user)
    await user.click(screen.getByRole('button', { name: 'Continue to SSLCommerz' }))
    expect(await screen.findByText(SSLCOMMERZ_PHONE_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true')
    // Another method: the usual message.
    await user.click(screen.getByRole('radio', { name: /Cash on delivery/ }))
    expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument()
  })

  it('places the order, then leaves for SSLCommerz’s GatewayPageURL', SLOW, async () => {
    seedCart([ITEM])
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    const fetchMock = mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': { body: CART }, 'POST /api/shop/orders': { status: 201, body: ORDER() } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })
    await user.click(await screen.findByRole('radio', { name: /SSLCommerz/ }))
    await user.type(screen.getByLabelText('Phone'), '+880 1711 000000')
    await fillAddress(user)
    await user.click(screen.getByRole('button', { name: 'Continue to SSLCommerz' }))

    await waitFor(() => expect(open).toHaveBeenCalledWith(GATEWAY))
    expect(screen.getByRole('status')).toHaveTextContent('Taking you to SSLCommerz…')
    expect(sentTo(fetchMock, '/api/shop/orders')).toMatchObject({ paymentMethod: 'sslcommerz', phone: '+8801711000000' })
    // A guest's number and email are kept in this tab for the way back.
    expect(JSON.parse(window.sessionStorage.getItem('buynest.pendingPayment.v1'))).toEqual({ number: 'BN-100001', email: 'rahim@example.com' })
    open.mockRestore()
  })

  it('SSLCommerz unreachable: the order is saved, the reason shown, with Pay now', SLOW, async () => {
    seedCart([ITEM])
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    mockFetch({
      ...CATALOG(),
      'POST /api/shop/cart/validate': { body: CART },
      'POST /api/shop/orders': { status: 201, body: ORDER({ payment: { ...SSL_PAYMENT, url: null, error: 'SSLCommerz could not be reached. Please try again in a moment.' } }) },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })
    await user.click(await screen.findByRole('radio', { name: /SSLCommerz/ }))
    await user.type(screen.getByLabelText('Phone'), '01711000000')
    await fillAddress(user)
    await user.click(screen.getByRole('button', { name: 'Continue to SSLCommerz' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { name: "We couldn't open the payment page" })).toBeInTheDocument()
    expect(alert).toHaveTextContent('SSLCommerz could not be reached. Please try again in a moment.')
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('a manual SSLCommerz (not connected) places a normal order that waits for staff', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(STORE({ sslcommerz_payments: 'manual' })), 'POST /api/shop/cart/validate': { body: CART } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await user.click(await screen.findByRole('radio', { name: /SSLCommerz/ }))
    expect(screen.getByRole('button', { name: 'Place order · ৳2,320.00' })).toBeInTheDocument()
    expect(screen.getByText(/No payment provider is connected yet/)).toBeInTheDocument()
  })
})

describe('back from SSLCommerz (§3, §4)', () => {
  const route = (payment) => `/order-confirmation/BN-100001?payment=${payment}&provider=sslcommerz`

  it('success: polls the order until it is paid, then "Paid with bKash (SSLCommerz)"', SLOW, async () => {
    signIn()
    let polls = 0
    const fetchMock = mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': () => ({ body: ++polls < 2 ? ORDER() : PAID }) })
    renderWithProviders(<OrderConfirmationPage />, { route: route('success'), path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Confirming your payment…' })).toBeInTheDocument()
    expect(screen.getByText('SSLCommerz is letting us know about your payment. This usually takes a few seconds.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Payment received — thank you' }, { timeout: 6000 })).toBeInTheDocument()
    expect(screen.getByText('Paid with bKash (SSLCommerz) on Nov 19, 2026. Thank you.')).toBeInTheDocument()
    expect(screen.getByText('Total').nextSibling).toHaveTextContent('৳2,320.00')
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument()
    const before = callsTo(fetchMock, 'GET', '/api/shop/orders/BN-100001').length
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(callsTo(fetchMock, 'GET', '/api/shop/orders/BN-100001')).toHaveLength(before) // stopped once paid
  })

  it('a guest is found again with the email kept in this tab (no session needed after the cross-site return)', async () => {
    window.sessionStorage.setItem('buynest.pendingPayment.v1', JSON.stringify({ number: 'BN-100001', email: 'rahim@example.com' }))
    const fetchMock = mockFetch({ 'POST /api/shop/orders/lookup': { body: PAID } })
    renderWithProviders(<OrderConfirmationPage />, { route: route('success'), path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Payment received — thank you' })).toBeInTheDocument()
    expect(sentTo(fetchMock, '/api/shop/orders/lookup')).toMatchObject({ number: 'BN-100001', email: 'rahim@example.com' })
  })

  it('failed: an alert, nothing charged, and Pay now starts a new attempt', async () => {
    signIn()
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    const fetchMock = mockFetch({
      ...ME,
      'GET /api/shop/orders/BN-100001': { body: ORDER({ payment: { ...SSL_PAYMENT, url: null } }) },
      'POST /api/shop/orders/BN-100001/pay': { body: { ...SSL_PAYMENT, url: `${GATEWAY}2` } },
    })
    const user = userEvent.setup()
    renderWithProviders(<OrderConfirmationPage />, { route: route('failed'), path: '/order-confirmation/:orderId' })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { name: 'Payment failed' })).toBeInTheDocument()
    expect(alert).toHaveTextContent("SSLCommerz couldn't complete the payment, so nothing was charged. Your order BN-100001 is saved: try again with Pay now.")
    await user.click(screen.getByRole('button', { name: 'Pay now' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(`${GATEWAY}2`))
    expect(callsTo(fetchMock, 'POST', '/api/shop/orders/BN-100001/pay')).toHaveLength(1)
    open.mockRestore()
  })

  it('cancelled: "Payment not completed" with Pay now; never polls', async () => {
    signIn()
    const fetchMock = mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: ORDER() } })
    renderWithProviders(<OrderConfirmationPage />, { route: route('cancelled'), path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Payment not completed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(callsTo(fetchMock, 'GET', '/api/shop/orders/BN-100001')).toHaveLength(1)
  })

  it('held for a check (risk): says the payment is being checked, without Pay now', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: ORDER({ paymentStatus: 'review', canPay: false }) } })
    renderWithProviders(<OrderConfirmationPage />, { route: route('success'), path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: "We're checking your payment" })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument()
    expect(screen.getByText('Being checked')).toBeInTheDocument()
  })
})
