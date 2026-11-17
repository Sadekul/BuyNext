import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import CheckoutPage from './CheckoutPage'
import OrderConfirmationPage from './OrderConfirmationPage'
import OrderDetailsPage from './OrderDetailsPage'
import TrackOrderPage from './TrackOrderPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { paymentPage } from '../utils/payment'

// Phase 8: card payments through Stripe Checkout, with BuyNest's API (REAL_SHOP).
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const STRIPE_URL = 'https://checkout.stripe.com/c/pay/cs_test_a1#fid'
const MASCARA = { productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 't.webp', price: 9.99, discountPercentage: 10.48, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 2 }
const TOTALS = { itemCount: 2, subtotal: 17.88, discount: 0, shipping: 4.99, tax: 0, total: 22.87 }
const LINE = { productId: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 9.99, discountPercentage: 10.48, salePrice: 8.94, quantity: 2, lineTotal: 17.88 }
const CART = { lines: [{ ...LINE, stock: 99, minimumOrderQuantity: 1, available: true }], problems: [], coupon: null, couponError: null, shippingOptions: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 4.99 }], totals: TOTALS }
const ADDRESS = { firstName: 'Ava', lastName: 'Guest', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' }
const PAYMENT = { provider: 'stripe', url: STRIPE_URL, expiresAt: '2026-11-16T10:30:00Z', paidAt: null, canPay: true }
const UNPAID = {
  number: 'BN-100001', status: 'pending_payment', paymentStatus: 'unpaid', paymentMethod: 'card', shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' },
  email: 'ava@example.com', phone: '+15550100100', shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null, items: [LINE], totals: TOTALS,
  placedAt: '2026-11-16T10:00:00Z', history: [{ status: 'pending_payment', paymentStatus: 'unpaid', note: 'Order placed.', createdAt: '2026-11-16T10:00:00Z' }],
  paymentProvider: 'stripe', paidAt: null, paymentExpiresAt: PAYMENT.expiresAt, canPay: true, payment: PAYMENT,
}
const PAID = {
  ...UNPAID, status: 'processing', paymentStatus: 'paid', paidAt: '2026-11-16T10:05:00Z', canPay: false,
  payment: { ...PAYMENT, url: null, expiresAt: null, paidAt: '2026-11-16T10:05:00Z', canPay: false },
  invoices: [{ number: 'INV-100001', amount: 22.87, createdAt: '2026-11-16T10:05:00Z' }],
}
const STORE = {
  data: {
    store_name: 'BuyNest', shipping_methods: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: '4.99' }], free_shipping_threshold: '100.00',
    allowed_countries: ['United States'], payment_methods: ['card', 'cod'], guest_checkout: true, tax_enabled: false, card_payments: 'stripe',
  },
}
const CATALOG = { 'GET /products': { body: { products: [{ ...MASCARA, id: 1 }], total: 1, skip: 0, limit: 1 } }, 'GET /api/catalog/store': { body: STORE } }
const confirmation = <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />
const seedCart = () => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items: [MASCARA], couponCode: null }))
const sentTo = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url]) => new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const TYPES_THE_CHECKOUT_FORM = { timeout: 20_000 }

async function fillGuestCheckout(user) {
  await screen.findByLabelText('Email')
  const fields = { Email: 'ava@example.com', Phone: '+1 555 010 0100', 'First name': 'Ava', 'Last name': 'Guest', 'Street address': '12 Market Street', City: 'Springfield', 'State / region': 'Oregon', 'Postal code': '29112' }
  for (const [label, value] of Object.entries(fields)) await user.type(screen.getByLabelText(label), value)
}

const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
}
const ME = { 'GET /api/auth/me': { body: { id: 5, firstName: 'Nadia', email: 'nadia@example.com', role: 'customer' } } }

afterEach(() => vi.useRealTimers())

describe('checkout with Stripe', () => {
  it('a card order goes to Stripe’s page once it is created; the cart is emptied as for any order', TYPES_THE_CHECKOUT_FORM, async () => {
    seedCart()
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    const fetchMock = mockFetch({ ...CATALOG, 'POST /api/shop/cart/validate': { body: CART }, 'POST /api/shop/orders': { status: 201, body: UNPAID } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })

    await user.click(await screen.findByRole('radio', { name: /Credit or debit card/ }))
    expect(screen.getByText(/Next you'll pay on Stripe's secure payment page/)).toBeInTheDocument()
    const button = await screen.findByRole('button', { name: 'Continue to secure payment' })
    await fillGuestCheckout(user)
    await user.click(button)

    await waitFor(() => expect(open).toHaveBeenCalledWith(STRIPE_URL))
    expect(screen.getByRole('status')).toHaveTextContent('Taking you to secure payment…')
    expect(sentTo(fetchMock, '/api/shop/orders')).toMatchObject({ paymentMethod: 'card', email: 'ava@example.com' })
    expect(JSON.parse(window.localStorage.getItem('buynest.cart.v1')).items).toEqual([])
    // The guest's way back from Stripe, in this tab only.
    expect(JSON.parse(window.sessionStorage.getItem('buynest.pendingPayment.v1'))).toEqual({ number: 'BN-100001', email: 'ava@example.com' })
  })

  it('without a payment page (Stripe unreachable) the order is kept and Pay now retries', TYPES_THE_CHECKOUT_FORM, async () => {
    seedCart()
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    const failed = { ...UNPAID, payment: { ...PAYMENT, url: null, expiresAt: null, error: 'Stripe is having trouble right now. Please try again in a moment.' } }
    const fetchMock = mockFetch({
      ...CATALOG,
      'POST /api/shop/cart/validate': { body: CART },
      'POST /api/shop/orders': { status: 201, body: failed },
      'POST /api/shop/orders/BN-100001/pay': { body: PAYMENT },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })
    await user.click(await screen.findByRole('radio', { name: /Credit or debit card/ }))
    await fillGuestCheckout(user)
    await user.click(screen.getByRole('button', { name: 'Continue to secure payment' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { name: "We couldn't open the payment page" })).toBeInTheDocument()
    expect(alert).toHaveTextContent('Stripe is having trouble right now.')
    expect(open).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Pay now' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(STRIPE_URL))
    expect(sentTo(fetchMock, '/api/shop/orders/BN-100001/pay')).toEqual({ email: 'ava@example.com' })
  })

  it('cash on delivery keeps the usual button and confirmation', async () => {
    seedCart()
    mockFetch({ ...CATALOG, 'POST /api/shop/cart/validate': { body: CART } })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByRole('button', { name: 'Place order · $22.87' })).toBeInTheDocument()
  })
})

describe('back from Stripe', () => {
  it('?payment=success polls the order until the webhook marked it paid', async () => {
    signIn()
    let calls = 0
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': () => ({ body: ++calls < 2 ? UNPAID : PAID }) })
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=success', path: '/order-confirmation/:orderId' })

    expect(await screen.findByRole('heading', { name: 'Confirming your payment…' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Payment received — thank you' }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("Your order BN-100001 is paid and confirmed. We've emailed a receipt to ava@example.com.")
    expect(screen.getByText(/Paid by card on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument()
  })

  it('?payment=success says "We\'re confirming your payment" when the webhook takes longer than 20 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    signIn()
    const fetchMock = mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: UNPAID } })
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=success', path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Confirming your payment…' })).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(21_000))
    expect(await screen.findByRole('heading', { name: "We're confirming your payment" })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("There's no need to pay again")
    const polls = fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/api/shop/orders/BN-100001').length
    expect(polls).toBeGreaterThan(5)
    expect(polls).toBeLessThanOrEqual(12) // about every 2 s, then it stops
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/api/shop/orders/BN-100001').length).toBe(polls)
  })

  it('?payment=cancelled: a guest found again with the email kept in this tab can pay now', async () => {
    window.sessionStorage.setItem('buynest.pendingPayment.v1', JSON.stringify({ number: 'BN-100001', email: 'ava@example.com' }))
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    const fetchMock = mockFetch({ 'POST /api/shop/orders/lookup': { body: UNPAID }, 'POST /api/shop/orders/BN-100001/pay': { body: PAYMENT } })
    const user = userEvent.setup()
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=cancelled', path: '/order-confirmation/:orderId' })

    expect(await screen.findByRole('heading', { name: 'Payment not completed' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Nothing was charged.')
    expect(sentTo(fetchMock, '/api/shop/orders/lookup')).toEqual({ number: 'BN-100001', email: 'ava@example.com' })
    await user.click(screen.getByRole('button', { name: 'Pay now' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(STRIPE_URL))
    expect(sentTo(fetchMock, '/api/shop/orders/BN-100001/pay')).toEqual({ email: 'ava@example.com' })
  })

  it('an order cancelled since (its payment page expired) says so, not "is confirmed", and offers no Pay now', async () => {
    window.sessionStorage.setItem('buynest.pendingPayment.v1', JSON.stringify({ number: 'BN-100001', email: 'ava@example.com' }))
    const CANCELLED = { ...UNPAID, status: 'cancelled', canPay: false, payment: { ...PAYMENT, url: null, expiresAt: null, canPay: false } }
    mockFetch({ 'POST /api/shop/orders/lookup': { body: CANCELLED } })
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=cancelled', path: '/order-confirmation/:orderId' })

    expect(await screen.findByRole('heading', { name: 'Order cancelled' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Nothing was charged.')
    expect(screen.queryByText(/is confirmed/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument()
  })

  it('a guest without the email in this tab is sent to order tracking', async () => {
    mockFetch({})
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=cancelled', path: '/order-confirmation/:orderId' })
    expect(screen.getByRole('heading', { name: 'Find your order' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Track your order' })).toHaveAttribute('href', '/track-order')
  })
})

describe('order pages', () => {
  it('an unpaid card order shows "Awaiting payment" with Pay now; a refused payment is announced', async () => {
    signIn()
    mockFetch({
      ...ME,
      'GET /api/shop/orders/BN-100001': { body: UNPAID },
      'POST /api/shop/orders/BN-100001/pay': { status: 422, body: { message: 'This order has already been paid.', errors: { order: ['This order has already been paid.'] } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100001', path: '/account/orders/:orderId' })
    expect(await screen.findByText(/Awaiting payment: nothing has been charged yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pay now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This order has already been paid.')
    expect(screen.getByRole('button', { name: 'Pay now' })).toHaveAccessibleDescription('This order has already been paid.')
  })

  it('a paid order says "Paid by card" and offers no Pay now', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: PAID } })
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100001', path: '/account/orders/:orderId' })
    expect(await screen.findByText(/Paid by card on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay now' })).not.toBeInTheDocument()
  })

  it('order tracking lets a guest pay with the email that found the order', async () => {
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    const fetchMock = mockFetch({ 'POST /api/shop/orders/lookup': { body: UNPAID }, 'POST /api/shop/orders/BN-100001/pay': { body: PAYMENT } })
    const user = userEvent.setup()
    renderWithProviders(<TrackOrderPage />, { route: '/track-order', path: '/track-order' })
    await user.type(screen.getByLabelText('Order number'), 'BN-100001')
    await user.type(screen.getByLabelText('Email'), 'Ava@Example.com')
    await user.click(screen.getByRole('button', { name: 'Find my order' }))
    await user.click(await screen.findByRole('button', { name: 'Pay now' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(STRIPE_URL))
    expect(sentTo(fetchMock, '/api/shop/orders/BN-100001/pay')).toEqual({ email: 'Ava@Example.com' })
  })
})
