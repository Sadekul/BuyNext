import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import CheckoutPage from './CheckoutPage'
import OrderConfirmationPage from './OrderConfirmationPage'
import OrdersPage from './OrdersPage'
import OrderDetailsPage from './OrderDetailsPage'
import TrackOrderPage from './TrackOrderPage'
import CartPage from './CartPage'
import InvoicePage from './InvoicePage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'

// These screens with BuyNest's API for orders (VITE_API_PROVIDER=laravel + VITE_ACCOUNTS_BACKEND=laravel).
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const MASCARA = { productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 't.webp', price: 9.99, discountPercentage: 10.48, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 2 }
const TOTALS = { itemCount: 2, subtotal: 17.88, discount: 0, shipping: 4.99, tax: 0, total: 22.87 }
const LINE = { productId: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 9.99, discountPercentage: 10.48, salePrice: 8.94, quantity: 2, lineTotal: 17.88 }
const CART = {
  lines: [{ ...LINE, stock: 99, minimumOrderQuantity: 1, available: true }],
  problems: [],
  coupon: null,
  couponError: null,
  shippingOptions: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 4.99 }],
  totals: TOTALS,
}
const ADDRESS = { firstName: 'Ava', lastName: 'Guest', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' }
const ORDER = {
  number: 'BN-100001', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod', shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' },
  email: 'ava@example.com', phone: '+15550100100', shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null, items: [LINE], totals: TOTALS,
  placedAt: '2026-11-10T09:41:02Z', history: [{ status: 'processing', paymentStatus: 'unpaid', note: 'Order placed.', createdAt: '2026-11-10T09:41:02Z' }],
}
// The cart and wishlist re-check product data on arrival (the DummyJSON catalog in unit tests).
const CATALOG = { 'GET /products': { body: { products: [{ ...MASCARA, id: 1 }], total: 1, skip: 0, limit: 1 } } }

const seedCart = () => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items: [MASCARA], couponCode: null }))
const sent = (fetchMock, path) => JSON.parse(fetchMock.mock.calls.find(([url]) => new URL(url).pathname === path)[1].body)

const checkoutRoutes = <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />

async function fillGuestCheckout(user) {
  await screen.findByLabelText('Email') // the form appears once the store settings are in
  const fields = { Email: 'ava@example.com', Phone: '+1 555 010 0100', 'First name': 'Ava', 'Last name': 'Guest', 'Street address': '12 Market Street', City: 'Springfield', 'State / region': 'Oregon', 'Postal code': '29112' }
  for (const [label, value] of Object.entries(fields)) await user.type(screen.getByLabelText(label), value)
}

describe('guest checkout with server prices', () => {
  it('lets a guest check out: sends ids and quantities only, then confirms the order', async () => {
    seedCart()
    const fetchMock = mockFetch({ ...CATALOG, 'POST /api/shop/cart/validate': { body: CART }, 'POST /api/shop/orders': { status: 201, body: ORDER } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: checkoutRoutes })

    // Not sent to the sign-in page: guests can buy.
    expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    const place = await screen.findByRole('button', { name: 'Place order · $22.87' })
    expect(sent(fetchMock, '/api/shop/cart/validate')).toEqual({ items: [{ productId: 1, quantity: 2 }], couponCode: null, shippingMethod: 'standard' })

    await fillGuestCheckout(user)
    await user.click(place)

    expect(await screen.findByRole('heading', { name: 'Thank you, Ava!' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your order BN-100001 is confirmed. We\'ve emailed a confirmation to ava@example.com.')
    expect(screen.getByRole('link', { name: 'Track your order' })).toBeInTheDocument()
    const order = sent(fetchMock, '/api/shop/orders')
    expect(order).toMatchObject({ items: [{ productId: 1, quantity: 2 }], email: 'ava@example.com', phone: '+15550100100', paymentMethod: 'cod', billingAddress: null, expectedTotal: 22.87 })
    expect(JSON.stringify(order.items)).not.toMatch(/price/i)
    expect(JSON.parse(window.localStorage.getItem('buynest.cart.v1')).items).toEqual([]) // the cart was emptied
  })

  it('tells the shopper honestly that card payments wait for a payment provider', async () => {
    seedCart()
    mockFetch({ ...CATALOG, 'POST /api/shop/cart/validate': { body: CART } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await user.click(await screen.findByRole('radio', { name: /Credit or debit card/ }))
    expect(screen.getByText(/No payment provider is connected yet, so nothing is charged now/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /card/i })).not.toBeInTheDocument() // never any card fields
  })

  it('shows new prices when they changed (409) and does not place the order', async () => {
    seedCart()
    const newCart = { ...CART, totals: { ...TOTALS, subtotal: 19.98, total: 24.97 } }
    mockFetch({ ...CATALOG, 'POST /api/shop/cart/validate': { body: CART }, 'POST /api/shop/orders': { status: 409, body: { message: 'Prices changed', code: 'prices_changed', cart: newCart } } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: checkoutRoutes })
    await fillGuestCheckout(user)
    await user.click(await screen.findByRole('button', { name: 'Place order · $22.87' }))

    expect(await screen.findByText(/Prices changed since you added these items/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place order · $24.97' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Thank you/ })).not.toBeInTheDocument()
  })

  it("shows the server's field errors on the form (422)", async () => {
    seedCart()
    mockFetch({
      ...CATALOG,
      'POST /api/shop/cart/validate': { body: CART },
      'POST /api/shop/orders': { status: 422, body: { message: 'Invalid', errors: { 'shippingAddress.postalCode': ['We do not ship to this postal code.'] } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await fillGuestCheckout(user)
    await user.click(await screen.findByRole('button', { name: 'Place order · $22.87' }))
    expect(await screen.findByText('We do not ship to this postal code.')).toBeInTheDocument()
    expect(screen.getByLabelText('Postal code')).toHaveAttribute('aria-invalid', 'true')
  })

  it('blocks the order while the server reports a stock problem', async () => {
    seedCart()
    mockFetch({ ...CATALOG, 'POST /api/shop/cart/validate': { body: { ...CART, problems: [{ productId: 1, code: 'insufficient_stock', message: 'Only 1 Mascara left.' }] } } })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByText('Only 1 Mascara left.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Place order/ })).toBeDisabled()
  })
})

describe('orders from the server', () => {
  const signIn = () => {
    document.cookie = 'buynest_session=session; Path=/'
    window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
  }
  const ME = { 'GET /api/auth/me': { body: { id: 5, firstName: 'Nadia', email: 'nadia@example.com', role: 'customer' } } }

  it('lists the signed-in customer’s orders with their status as icon and words', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/orders': { body: { orders: [{ ...ORDER, status: 'shipped' }], total: 1, page: 1, perPage: 10, lastPage: 1 } } })
    renderWithProviders(<OrdersPage />, { route: '/account/orders', path: '/account/orders' })
    const row = (await screen.findByRole('link', { name: 'Order BN-100001' })).closest('li')
    expect(within(row).getByText('Shipped')).toBeInTheDocument()
    expect(within(row).getByText('$22.87')).toBeInTheDocument()
    expect(screen.queryByText(/saved on this device/)).not.toBeInTheDocument()
  })

  it('shows one order with its history, and "not found" for someone else’s', async () => {
    signIn()
    mockFetch({
      ...ME,
      'GET /api/shop/orders/BN-100001': { body: { ...ORDER, history: [...ORDER.history, { status: 'shipped', paymentStatus: 'unpaid', note: 'Tracking 1Z999', createdAt: '2026-11-11T10:00:00Z' }] } },
      'GET /api/shop/orders/BN-100002': { status: 404, body: { message: 'Not found' } },
    })
    const { unmount } = renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100001', path: '/account/orders/:orderId' })
    const history = await screen.findByRole('list', { name: 'Order history' })
    expect(within(history).getByText('Tracking 1Z999')).toBeInTheDocument()
    expect(within(history).getByText('Shipped')).toBeInTheDocument()
    expect(screen.getByText('Pay the courier when your order arrives.')).toBeInTheDocument()
    unmount()

    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100002', path: '/account/orders/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument()
  })

  it('a guest opening a confirmation link without the order is sent to order tracking', async () => {
    mockFetch({})
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001', path: '/order-confirmation/:orderId' })
    expect(screen.getByRole('heading', { name: 'Order not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Track your order' })).toHaveAttribute('href', '/track-order')
  })
})

describe('track your order (guests)', () => {
  it('checks the fields, then finds the order by number and email', async () => {
    let found = false
    const fetchMock = mockFetch({
      'POST /api/shop/orders/lookup': () =>
        found ? { body: { ...ORDER, status: 'pending_payment', paymentMethod: 'paypal' } } : { status: 404, body: { message: "We couldn't find an order with that number and email." } },
    })
    const user = userEvent.setup()
    renderWithProviders(<TrackOrderPage />, { route: '/track-order', path: '/track-order' })

    await user.click(screen.getByRole('button', { name: 'Find my order' }))
    expect(screen.getByLabelText('Order number')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Order number'), 'bn100001')
    await user.type(screen.getByLabelText('Email'), 'ava@example.com')
    await user.click(screen.getByRole('button', { name: 'Find my order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't find an order with that number and email.")
    expect(sent(fetchMock, '/api/shop/orders/lookup')).toEqual({ number: 'BN-100001', email: 'ava@example.com' })

    found = true
    await user.click(screen.getByRole('button', { name: 'Find my order' }))
    const heading = await screen.findByRole('heading', { name: 'Order BN-100001' })
    expect(heading).toHaveFocus()
    expect(screen.getAllByText('Awaiting payment').length).toBeGreaterThan(0)
    expect(screen.getByText(/Nothing has been charged/)).toBeInTheDocument()
  })
})

describe('coupons decided by the server', () => {
  it('the cart asks the server about a code and shows its answer, with no local coupon table', async () => {
    seedCart()
    const fetchMock = mockFetch({
      ...CATALOG,
      'POST /api/shop/cart/validate': (url, init) => {
        const { couponCode } = JSON.parse(init.body)
        if (couponCode === 'NEST10') return { body: { ...CART, coupon: null, couponError: 'This code has expired.' } }
        if (couponCode === 'WINTER5') return { body: { ...CART, coupon: { code: 'WINTER5', description: '$5 off' }, totals: { ...TOTALS, discount: 5, total: 17.87 } } }
        return { body: CART }
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<CartPage />, { route: '/cart', path: '/cart' })
    expect(await screen.findByText('Codes are checked by our server.')).toBeInTheDocument()

    // NEST10 is in the demo table; here only the server's answer counts.
    await user.type(screen.getByLabelText('Discount code'), 'NEST10')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText(/This code has expired\./, { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText(/Discount \(NEST10\)/)).not.toBeInTheDocument()
    expect(sent(fetchMock, '/api/shop/cart/validate')).toMatchObject({ couponCode: null })

    await user.click(screen.getByRole('button', { name: 'Remove code NEST10' }))
    await user.type(screen.getByLabelText('Discount code'), 'winter5')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Discount (WINTER5)')).toBeInTheDocument()
    expect(screen.getByText('$17.87')).toBeInTheDocument()
    const bodies = fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/api/shop/cart/validate').map(([, init]) => JSON.parse(init.body))
    expect(bodies.at(-1)).toMatchObject({ couponCode: 'WINTER5', shippingMethod: 'standard' })
  })

  it("checkout sends a guest's email with the pricing request, so per-customer limits apply", async () => {
    window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items: [MASCARA], couponCode: 'NEST10' }))
    const fetchMock = mockFetch({
      ...CATALOG,
      'POST /api/shop/cart/validate': (url, init) =>
        JSON.parse(init.body).email ? { body: { ...CART, coupon: null, couponError: "You've already used this code." } } : { body: { ...CART, coupon: { code: 'NEST10', description: '10% off' } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByText(/10% off/, { selector: 'span' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), 'ava@example.com')
    expect(await screen.findByText(/You've already used this code\./, { selector: 'span' }, { timeout: 3000 })).toBeInTheDocument()
    const withEmail = fetchMock.mock.calls.map(([, init]) => init?.body && JSON.parse(init.body)).filter((body) => body?.email)
    expect(withEmail).toHaveLength(1) // debounced: one request, not one per keystroke
    expect(withEmail[0]).toMatchObject({ couponCode: 'NEST10', email: 'ava@example.com' })
  })
})

describe('shipments, invoices, and refunds', () => {
  const signIn = () => {
    document.cookie = 'buynest_session=session; Path=/'
    window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
  }
  const ME = { 'GET /api/auth/me': { body: { id: 5, firstName: 'Nadia', email: 'nadia@example.com', role: 'customer' } } }
  const DOCUMENTED = {
    ...ORDER,
    status: 'closed',
    paymentStatus: 'refunded',
    totals: { ...TOTALS, paid: 22.87, refunded: 22.87 },
    shipments: [{ number: 'SHP-100001', carrier: 'ups', carrierLabel: 'UPS', trackingNumber: '1Z999', trackingUrl: 'https://www.ups.com/track?tracknum=1Z999', createdAt: '2026-11-11T10:00:00Z' }],
    invoices: [{ number: 'INV-100001', amount: 22.87, createdAt: '2026-11-10T10:00:00Z' }],
    creditMemos: [{ number: 'CM-100001', total: 22.87, createdAt: '2026-11-12T10:00:00Z' }],
  }

  it('shows tracking (new tab), invoices linked to their printable page, and refunds with the new statuses', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: DOCUMENTED } })
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100001', path: '/account/orders/:orderId' })
    const track = await screen.findByRole('link', { name: /Track with UPS/ })
    expect(track).toHaveAttribute('href', 'https://www.ups.com/track?tracknum=1Z999')
    expect(track).toHaveAttribute('target', '_blank')
    expect(track.getAttribute('rel')).toMatch(/noopener/)
    expect(track).toHaveTextContent('(opens in a new tab)')
    expect(screen.getByText(/tracking number 1Z999/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Invoice INV-100001' })).toHaveAttribute('href', '/account/orders/BN-100001/invoices/INV-100001')
    expect(screen.getByText('Refund CM-100001')).toBeInTheDocument()
    expect(screen.getAllByText('Closed (refunded)').length).toBeGreaterThan(0)
    expect(screen.getByText('Refunded', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/refunded in full/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Order status' })).not.toBeInTheDocument() // no steps left
  })

  it('guests see the documents but no invoice link (invoices need the account)', async () => {
    mockFetch({ 'POST /api/shop/orders/lookup': { body: DOCUMENTED } })
    const user = userEvent.setup()
    renderWithProviders(<TrackOrderPage />, { route: '/track-order', path: '/track-order' })
    await user.type(screen.getByLabelText('Order number'), 'BN-100001')
    await user.type(screen.getByLabelText('Email'), 'ava@example.com')
    await user.click(screen.getByRole('button', { name: 'Find my order' }))
    expect(await screen.findByText('Invoice INV-100001')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Invoice INV-100001' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Track with UPS/ })).toBeInTheDocument()
  })

  it('the printable invoice shows the bill-to address, items, totals, and prints', async () => {
    signIn()
    const invoice = { number: 'INV-100001', orderNumber: 'BN-100001', amount: 22.87, createdAt: '2026-11-10T10:00:00Z', billingAddress: ADDRESS, items: [LINE], totals: TOTALS }
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001/invoices/INV-100001': { body: invoice }, 'GET /api/shop/orders/BN-100001/invoices/INV-100002': { status: 404, body: { message: 'Not found' } } })
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const user = userEvent.setup()
    const { unmount } = renderWithProviders(<InvoicePage />, { route: '/account/orders/BN-100001/invoices/INV-100001', path: '/account/orders/:orderId/invoices/:invoiceNumber' })
    expect(await screen.findByRole('heading', { name: 'Invoice INV-100001' })).toBeInTheDocument()
    expect(screen.getByText('12 Market Street', { exact: false })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Items on invoice INV-100001' })
    expect(within(table).getByText('Mascara')).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Amount paid/ })).toHaveTextContent('$22.87')
    expect(screen.getByRole('link', { name: 'Order BN-100001' })).toHaveAttribute('href', '/account/orders/BN-100001')
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalled()
    unmount()

    renderWithProviders(<InvoicePage />, { route: '/account/orders/BN-100001/invoices/INV-100002', path: '/account/orders/:orderId/invoices/:invoiceNumber' })
    expect(await screen.findByRole('heading', { name: 'Invoice not found' })).toBeInTheDocument()
  })
})
