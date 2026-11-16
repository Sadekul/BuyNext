import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import AddressBookPage from './AddressBookPage'
import CartPage from './CartPage'
import CheckoutPage from './CheckoutPage'
import OrderConfirmationPage from './OrderConfirmationPage'
import OrderDetailsPage from './OrderDetailsPage'
import ReturnsPage from './ReturnsPage'
import ReturnDetailsPage from './ReturnDetailsPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'

// Phase 6 screens with BuyNest's API: address book, saved addresses at checkout, group prices, returns.
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
}
const NADIA = { id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', role: 'customer' }
const ME = { 'GET /api/auth/me': { body: NADIA } }
const STORE = {
  'GET /api/catalog/store': {
    body: {
      data: {
        store_name: 'BuyNest', shipping_methods: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: '4.99' }], free_shipping_threshold: '50.00',
        allowed_countries: ['United States', 'Bangladesh'], payment_methods: ['cod'], guest_checkout: true, tax_enabled: false,
      },
    },
  },
}
const HOME = { id: 7, firstName: 'Nadia', lastName: 'Rahman', phone: '+8801712345678', company: '', line1: '12 Lake Road', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1212', country: 'Bangladesh', isDefaultShipping: true, isDefaultBilling: false }
const OFFICE = { ...HOME, id: 8, company: 'Nest Ltd', line1: '4 Office Park', city: 'Chattogram', state: 'Chattogram', postalCode: '4000', isDefaultShipping: false, isDefaultBilling: true }

const lastSent = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === path && (init?.method ?? 'GET') === method).at(-1)
  return call && JSON.parse(call[1].body)
}

describe('address book', () => {
  it('lists saved addresses with their defaults', async () => {
    signIn()
    mockFetch({ ...ME, ...STORE, 'GET /api/shop/me/addresses': { body: { addresses: [HOME, OFFICE] } } })
    renderWithProviders(<AddressBookPage />, { route: '/account/addresses', path: '/account/addresses' })
    const cards = await screen.findAllByRole('listitem')
    expect(within(cards[0]).getByText('Default shipping')).toBeInTheDocument()
    expect(within(cards[0]).getByRole('button', { name: 'Set as default billing' })).toBeInTheDocument()
    expect(within(cards[1]).getByText('Default billing')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Nest Ltd')).toBeInTheDocument()
  })

  it('shows an empty state, then adds an address with the store’s countries and shows server field errors', async () => {
    signIn()
    let saved = false
    const fetchMock = mockFetch({
      ...ME,
      ...STORE,
      'GET /api/shop/me/addresses': () => ({ body: { addresses: saved ? [HOME] : [] } }),
      'POST /api/shop/me/addresses': (url, init) => {
        if (JSON.parse(init.body).postalCode === '99') return { status: 422, body: { message: 'Invalid', errors: { postalCode: ['The postal code is invalid.'] } } }
        saved = true
        return { status: 201, body: HOME }
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<AddressBookPage />, { route: '/account/addresses', path: '/account/addresses' })
    await user.click(await screen.findByRole('button', { name: 'Add your first address' }))

    const form = screen.getByRole('form', { name: 'Add an address' })
    expect(within(form).getByLabelText('First name')).toHaveValue('Nadia')
    expect(within(form).getAllByRole('option').map((option) => option.textContent)).toEqual(['United States', 'Bangladesh'])
    expect(within(form).getByLabelText('Use as my default shipping address')).toBeChecked() // the first address is the default

    await user.click(within(form).getByRole('button', { name: 'Add address' }))
    expect(within(form).getByLabelText('Street address')).toHaveAccessibleDescription('Enter a street address.')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    await user.type(within(form).getByLabelText('Street address'), '12 Lake Road')
    await user.type(within(form).getByLabelText('City'), 'Dhaka')
    await user.type(within(form).getByLabelText('State / region'), 'Dhaka')
    await user.type(within(form).getByLabelText('Postal code'), '99')
    await user.selectOptions(within(form).getByLabelText('Country'), 'Bangladesh')
    await user.click(within(form).getByRole('button', { name: 'Add address' }))
    // 99 is too short for the form itself; the server's message is tested with a valid-looking code.
    expect(within(form).getByLabelText('Postal code')).toHaveAttribute('aria-invalid', 'true')

    await user.clear(within(form).getByLabelText('Postal code'))
    await user.type(within(form).getByLabelText('Postal code'), '1212')
    await user.click(within(form).getByRole('button', { name: 'Add address' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Address added to your address book.')
    expect(lastSent(fetchMock, 'POST', '/api/shop/me/addresses')).toMatchObject({ line1: '12 Lake Road', postalCode: '1212', country: 'Bangladesh', phone: '+8801712345678', isDefaultShipping: true })
    expect(await screen.findByText('12 Lake Road')).toBeInTheDocument()
  })

  it("puts the server's 422 messages on the matching fields", async () => {
    signIn()
    mockFetch({
      ...ME,
      ...STORE,
      'GET /api/shop/me/addresses': { body: { addresses: [HOME] } },
      'PATCH /api/shop/me/addresses/7': { status: 422, body: { message: 'Invalid', errors: { country: ["We don't deliver to that country yet."] } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<AddressBookPage />, { route: '/account/addresses', path: '/account/addresses' })
    await user.click(await screen.findByRole('button', { name: 'Edit the address for Nadia Rahman, 12 Lake Road' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText("We don't deliver to that country yet.")).toBeInTheDocument()
    expect(screen.getByLabelText('Country')).toHaveAttribute('aria-invalid', 'true')
  })

  it('makes an address the default billing one, and deletes after confirming', async () => {
    signIn()
    const fetchMock = mockFetch({
      ...ME,
      ...STORE,
      'GET /api/shop/me/addresses': { body: { addresses: [HOME, OFFICE] } },
      'PATCH /api/shop/me/addresses/7': { body: { ...HOME, isDefaultBilling: true } },
      'DELETE /api/shop/me/addresses/8': { body: { ok: true } },
    })
    const user = userEvent.setup()
    renderWithProviders(<AddressBookPage />, { route: '/account/addresses', path: '/account/addresses' })
    await user.click(await screen.findByRole('button', { name: 'Set as default billing' }))
    expect(await screen.findByText('Default billing address changed.')).toBeInTheDocument()
    expect(lastSent(fetchMock, 'PATCH', '/api/shop/me/addresses/7')).toEqual({ isDefaultBilling: true })

    await user.click(screen.getByRole('button', { name: 'Delete the address for Nadia Rahman, 4 Office Park' }))
    const confirm = screen.getByRole('group', { name: 'Delete the address for Nadia Rahman?' })
    await user.click(within(confirm).getByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByText('Address deleted.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => new URL(url).pathname === '/api/shop/me/addresses/8' && init.method === 'DELETE')).toBe(true)
  })

  it('shows an error with a retry when the addresses cannot be loaded', async () => {
    signIn()
    mockFetch({ ...ME, ...STORE, 'GET /api/shop/me/addresses': { status: 500, body: { message: 'Server down' } } })
    renderWithProviders(<AddressBookPage />, { route: '/account/addresses', path: '/account/addresses' })
    expect(await screen.findByRole('heading', { name: "We couldn't load your addresses" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

const MASCARA = { productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 't.webp', price: 10, discountPercentage: 0, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 2 }
const CATALOG = { 'GET /products': { body: { products: [{ ...MASCARA, id: 1 }], total: 1, skip: 0, limit: 1 } } }
const WHOLESALE = { name: 'Wholesale', discountPercent: 10 }
const GROUP_CART = {
  lines: [{ productId: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 10, discountPercentage: 0, salePrice: 9, baseSalePrice: 10, groupDiscountPercent: 10, quantity: 2, lineTotal: 18, stock: 99, minimumOrderQuantity: 1, available: true }],
  problems: [],
  coupon: null,
  couponError: null,
  shippingOptions: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 4.99 }],
  totals: { itemCount: 2, subtotal: 18, discount: 0, groupDiscount: 2, shipping: 4.99, tax: 0, total: 22.99 },
  customerGroup: WHOLESALE,
}
const seedCart = () => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items: [MASCARA], couponCode: null }))

describe('group prices', () => {
  it('shows the group discount and the server’s line amounts in the cart', async () => {
    signIn()
    seedCart()
    mockFetch({ ...ME, ...STORE, ...CATALOG, 'POST /api/shop/cart/validate': { body: GROUP_CART } })
    renderWithProviders(<CartPage />, { route: '/cart', path: '/cart' })
    expect(await screen.findByText('Wholesale price: 10% off')).toBeInTheDocument()
    expect(screen.getByText(/You save \$2\.00/)).toBeInTheDocument()
    expect(screen.getByText('Includes your 10% group discount')).toBeInTheDocument()
    expect(screen.getByText('$18.00', { selector: '.cart-line__total' })).toBeInTheDocument()
  })

  it('says nothing for a group without a discount', async () => {
    seedCart()
    mockFetch({ ...STORE, ...CATALOG, 'POST /api/shop/cart/validate': { body: { ...GROUP_CART, customerGroup: { name: 'General', discountPercent: 0 } } } })
    renderWithProviders(<CartPage />, { route: '/cart', path: '/cart' })
    await screen.findByRole('heading', { name: 'Shopping cart' })
    await waitFor(() => expect(screen.getByText('$22.99')).toBeInTheDocument())
    expect(screen.queryByText(/price: .*off/)).not.toBeInTheDocument()
  })
})

describe('checkout with the address book', () => {
  const ORDER = {
    number: 'BN-100009', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod', shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' },
    email: 'nadia@example.com', phone: '+8801712345678', shippingAddress: HOME, billingAddress: OFFICE, couponCode: null, items: GROUP_CART.lines, totals: GROUP_CART.totals, placedAt: '2026-11-16T09:41:02Z',
  }
  const routes = <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />

  it('fills in the default addresses, offers the saved ones, and shows the group price', async () => {
    signIn()
    seedCart()
    const fetchMock = mockFetch({
      'GET /api/auth/me': { body: { ...NADIA, group: WHOLESALE } },
      ...STORE,
      ...CATALOG,
      'GET /api/shop/me/addresses': { body: { addresses: [HOME, OFFICE] } },
      'POST /api/shop/cart/validate': { body: GROUP_CART },
      'POST /api/shop/orders': { status: 201, body: ORDER },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: routes })

    const shipping = within(await screen.findByRole('region', { name: 'Shipping address' }))
    expect(shipping.getByLabelText('Street address')).toHaveValue('12 Lake Road')
    expect(shipping.getByLabelText('Saved shipping addresses')).toHaveDisplayValue(/12 Lake Road/)
    // Already in the address book: nothing to save.
    expect(shipping.queryByLabelText('Save this address to my address book')).not.toBeInTheDocument()

    // The default billing address differs, so it is filled in separately.
    const billing = within(screen.getByRole('region', { name: 'Billing address' }))
    expect(billing.getByLabelText('Same as shipping address')).not.toBeChecked()
    expect(billing.getByLabelText('Street address')).toHaveValue('4 Office Park')

    expect(await screen.findByText('Wholesale price: 10% off')).toBeInTheDocument()

    // Choosing another saved address copies it into the fields.
    await user.selectOptions(shipping.getByLabelText('Saved shipping addresses'), '8')
    expect(shipping.getByLabelText('City')).toHaveValue('Chattogram')

    await user.click(await screen.findByRole('button', { name: 'Place order · $22.99' }))
    expect(await screen.findByRole('heading', { name: /Thank you/ })).toBeInTheDocument()
    const order = lastSent(fetchMock, 'POST', '/api/shop/orders')
    expect(order.shippingAddress).toMatchObject({ line1: '4 Office Park', city: 'Chattogram' })
    expect(order).not.toHaveProperty('saveAddress')
  })

  it('offers to save a new address and sends saveAddress when ticked', async () => {
    signIn()
    seedCart()
    const fetchMock = mockFetch({
      ...ME,
      ...STORE,
      ...CATALOG,
      'GET /api/shop/me/addresses': { body: { addresses: [HOME] } },
      'POST /api/shop/cart/validate': { body: GROUP_CART },
      'POST /api/shop/orders': { status: 201, body: ORDER },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: routes })
    const shipping = within(await screen.findByRole('region', { name: 'Shipping address' }))
    await user.clear(shipping.getByLabelText('Street address'))
    await user.type(shipping.getByLabelText('Street address'), '99 New Street')
    expect(shipping.getByLabelText('Saved shipping addresses')).toHaveValue('') // a new address now
    await user.click(shipping.getByLabelText('Save this address to my address book'))

    await user.click(await screen.findByRole('button', { name: 'Place order · $22.99' }))
    expect(await screen.findByRole('heading', { name: /Thank you/ })).toBeInTheDocument()
    expect(lastSent(fetchMock, 'POST', '/api/shop/orders')).toMatchObject({ saveAddress: true, shippingAddress: { line1: '99 New Street' } })
  })
})

describe('returns', () => {
  const ITEM = { productId: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 10, discountPercentage: 0, salePrice: 10, quantity: 3, lineTotal: 30 }
  const ORDER = {
    number: 'BN-100001', status: 'delivered', paymentStatus: 'paid', paymentMethod: 'cod', shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' },
    email: 'nadia@example.com', phone: '+8801712345678', shippingAddress: HOME, billingAddress: HOME, couponCode: null, items: [ITEM, { ...ITEM, productId: 2, sku: 'BEA-2', title: 'Lipstick' }],
    totals: { itemCount: 6, subtotal: 60, discount: 0, shipping: 0, tax: 0, total: 60 }, placedAt: '2026-11-10T09:41:02Z',
    history: [{ status: 'delivered', paymentStatus: 'paid', note: 'Return RMA-100001 approved. Please use the prepaid label.', createdAt: '2026-11-15T09:00:00Z' }],
    shipments: [], invoices: [], creditMemos: [],
    returns: [{ number: 'RMA-100001', status: 'approved', createdAt: '2026-11-14T09:00:00Z' }],
    returnEligibility: {
      eligible: true, code: null, message: null, deadline: '2026-12-15T09:00:00Z', windowDays: 30, reasons: ['Damaged', 'Wrong item', 'Other'],
      items: [
        { orderItemId: 11, title: 'Mascara', variantLabel: null, sku: 'BEA-1', thumbnail: 't.webp', ordered: 3, returnable: 2 },
        { orderItemId: 12, title: 'Lipstick', variantLabel: null, sku: 'BEA-2', thumbnail: 't.webp', ordered: 3, returnable: 0 },
      ],
    },
  }
  const RETURN = {
    number: 'RMA-100002', orderNumber: 'BN-100001', status: 'requested', reason: 'Damaged', resolution: null, itemsCount: 2, createdAt: '2026-11-16T10:00:00Z',
    items: [{ id: 1, orderItemId: 11, title: 'Mascara', variantLabel: null, thumbnail: 't.webp', quantity: 2, condition: null }], comment: null, message: null, order: null, refund: null,
  }
  const page = () => renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100001', path: '/account/orders/:orderId' })

  it('lets the customer return only what can still be returned, and checks the form first', async () => {
    signIn()
    const fetchMock = mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: ORDER }, 'POST /api/shop/orders/BN-100001/returns': { status: 201, body: RETURN } })
    const user = userEvent.setup()
    page()
    expect(await screen.findByRole('link', { name: 'Return RMA-100001' })).toHaveAttribute('href', '/account/returns/RMA-100001')
    expect(screen.getByText(/You can ask to return items until/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Request a return' }))

    const mascara = screen.getByLabelText('Quantity of Mascara to return')
    expect(within(mascara).getAllByRole('option').map((option) => option.value)).toEqual(['0', '1', '2'])
    expect(screen.queryByLabelText('Quantity of Lipstick to return')).not.toBeInTheDocument() // nothing left to return
    expect(within(screen.getByLabelText('Reason')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a reason', 'Damaged', 'Wrong item', 'Other'])

    await user.click(screen.getByRole('button', { name: 'Send return request' }))
    expect(screen.getByText('Choose at least one item to return.')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toHaveAccessibleDescription('Choose a reason for the return.')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    await user.selectOptions(mascara, '2')
    await user.selectOptions(screen.getByLabelText('Reason'), 'Damaged')
    await user.type(screen.getByLabelText('Comment (optional)'), 'The cap was cracked.')
    await user.click(screen.getByRole('button', { name: 'Send return request' }))

    expect(await screen.findByText(/Return RMA-100002 was requested/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the return' })).toHaveAttribute('href', '/account/returns/RMA-100002')
    expect(lastSent(fetchMock, 'POST', '/api/shop/orders/BN-100001/returns')).toEqual({ items: [{ orderItemId: 11, quantity: 2 }], reason: 'Damaged', comment: 'The cap was cracked.' })
  })

  it("shows the server's quantity error on that item's picker", async () => {
    signIn()
    mockFetch({
      ...ME,
      'GET /api/shop/orders/BN-100001': { body: ORDER },
      'POST /api/shop/orders/BN-100001/returns': { status: 422, body: { message: 'Invalid', errors: { 'items.0.quantity': ['Only 1 of Mascara can be returned.'] } } },
    })
    const user = userEvent.setup()
    page()
    await user.click(await screen.findByRole('button', { name: 'Request a return' }))
    await user.selectOptions(screen.getByLabelText('Quantity of Mascara to return'), '2')
    await user.selectOptions(screen.getByLabelText('Reason'), 'Other')
    await user.click(screen.getByRole('button', { name: 'Send return request' }))
    await waitFor(() => expect(screen.getByLabelText('Quantity of Mascara to return')).toHaveAccessibleDescription('Only 1 of Mascara can be returned.'))
  })

  it('explains why an order cannot be returned', async () => {
    signIn()
    mockFetch({
      ...ME,
      'GET /api/shop/orders/BN-100001': {
        body: { ...ORDER, returns: [], returnEligibility: { ...ORDER.returnEligibility, eligible: false, code: 'window_closed', message: 'The return window for this order closed on December 15, 2026.' } },
      },
    })
    page()
    expect(await screen.findByText('The return window for this order closed on December 15, 2026.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request a return' })).not.toBeInTheDocument()
  })

  it('lists returns, and shows one with its status, items, message, and history', async () => {
    signIn()
    mockFetch({
      ...ME,
      'GET /api/shop/returns': { body: { returns: [{ ...RETURN, status: 'approved' }], total: 1, page: 1, perPage: 10, lastPage: 1 } },
      'GET /api/shop/returns/RMA-100001': { body: { ...RETURN, number: 'RMA-100001', status: 'approved', message: 'Please use the prepaid label.' } },
      'GET /api/shop/orders/BN-100001': { body: ORDER },
    })
    const { unmount } = renderWithProviders(<ReturnsPage />, { route: '/account/returns', path: '/account/returns' })
    const row = (await screen.findByRole('link', { name: 'Return RMA-100002' })).closest('li')
    expect(within(row).getByText('Approved')).toBeInTheDocument()
    expect(within(row).getByText(/Order BN-100001 · 2 items/)).toBeInTheDocument()
    unmount()

    renderWithProviders(<ReturnDetailsPage />, { route: '/account/returns/RMA-100001', path: '/account/returns/:returnNumber' })
    expect(await screen.findByRole('heading', { name: 'Return RMA-100001' })).toBeInTheDocument()
    expect(screen.getByText(/Your return was approved/)).toBeInTheDocument()
    expect(screen.getByText('Please use the prepaid label.')).toBeInTheDocument()
    expect(screen.getByText('× 2')).toBeInTheDocument()
    const history = await screen.findByRole('list', { name: 'Return history' })
    expect(within(history).getByText('Return RMA-100001 approved. Please use the prepaid label.')).toBeInTheDocument()
  })

  it('shows an empty state without returns, and "not found" for someone else’s', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/returns': { body: { returns: [], total: 0, page: 1, perPage: 10, lastPage: 1 } }, 'GET /api/shop/returns/RMA-100009': { status: 404, body: { message: 'Not found' } } })
    const { unmount } = renderWithProviders(<ReturnsPage />, { route: '/account/returns', path: '/account/returns' })
    expect(await screen.findByRole('heading', { name: 'No returns' })).toBeInTheDocument()
    unmount()
    renderWithProviders(<ReturnDetailsPage />, { route: '/account/returns/RMA-100009', path: '/account/returns/:returnNumber' })
    expect(await screen.findByRole('heading', { name: 'Return not found' })).toBeInTheDocument()
  })
})
