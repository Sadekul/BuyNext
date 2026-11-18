import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import ProductListingPage from './ProductListingPage'
import ProductDetailsPage from './ProductDetailsPage'
import CheckoutPage from './CheckoutPage'
import OrderConfirmationPage from './OrderConfirmationPage'
import InvoicePage from './InvoicePage'
import TrackOrderPage from './TrackOrderPage'
import GiftCardBalancePage from './GiftCardBalancePage'
import CartDrawer from '../components/cart/CartDrawer'
import MainLayout from '../layouts/MainLayout'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { paymentPage } from '../utils/payment'
import { resetAnalyticsForTests } from '../utils/analytics'

// Phase 10 storefront with BuyNest's API: search corrections, gift cards, delivery from table rates,
// PayPal, invoice PDFs, and the cookie banner (docs/backend/PHASE10_CONTRACT.md).
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const SLOW = { timeout: 20_000 }
const productJson = (overrides) => ({
  id: 1, name: 'Mascara', price: '9.99', discount_percent: 0, stock_quantity: 99, availability: 'in_stock', min_order_quantity: 1, has_variants: false,
  category: { slug: 'beauty' }, brand: { name: 'Essence' }, images: [], thumbnail_url: 'https://cdn.dummyjson.com/m.webp', rating_average: '4.5', reviews: [], ...overrides,
})
const GIFT_CARD_JSON = productJson({ id: 30, name: 'BuyNest Gift Card', price: '25.00', stock_quantity: 0, availability: 'out_of_stock', brand: null, type: 'gift_card', gift_card: { amounts: ['25.00', '50.00', '100.00'], custom: { min: '10.00', max: '500.00' } } })
const productPage = (items, meta = {}) => ({ data: items, meta: { current_page: 1, per_page: 100, total: items.length, ...meta } })
const STORE = (overrides = {}) => ({
  data: {
    store_name: 'BuyNest', support_email: 'help@buynest.test', free_shipping_threshold: '100.00', allowed_countries: ['United States', 'Germany'], guest_checkout: true, tax_enabled: false,
    shipping_methods: [
      { id: 'standard', label: 'Standard', eta: '3–5 business days', price: '4.99' },
      { id: 'express', label: 'Express', eta: '1–2 business days', price: '12.99' },
    ],
    payment_methods: ['card', 'paypal', 'cod'], card_payments: 'manual', paypal_payments: 'manual', ga4_measurement_id: null, ...overrides,
  },
})
const sentTo = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url]) => new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const sentAll = (fetchMock, path) => fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === path).map(([, init]) => JSON.parse(init.body))

const ADDRESS = { firstName: 'Ava', lastName: 'Guest', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' }
const MASCARA_ITEM = { productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 'm.webp', price: 9.99, discountPercentage: 0, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 2 }
const SAM = { amount: 50, recipientName: 'Sam Lee', recipientEmail: 'sam@example.com', message: 'Happy birthday' }
const GIFT_ITEM = { productId: 30, productType: 'gift_card', giftCard: SAM, title: 'BuyNest Gift Card', brand: null, category: 'beauty', thumbnail: 'gc.webp', price: 50, discountPercentage: 0, stock: 10, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 1 }
const seedCart = (items) => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items, couponCode: null }))
const LINE = (item, extra = {}) => ({ productId: item.productId, title: item.title, thumbnail: item.thumbnail, price: item.price, discountPercentage: 0, salePrice: item.price, quantity: item.quantity, lineTotal: item.price * item.quantity, stock: 99, minimumOrderQuantity: 1, available: true, ...extra })
const TOTALS = (total, extra = {}) => ({ itemCount: 2, subtotal: total, discount: 0, shipping: 0, tax: 0, total, giftCard: 0, amountDue: total, ...extra })
const CART = (overrides = {}) => ({
  lines: [LINE(MASCARA_ITEM)], problems: [], coupon: null, couponError: null, appliedRules: [],
  shippingOptions: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 4.99 }, { id: 'express', label: 'Express', eta: '1–2 business days', price: 12.99 }],
  requiresShipping: true, shippingError: null, giftCard: null, giftCardError: null, totals: TOTALS(24.97, { shipping: 4.99 }), ...overrides,
})
const ORDER = (overrides = {}) => ({
  number: 'BN-100001', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod', shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' },
  email: 'ava@example.com', phone: '+15550100100', shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null, items: [LINE(MASCARA_ITEM)], totals: TOTALS(24.97, { shipping: 4.99 }),
  placedAt: '2026-11-17T10:00:00Z', history: [], shipments: [], invoices: [], creditMemos: [], ...overrides,
})
const CATALOG = (store = STORE()) => ({
  'GET /api/catalog/products': { body: productPage([productJson(), GIFT_CARD_JSON]) },
  'GET /api/catalog/store': { body: store },
  'GET /api/catalog/categories': { body: { data: [{ slug: 'beauty', name: 'Beauty', children: [] }] } },
})
const confirmation = <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />
const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
}
const ME = { 'GET /api/auth/me': { body: { id: 5, firstName: 'Nadia', email: 'nadia@example.com', role: 'customer' } } }

async function fillContact(user) {
  await user.type(await screen.findByLabelText('Email'), 'ava@example.com')
  await user.type(screen.getByLabelText('Phone'), '+1 555 010 0100')
}
async function fillAddress(user) {
  const fields = { 'First name': 'Ava', 'Last name': 'Guest', 'Street address': '12 Market Street', City: 'Springfield', 'State / region': 'Oregon', 'Postal code': '29112' }
  for (const [label, value] of Object.entries(fields)) await user.type(screen.getByLabelText(label), value)
  // The guest's email starts a fresh price check 600 ms after typing stops (per-customer coupon limits);
  // the button reads "Checking prices…" and is disabled meanwhile. Let that run before clicking.
  await new Promise((resolve) => setTimeout(resolve, 700))
  await waitFor(() => expect(screen.queryByText('Checking prices…')).toBeNull())
}

afterEach(() => {
  vi.useRealTimers()
  resetAnalyticsForTests()
  document.cookie = 'buynest_consent=; Max-Age=0; Path=/'
})

describe('search (§1)', () => {
  it('says when a typo was corrected and links to the words as typed (correct=0); results keep the API’s ranking', async () => {
    const fetchMock = mockFetch({
      ...CATALOG(),
      'GET /api/catalog/products': (url) =>
        url.searchParams.get('correct') === '0'
          ? { body: productPage([], { corrected_query: null }) }
          : { body: productPage([productJson({ id: 2, name: 'iPhone 13' }), productJson({ id: 3, name: 'iPhone case' })], { corrected_query: 'iphone' }) },
    })
    const user = userEvent.setup()
    renderWithProviders(<ProductListingPage />, { route: '/products?q=ihpone', path: '/products' })

    expect(await screen.findByRole('heading', { name: 'Results for "iphone"' })).toBeInTheDocument()
    expect(screen.getByText(/Showing results for/)).toHaveTextContent('Showing results for iphone.')
    const instead = screen.getByRole('link', { name: 'Search instead for ihpone' })
    expect(instead).toHaveAttribute('href', '/products?q=ihpone&exact=1')
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveDisplayValue('Best match')
    const titles = screen.getAllByRole('article').map((card) => within(card).getByRole('heading').textContent)
    expect(titles).toEqual(['iPhone 13', 'iPhone case'])

    await user.click(instead)
    expect(await screen.findByRole('heading', { name: 'No results for "ihpone"' })).toBeInTheDocument()
    const exactCall = fetchMock.mock.calls.map(([url]) => new URL(url)).find((url) => url.searchParams.get('correct') === '0')
    expect(exactCall.searchParams.get('search')).toBe('ihpone')
    expect(screen.queryByText(/Showing results for/)).not.toBeInTheDocument()
  })
})

describe('gift cards (§5)', () => {
  it('the product page sells by amount, to a recipient; the cart line names the recipient', async () => {
    mockFetch({ ...CATALOG(), 'GET /api/catalog/products/30': { body: { data: GIFT_CARD_JSON } } })
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <ProductDetailsPage />
        <CartDrawer />
      </>,
      { route: '/products/30', path: '/products/:productId' },
    )
    const form = await screen.findByRole('form', { name: 'Send this gift card' })
    const amounts = within(form).getByRole('group', { name: 'Amount' })
    expect(within(amounts).getAllByRole('radio').map((radio) => radio.labels[0].textContent)).toEqual(['$25.00', '$50.00', '$100.00', 'Other amount'])
    expect(within(amounts).getByRole('radio', { name: '$50.00' })).toBeChecked()
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument()

    // A custom amount outside the store's limits, and missing recipient details, are explained on submit.
    await user.click(within(amounts).getByRole('radio', { name: 'Other amount' }))
    await user.type(within(form).getByLabelText('Your amount (USD)'), '5')
    await user.click(within(form).getByRole('button', { name: /Add to cart/ }))
    expect(within(form).getByLabelText('Your amount (USD)')).toHaveAccessibleDescription(/Choose an amount from \$10.00 to \$500.00./)
    expect(within(form).getByLabelText('Your amount (USD)')).toHaveFocus()
    expect(within(form).getByLabelText("Recipient's name")).toHaveAccessibleDescription("Enter the recipient's name.")

    await user.clear(within(form).getByLabelText('Your amount (USD)'))
    await user.type(within(form).getByLabelText('Your amount (USD)'), '75')
    await user.type(within(form).getByLabelText("Recipient's name"), 'Sam Lee')
    await user.type(within(form).getByLabelText("Recipient's email"), 'sam@example.com')
    await user.type(within(form).getByLabelText('Message (optional)'), 'Happy birthday')
    await user.click(within(form).getByRole('button', { name: 'Add to cart · $75.00' }))

    expect(within(form).getByRole('status')).toHaveTextContent('A $75.00 gift card for Sam Lee was added to your cart.')
    const stored = JSON.parse(window.localStorage.getItem('buynest.cart.v1')).items
    expect(stored).toEqual([expect.objectContaining({ productId: 30, productType: 'gift_card', price: 75, quantity: 1, giftCard: expect.objectContaining({ amount: 75, recipientName: 'Sam Lee', recipientEmail: 'sam@example.com', message: 'Happy birthday' }) })])
    const drawer = await screen.findByRole('dialog', { name: /cart/i })
    expect(within(drawer).getByText('For Sam Lee (sam@example.com)')).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Remove BuyNest Gift Card for Sam Lee from cart' })).toBeInTheDocument()
  })

  it('checks a balance and announces it; unknown codes get the same answer', async () => {
    let calls = 0
    const fetchMock = mockFetch({
      'POST /api/shop/gift-cards/check': () =>
        ++calls === 1
          ? { body: { balance: 42.5, currency: 'USD', expiresAt: null, status: 'active' } }
          : { status: 422, body: { message: "This gift card code isn't valid.", errors: { code: ["This gift card code isn't valid."] } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<GiftCardBalancePage />, { route: '/gift-cards/balance', path: '/gift-cards/balance' })
    await user.click(screen.getByRole('button', { name: 'Check balance' }))
    expect(screen.getByLabelText('Gift card code')).toHaveAccessibleDescription(/Enter the gift card code from your email./)

    await user.type(screen.getByLabelText('Gift card code'), 'abcd efgh ijkl mnop')
    await user.click(screen.getByRole('button', { name: 'Check balance' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Balance: $42.50. It never expires.')
    expect(sentTo(fetchMock, '/api/shop/gift-cards/check')).toEqual({ code: 'ABCDEFGHIJKLMNOP' })

    await user.click(screen.getByRole('button', { name: 'Check balance' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("This gift card code isn't valid.")
  })
})

describe('checkout (§3, §4, §5)', () => {
  it('shows only the delivery methods the server offers for this cart, and moves off one it stopped offering', SLOW, async () => {
    seedCart([MASCARA_ITEM])
    const fetchMock = mockFetch({
      ...CATALOG(),
      'POST /api/shop/cart/validate': (url, init) => {
        const body = JSON.parse(init.body)
        const express = { id: 'express', label: 'Express', eta: '1–2 business days', price: 15.5 }
        return { body: CART({ shippingOptions: [express], totals: TOTALS(35.48, { shipping: body.shippingMethod === 'express' ? 15.5 : 0 }) }) }
      },
    })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    const delivery = await screen.findByRole('group', { name: 'Delivery' })
    await waitFor(() => expect(within(delivery).getAllByRole('radio')).toHaveLength(1))
    expect(within(delivery).getByRole('radio', { name: /Express/ })).toBeChecked()
    expect(within(delivery).getByText('$15.50')).toBeInTheDocument()
    expect(within(delivery).queryByRole('radio', { name: /Standard/ })).not.toBeInTheDocument()
    await waitFor(() => expect(sentTo(fetchMock, '/api/shop/cart/validate')).toMatchObject({ shippingMethod: 'express', country: 'United States' }))
  })

  it('says so when nothing can be delivered to the country', SLOW, async () => {
    seedCart([MASCARA_ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': { body: CART({ shippingOptions: [], shippingError: "We can't ship this order to United States with the available methods." }) } })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByText(/We can't ship this order to United States with the available methods./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Place order/ })).toBeDisabled()
  })

  it('a cart of gift cards only skips delivery: one (billing) address, no method', SLOW, async () => {
    seedCart([GIFT_ITEM])
    const giftLine = LINE(GIFT_ITEM, { productType: 'gift_card', giftCard: SAM, stock: 0 })
    const fetchMock = mockFetch({
      ...CATALOG(),
      'POST /api/shop/cart/validate': { body: CART({ lines: [giftLine], shippingOptions: [], requiresShipping: false, totals: TOTALS(50, { itemCount: 1 }) }) },
      'POST /api/shop/orders': { status: 201, body: ORDER({ items: [giftLine], shippingMethod: null, requiresShipping: false, totals: TOTALS(50, { itemCount: 1 }) }) },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })
    expect(await screen.findByRole('heading', { name: 'Billing address' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Shipping address' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Delivery' })).not.toBeInTheDocument()
    expect(screen.getByText(/Gift cards are sent by email/)).toBeInTheDocument()
    expect(screen.getByText('For Sam Lee (sam@example.com)')).toBeInTheDocument()

    await fillContact(user)
    await fillAddress(user)
    const place = await screen.findByRole('button', { name: 'Place order · $50.00' })
    await waitFor(() => expect(place).toBeEnabled())
    await user.click(place)
    expect(await screen.findByRole('heading', { name: 'Thank you, Ava!' })).toBeInTheDocument()
    expect(sentTo(fetchMock, '/api/shop/cart/validate')).toMatchObject({ shippingMethod: null })
    expect(sentTo(fetchMock, '/api/shop/cart/validate')).not.toHaveProperty('country')
    const sent = sentTo(fetchMock, '/api/shop/orders')
    expect(sent).toMatchObject({ shippingMethod: null, shippingAddress: ADDRESS, billingAddress: null, paymentMethod: 'cod' })
    expect(sent.items).toEqual([{ productId: 30, quantity: 1, giftCard: SAM }])
    expect(screen.getByText('Sent by email: nothing to ship.')).toBeInTheDocument()
  })

  it('a gift card that pays everything needs no other payment; the order is sent with payment method "gift_card"', SLOW, async () => {
    seedCart([MASCARA_ITEM])
    const covered = CART({ giftCard: { last4: 'MNOP', applied: 24.97, balance: 80, remaining: 55.03, expiresAt: null }, totals: TOTALS(24.97, { shipping: 4.99, giftCard: 24.97, amountDue: 0 }) })
    const fetchMock = mockFetch({
      ...CATALOG(),
      'POST /api/shop/gift-cards/check': { body: { balance: 80, currency: 'USD', expiresAt: null, status: 'active' } },
      'POST /api/shop/cart/validate': (url, init) => ({ body: JSON.parse(init.body).giftCardCode ? covered : CART() }),
      'POST /api/shop/orders': { status: 201, body: ORDER({ status: 'processing', paymentStatus: 'paid', paymentMethod: 'gift_card', paymentProvider: 'gift_card', giftCard: { last4: 'MNOP', applied: 24.97 } }) },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })
    await user.type(await screen.findByLabelText('Gift card'), 'abcd-efgh-ijkl-mnop')
    await user.click(screen.getAllByRole('button', { name: 'Apply' })[1])

    expect(await screen.findByText(/Your gift card pays for the whole order/)).toBeInTheDocument()
    expect(sentTo(fetchMock, '/api/shop/gift-cards/check')).toEqual({ code: 'ABCD-EFGH-IJKL-MNOP' })
    expect(sentTo(fetchMock, '/api/shop/cart/validate')).toMatchObject({ giftCardCode: 'ABCD-EFGH-IJKL-MNOP' })
    expect(screen.queryByRole('group', { name: 'Payment' })).toHaveTextContent('Your gift card pays for the whole order')
    expect(screen.queryByRole('radio', { name: /Cash on delivery/ })).not.toBeInTheDocument()
    const summary = screen.getByRole('complementary', { name: 'Order summary' })
    expect(within(summary).getByText('Paid by gift card').nextSibling).toHaveTextContent('−$24.97')
    expect(within(summary).getByText('By other payment').nextSibling).toHaveTextContent('$0.00')
    expect(within(summary).getAllByRole('status').some((status) => /Gift card ending MNOP pays \$24.97. \$55.03 stays on the card./.test(status.textContent))).toBe(true)

    await fillContact(user)
    await fillAddress(user)
    await user.click(await screen.findByRole('button', { name: 'Place order · $0.00' }))
    await screen.findByRole('heading', { name: /Thank you/ })
    expect(sentTo(fetchMock, '/api/shop/orders')).toMatchObject({ paymentMethod: 'gift_card', giftCardCode: 'ABCD-EFGH-IJKL-MNOP' })
    expect(screen.getByText('Paid in full with a gift card. Thank you.')).toBeInTheDocument()
    expect(screen.getByText('Gift card •••• MNOP paid $24.97.')).toBeInTheDocument()
  })

  it('a partial gift card leaves the rest to the chosen method; a card that can’t be used is explained', SLOW, async () => {
    seedCart([MASCARA_ITEM])
    const partial = CART({ giftCard: { last4: 'MNOP', applied: 10, balance: 10, remaining: 0, expiresAt: null }, totals: TOTALS(24.97, { shipping: 4.99, giftCard: 10, amountDue: 14.97 }) })
    let checks = 0
    mockFetch({
      ...CATALOG(),
      'POST /api/shop/gift-cards/check': () => (++checks === 1 ? { status: 422, body: { message: "This gift card code isn't valid.", errors: { code: ["This gift card code isn't valid."] } } } : { body: { balance: 10, currency: 'USD', expiresAt: null, status: 'active' } }),
      'POST /api/shop/cart/validate': (url, init) => ({ body: JSON.parse(init.body).giftCardCode ? partial : CART() }),
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    const field = await screen.findByLabelText('Gift card')
    await user.type(field, 'AAAABBBBCCCCDDDD')
    await user.click(screen.getAllByRole('button', { name: 'Apply' })[1])
    await waitFor(() => expect(screen.getByLabelText('Gift card')).toHaveAccessibleDescription(/This gift card code isn't valid./))

    await user.clear(screen.getByLabelText('Gift card'))
    await user.type(screen.getByLabelText('Gift card'), 'ABCDEFGHIJKLMNOP')
    await user.click(screen.getAllByRole('button', { name: 'Apply' })[1])
    expect(await screen.findByText(/Your gift card pays \$10.00; the remaining \$14.97 is paid as chosen above./)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Cash on delivery/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Place order · $14.97' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove gift card ending MNOP' }))
    expect(await screen.findByRole('button', { name: 'Place order · $24.97' })).toBeInTheDocument()
  })

  it('PayPal: the order is placed, then the shopper goes to PayPal’s approval page', SLOW, async () => {
    seedCart([MASCARA_ITEM])
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    const PAYPAL_URL = 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T'
    const payment = { provider: 'paypal', url: PAYPAL_URL, expiresAt: '2026-11-17T13:00:00Z', paidAt: null, canPay: true }
    const fetchMock = mockFetch({
      ...CATALOG(STORE({ paypal_payments: 'paypal' })),
      'POST /api/shop/cart/validate': { body: CART() },
      'POST /api/shop/orders': { status: 201, body: ORDER({ status: 'pending_payment', paymentMethod: 'paypal', paymentProvider: 'paypal', canPay: true, payment }) },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })
    await user.click(await screen.findByRole('radio', { name: /PayPal/ }))
    expect(screen.getByText(/Next you'll approve the payment on PayPal's site/)).toBeInTheDocument()
    await fillContact(user)
    await fillAddress(user)
    await user.click(await screen.findByRole('button', { name: 'Continue to PayPal' }))

    await waitFor(() => expect(open).toHaveBeenCalledWith(PAYPAL_URL))
    expect(screen.getByRole('status')).toHaveTextContent('Taking you to PayPal…')
    expect(sentTo(fetchMock, '/api/shop/orders')).toMatchObject({ paymentMethod: 'paypal' })
    expect(JSON.parse(window.sessionStorage.getItem('buynest.pendingPayment.v1'))).toEqual({ number: 'BN-100001', email: 'ava@example.com' })
  })
})

describe('back from PayPal (§3)', () => {
  const UNPAID = ORDER({ status: 'pending_payment', paymentMethod: 'paypal', paymentProvider: 'paypal', canPay: true, payment: { provider: 'paypal', url: null, expiresAt: null, paidAt: null, canPay: true } })
  const PAID = { ...UNPAID, status: 'processing', paymentStatus: 'paid', paidAt: '2026-11-17T10:05:00Z', canPay: false, payment: { ...UNPAID.payment, paidAt: '2026-11-17T10:05:00Z', canPay: false } }

  it('captures the approved payment with PayPal’s token, then shows the paid order', async () => {
    signIn()
    const fetchMock = mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: UNPAID }, 'POST /api/shop/orders/BN-100001/paypal/capture': { body: PAID } })
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=success&provider=paypal&token=5O190127TN364715T&PayerID=ABC', path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Payment received — thank you' })).toBeInTheDocument()
    expect(sentAll(fetchMock, '/api/shop/orders/BN-100001/paypal/capture')).toEqual([{ token: '5O190127TN364715T' }])
    expect(screen.getByText(/Paid with PayPal on/)).toBeInTheDocument()
  })

  it('a guest is found with the email kept in this tab; a refused capture is explained with Pay now', async () => {
    window.sessionStorage.setItem('buynest.pendingPayment.v1', JSON.stringify({ number: 'BN-100001', email: 'ava@example.com' }))
    const fetchMock = mockFetch({
      'POST /api/shop/orders/lookup': { body: UNPAID },
      'POST /api/shop/orders/BN-100001/paypal/capture': { status: 422, body: { message: 'PayPal declined the payment: INSTRUMENT_DECLINED. You can try again with Pay now.', errors: { payment: ['…'] } } },
    })
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=success&provider=paypal&token=5O190127TN364715T', path: '/order-confirmation/:orderId' })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { name: "PayPal didn't complete the payment" })).toBeInTheDocument()
    expect(alert).toHaveTextContent('PayPal declined the payment: INSTRUMENT_DECLINED. You can try again with Pay now. Nothing was charged.')
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument()
    expect(sentTo(fetchMock, '/api/shop/orders/BN-100001/paypal/capture')).toEqual({ token: '5O190127TN364715T', email: 'ava@example.com' })
  })

  it('cancelled on PayPal: nothing charged, Pay now', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: UNPAID } })
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=cancelled&provider=paypal&token=5O190127TN364715T', path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Payment not completed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeInTheDocument()
  })
})

describe('invoice PDFs (§2)', () => {
  const PDF_HEADERS = { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="INV-100001.pdf"' }
  /** mockFetch answers JSON only: PDF paths get a PDF instead. */
  function withPdf(fetchMock) {
    const json = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (input, init = {}) =>
      new URL(input).pathname.endsWith('.pdf') ? new Response('%PDF-1.7', { status: 200, headers: PDF_HEADERS }) : json(input, init),
    )
    return fetchMock
  }
  function captureDownloads() {
    URL.createObjectURL = vi.fn(() => 'blob:buynest')
    URL.revokeObjectURL = vi.fn()
    const saved = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordClick() {
      saved.push(this.download)
    })
    return saved
  }

  it('the invoice page downloads the server’s PDF next to Print', async () => {
    signIn()
    const saved = captureDownloads()
    const invoice = { number: 'INV-100001', orderNumber: 'BN-100001', amount: 24.97, createdAt: '2026-11-10T10:00:00Z', billingAddress: ADDRESS, items: [LINE(MASCARA_ITEM)], totals: TOTALS(24.97) }
    const fetchMock = withPdf(mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001/invoices/INV-100001': { body: invoice } }))
    const user = userEvent.setup()
    renderWithProviders(<InvoicePage />, { route: '/account/orders/BN-100001/invoices/INV-100001', path: '/account/orders/:orderId/invoices/:invoiceNumber' })
    await screen.findByRole('heading', { name: 'Invoice INV-100001' })
    await user.click(await screen.findByRole('button', { name: 'Download PDF of invoice INV-100001' }))
    await waitFor(() => expect(saved).toEqual(['INV-100001.pdf']))
    expect(await URL.createObjectURL.mock.calls[0][0].text()).toBe('%PDF-1.7')
    const pdfCall = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/api/shop/orders/BN-100001/invoices/INV-100001.pdf')
    expect(pdfCall[1].method).toBe('GET')
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
  })

  it('a guest downloads from order tracking with the email that found the order; errors are announced', async () => {
    const saved = captureDownloads()
    const documented = ORDER({ paymentStatus: 'paid', invoices: [{ number: 'INV-100001', amount: 24.97, createdAt: '2026-11-10T10:00:00Z' }] })
    let pdfs = 0
    const fetchMock = mockFetch({ 'POST /api/shop/orders/lookup': { body: documented } })
    const json = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (input, init = {}) => {
      if (!new URL(input).pathname.endsWith('.pdf')) return json(input, init)
      return ++pdfs === 1
        ? new Response('%PDF-1.7', { status: 200, headers: PDF_HEADERS })
        : new Response(JSON.stringify({ message: 'Too many requests.' }), { status: 429, headers: { 'Content-Type': 'application/json' } })
    })
    const user = userEvent.setup()
    renderWithProviders(<TrackOrderPage />, { route: '/track-order', path: '/track-order' })
    await user.type(screen.getByLabelText('Order number'), 'BN-100001')
    await user.type(screen.getByLabelText('Email'), 'ava@example.com')
    await user.click(screen.getByRole('button', { name: 'Find my order' }))
    const button = await screen.findByRole('button', { name: 'Download PDF of invoice INV-100001' })
    await user.click(button)
    await waitFor(() => expect(saved).toEqual(['INV-100001.pdf']))
    const pdfCall = fetchMock.mock.calls.find(([url]) => new URL(url).pathname.endsWith('.pdf'))
    expect(pdfCall[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ email: 'ava@example.com' }) })
    await user.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests.')
  })
})

describe('cookie consent and statistics (§6)', () => {
  const renderLayout = () =>
    renderWithProviders(<MainLayout />, { route: '/', path: '/' })
  const gtagScripts = () => document.querySelectorAll('script[src^="https://www.googletagmanager.com/"]')

  it('without VITE_ANALYTICS=ga4 there is no banner and no "Cookie settings", even with a measurement id', async () => {
    mockFetch({ ...CATALOG(STORE({ ga4_measurement_id: 'G-TEST12345' })) })
    renderLayout()
    expect(await screen.findByRole('link', { name: 'Check gift card balance' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Cookies and visitor statistics' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cookie settings' })).not.toBeInTheDocument()
  })

  describe('with VITE_ANALYTICS=ga4 and a measurement id', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('asks first and loads nothing before Accept; Accept loads gtag.js and sends the page view', async () => {
      vi.stubEnv('VITE_ANALYTICS', 'ga4')
      mockFetch({ ...CATALOG(STORE({ ga4_measurement_id: 'G-TEST12345' })) })
      const user = userEvent.setup()
      renderLayout()
      const banner = await screen.findByRole('region', { name: 'Cookies and visitor statistics' })
      const buttons = within(banner).getAllByRole('button')
      expect(buttons.map((button) => button.textContent)).toEqual(['Accept all', 'Reject', 'Settings'])
      expect(new Set(buttons.map((button) => button.className)).size).toBe(1) // equal prominence
      expect(gtagScripts()).toHaveLength(0)
      expect(window.dataLayer).toBeUndefined()

      // Keyboard: the banner comes right after the skip link, and nothing traps the focus.
      await user.tab()
      expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
      await user.tab()
      await user.tab()
      expect(within(banner).getByRole('button', { name: 'Accept all' })).toHaveFocus()

      await user.click(within(banner).getByRole('button', { name: 'Accept all' }))
      expect(screen.queryByRole('region', { name: 'Cookies and visitor statistics' })).not.toBeInTheDocument()
      expect(gtagScripts()).toHaveLength(1)
      expect(document.cookie).toContain('buynest_consent=v1.statistics=granted')
      await waitFor(() => expect(window.dataLayer.map((entry) => Array.from(entry)).some(([type, name]) => type === 'event' && name === 'page_view')).toBe(true))
    })

    it('Reject loads nothing; Settings has Statistics off; "Cookie settings" in the footer reopens it', async () => {
      vi.stubEnv('VITE_ANALYTICS', 'ga4')
      mockFetch({ ...CATALOG(STORE({ ga4_measurement_id: 'G-TEST12345' })) })
      const user = userEvent.setup()
      renderLayout()
      const banner = await screen.findByRole('region', { name: 'Cookies and visitor statistics' })
      await user.click(within(banner).getByRole('button', { name: 'Settings' }))
      const statistics = within(banner).getByRole('checkbox', { name: 'Statistics' })
      expect(statistics).not.toBeChecked()
      expect(statistics).toHaveFocus()
      await user.click(within(banner).getByRole('button', { name: 'Reject' }))
      expect(gtagScripts()).toHaveLength(0)
      expect(document.cookie).toContain('buynest_consent=v1.statistics=denied')

      await user.click(screen.getByRole('button', { name: 'Cookie settings' }))
      const reopened = await screen.findByRole('region', { name: 'Cookies and visitor statistics' })
      expect(within(reopened).getByRole('heading', { name: 'Cookies and visitor statistics' })).toHaveFocus()
      await user.click(within(reopened).getByRole('checkbox', { name: 'Statistics' }))
      await user.click(within(reopened).getByRole('button', { name: 'Save choices' }))
      expect(gtagScripts()).toHaveLength(1)
    })

    it('a saved choice isn’t asked again', async () => {
      vi.stubEnv('VITE_ANALYTICS', 'ga4')
      document.cookie = 'buynest_consent=v1.statistics=denied; Path=/'
      mockFetch({ ...CATALOG(STORE({ ga4_measurement_id: 'G-TEST12345' })) })
      renderLayout()
      expect(await screen.findByRole('button', { name: 'Cookie settings' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Cookies and visitor statistics' })).not.toBeInTheDocument()
      expect(gtagScripts()).toHaveLength(0)
    })
  })
})
