import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import CheckoutPage from './CheckoutPage'
import CartPage from './CartPage'
import OrderConfirmationPage from './OrderConfirmationPage'
import OrderDetailsPage from './OrderDetailsPage'
import AddressBookPage from './AddressBookPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { expectNoEnglish, switchToBangla } from '../test/i18n'
import { paymentPage } from '../utils/payment'
import { resetDisplayCurrencyForTests } from '../utils/displayCurrency'

// Phase 14 storefront with BuyNest's API (docs/backend/PHASE14_CONTRACT.md §2–§4, §6): Bangladesh
// addresses (Division → District → Area), mobile numbers, delivery zones with ETA, and cash on
// delivery (why it isn't offered, its fee, the advance delivery charge, the phone confirmation).
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const SLOW = { timeout: 30_000 }
const STORE = (overrides = {}) => ({
  data: {
    store_name: 'BuyNest', support_email: 'help@buynest.test', free_shipping_threshold: null, allowed_countries: ['Bangladesh', 'India'], guest_checkout: true, tax_enabled: false,
    shipping_methods: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: '120.00' }],
    payment_methods: ['sslcommerz', 'cod'], card_payments: 'manual', paypal_payments: 'unavailable', sslcommerz_payments: 'sslcommerz',
    currency: { code: 'BDT', symbol: '৳', decimals: 2 }, currencies: { base: 'BDT', display: [] }, ga4_measurement_id: null,
    default_country: 'Bangladesh', cod: { fee: '0.00', max_order_total: null, advance: 'none', zones: [], require_confirmation: false },
    ...overrides,
  },
})
const DIVISIONS = [
  { id: 3, name: 'Dhaka', name_en: 'Dhaka', name_bn: 'ঢাকা' },
  { id: 6, name: 'Rajshahi', name_en: 'Rajshahi', name_bn: 'রাজশাহী' },
]
const DISTRICTS = { 3: [{ id: 47, division_id: 3, name: 'Dhaka', name_en: 'Dhaka', name_bn: 'ঢাকা' }, { id: 41, division_id: 3, name: 'Gazipur', name_en: 'Gazipur', name_bn: 'গাজীপুর' }] }
const AREAS = {
  47: [
    { id: 1001, district_id: 47, name: 'Dhanmondi', name_en: 'Dhanmondi', name_bn: 'ধানমন্ডি', kind: 'thana', postcodes: ['1209'] },
    { id: 1002, district_id: 47, name: 'Mirpur', name_en: 'Mirpur', name_bn: 'মিরপুর', kind: 'thana', postcodes: ['1216', '1221'] },
  ],
}
const PLACES = {
  'GET /api/catalog/places/bd/divisions': { body: { data: DIVISIONS } },
  'GET /api/catalog/places/bd/districts': (url) => ({ body: { data: url.searchParams.get('division') ? (DISTRICTS[url.searchParams.get('division')] ?? []) : Object.values(DISTRICTS).flat() } }),
  'GET /api/catalog/places/bd/areas': (url) => ({ body: { data: AREAS[url.searchParams.get('district')] ?? [] } }),
}
const CATALOG = (store = STORE()) => ({ 'GET /api/catalog/store': { body: store }, ...PLACES })

const ITEM = { productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 'm.webp', price: 1100, discountPercentage: 0, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 2 }
const seedCart = (items) => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items, couponCode: null }))
const LINE = { productId: 1, title: 'Mascara', thumbnail: 'm.webp', price: 1100, discountPercentage: 0, salePrice: 1100, quantity: 2, lineTotal: 2200, stock: 99, minimumOrderQuantity: 1, available: true }
const ZONE = { code: 'inside_dhaka', name: 'Inside Dhaka', nameEn: 'Inside Dhaka', nameBn: 'ঢাকার ভেতরে' }
const COD = (extra = {}) => ({ available: true, reason: null, message: null, fee: 0, maxOrderTotal: null, advance: 'none', advanceAmount: 0, requiresConfirmation: false, ...extra })

/** The priced cart: before an area, the store's rate; with one, the zone's rate and ETA. */
function pricedCart(body, { cod = COD(), shipping = 80 } = {}) {
  const area = body.place?.areaId
  const codFee = body.paymentMethod === 'cod' ? (cod.fee ?? 0) : 0
  const price = area ? shipping : 120
  const total = 2200 + price + codFee
  return {
    lines: [LINE], problems: [], coupon: null, couponError: null, appliedRules: [], requiresShipping: true, shippingError: null, giftCard: null, giftCardError: null,
    shippingOptions: [area ? { id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days', price, etaDaysMin: 1, etaDaysMax: 2, zone: { code: 'inside_dhaka', name: null, nameEn: null, nameBn: null } } : { id: 'standard', label: 'Standard', eta: '3–5 business days', price }],
    ...(area && { deliveryZone: ZONE }),
    cod: { ...cod, ...(cod.advance === 'delivery_charge' && { advanceAmount: price + codFee }) },
    totals: { itemCount: 2, subtotal: 2200, discount: 0, shipping: price, tax: 0, total, amountDue: total, ...(codFee > 0 && { codFee }) },
  }
}
const pricing = (options) => (url, init) => ({ body: pricedCart(JSON.parse(init.body), options) })
const lastBody = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => new URL(url).pathname === path && init?.body)
  return call && JSON.parse(call[1].body)
}

const BD_SHIPPING = { firstName: 'Rahim', lastName: 'Uddin', line1: 'House 12, Road 5', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1209', country: 'Bangladesh', divisionId: 3, districtId: 47, areaId: 1001, area: { id: 1001, name: 'Dhanmondi', nameEn: 'Dhanmondi', nameBn: null } }
const ORDER = (overrides = {}) => ({
  number: 'BN-100001', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod', paymentProvider: null, canPay: false, payment: null,
  shippingMethod: { id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days', etaDaysMin: 1, etaDaysMax: 2 }, email: 'rahim@example.com', phone: '+8801712345678',
  shippingAddress: BD_SHIPPING, billingAddress: BD_SHIPPING, couponCode: null, items: [LINE], totals: { itemCount: 2, subtotal: 2200, discount: 0, shipping: 80, tax: 0, total: 2280 },
  currency: 'BDT', placedAt: '2026-11-23T10:00:00Z', history: [], shipments: [], invoices: [], creditMemos: [],
  deliveryZone: { code: 'inside_dhaka', name: 'Inside Dhaka', nameEn: null, nameBn: null }, codFee: 0, advancePaid: 0, codDue: 2280, ...overrides,
})
const confirmation = <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />

/** Division → District → Area, the way a shopper does it with the keyboard or a picker. */
async function chooseDhanmondi(user) {
  const division = await screen.findByLabelText('Division')
  await waitFor(() => expect(within(division).getByRole('option', { name: 'Rajshahi' })).toBeInTheDocument())
  await user.selectOptions(division, 'Dhaka')
  const district = screen.getByLabelText('District')
  await waitFor(() => expect(within(district).getByRole('option', { name: 'Gazipur' })).toBeInTheDocument())
  await user.selectOptions(district, 'Dhaka')
  const area = screen.getByLabelText('Area (upazila or thana)')
  await waitFor(() => expect(within(area).getByRole('option', { name: 'Dhanmondi' })).toBeInTheDocument())
  await user.selectOptions(area, 'Dhanmondi')
}

async function fillGuest(user, { phone = '01712-345678' } = {}) {
  await user.type(await screen.findByLabelText('Email'), 'rahim@example.com')
  await user.type(screen.getByLabelText('Phone'), phone)
  await user.type(screen.getByLabelText('First name'), 'Rahim')
  await user.type(screen.getByLabelText('Last name'), 'Uddin')
  await chooseDhanmondi(user)
  await user.type(screen.getByLabelText('House, road or village'), 'House 12, Road 5')
  await new Promise((resolve) => setTimeout(resolve, 700))
  await waitFor(() => expect(screen.queryByText('Checking prices…')).toBeNull())
}

afterEach(() => {
  resetDisplayCurrencyForTests()
  window.sessionStorage.clear()
})

describe('the Bangladesh address at checkout (§2, §3)', () => {
  it('Division → District → Area, postcode filled in, the zone and ETA under the method, the place sent', SLOW, async () => {
    seedCart([ITEM])
    const fetchMock = mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': pricing(), 'POST /api/shop/orders': { status: 201, body: ORDER() } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })

    // A Bangladeshi store starts addresses in Bangladesh: no city / state fields, the cascading selects instead.
    expect(await screen.findByLabelText('Division')).toBeInTheDocument()
    expect(screen.queryByLabelText('City')).toBeNull()
    expect(screen.getByLabelText('District')).toBeDisabled()
    expect(screen.getByLabelText('Area (upazila or thana)')).toBeDisabled()
    expect(screen.getByLabelText('Phone')).toHaveAccessibleDescription('Bangladeshi mobile, like 01712-345678. The courier calls this number.')
    expect(screen.getByText('Choose your area to see the delivery charge for it.')).toBeInTheDocument()
    expect(screen.getByText('Delivery charge is calculated from your area.')).toBeInTheDocument()

    await fillGuest(user)
    expect(screen.getByLabelText('Postcode (optional)')).toHaveValue('1209')
    expect(screen.getByLabelText('Postcode (optional)')).toHaveAccessibleDescription('Postcode for this area: 1209')
    const method = screen.getByRole('radio', { name: /Standard/ }).closest('label')
    await waitFor(() => expect(method).toHaveTextContent('Inside Dhaka · Delivery in 1–2 days'))
    expect(method).toHaveTextContent('৳80.00')
    expect(screen.getByText('Delivery zone: Inside Dhaka')).toBeInTheDocument()
    expect(lastBody(fetchMock, '/api/shop/cart/validate')).toMatchObject({ country: 'Bangladesh', place: { divisionId: '3', districtId: '47', areaId: '1001' }, paymentMethod: 'cod' })

    await user.click(screen.getByRole('button', { name: 'Place order · ৳2,280.00' }))
    await screen.findByRole('heading', { name: 'Thank you, Rahim!' })
    expect(lastBody(fetchMock, '/api/shop/orders')).toMatchObject({
      phone: '01712345678',
      shippingAddress: { country: 'Bangladesh', divisionId: '3', districtId: '47', areaId: '1001', line1: 'House 12, Road 5', postalCode: '1209', city: 'Dhaka', state: 'Dhaka' },
    })
    // The confirmation: the Bangladesh address, the zone, the cash to keep ready.
    await waitFor(() => expect(document.querySelector('address')).toHaveTextContent('House 12, Road 5Dhanmondi, Dhaka 1209Dhaka DivisionBangladesh'))
    expect(screen.getByText('Delivery zone: Inside Dhaka')).toBeInTheDocument()
    expect(screen.getAllByText('Please keep ৳2,280.00 ready to pay in cash on delivery.').length).toBeGreaterThan(0)
  })

  it('changing the division clears district and area; several postcodes are listed, none forced', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': pricing() })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await chooseDhanmondi(user)
    await user.selectOptions(screen.getByLabelText('Area (upazila or thana)'), 'Mirpur')
    expect(screen.getByLabelText('Postcode (optional)')).toHaveValue('')
    expect(screen.getByLabelText('Postcode (optional)')).toHaveAccessibleDescription('Postcodes in this area: 1216, 1221')
    await user.selectOptions(screen.getByLabelText('Division'), 'Rajshahi')
    expect(screen.getByLabelText('District')).toHaveValue('')
    expect(screen.getByLabelText('Area (upazila or thana)')).toHaveValue('')
    expect(screen.getByLabelText('Area (upazila or thana)')).toBeDisabled()
  })

  it('says what is missing, and checks the mobile number as a Bangladeshi one', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': pricing() })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await user.type(await screen.findByLabelText('Phone'), '01212345678')
    await waitFor(() => expect(screen.getByRole('button', { name: /Place order/ })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /Place order/ }))
    expect(await screen.findByText('Choose your division.')).toBeInTheDocument()
    expect(screen.getByText('Choose your district.')).toBeInTheDocument()
    expect(screen.getByText('Choose your area (upazila or thana).')).toBeInTheDocument()
    expect(screen.getByText('Enter your house, road or village.')).toBeInTheDocument()
    expect(screen.getByText('Mobile numbers start with 013 to 019. Check the third digit.')).toBeInTheDocument()
    expect(screen.getByLabelText('Division')).toHaveAttribute('aria-invalid', 'true')
    await user.clear(screen.getByLabelText('Phone'))
    await user.type(screen.getByLabelText('Phone'), '12345')
    expect(await screen.findByText('Enter a Bangladeshi mobile number: 11 digits starting with 01, like 01712-345678.')).toBeInTheDocument()
  })

  it('another country keeps the usual fields', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': pricing() })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await user.selectOptions(await screen.findByLabelText('Country'), 'India')
    expect(screen.getByLabelText('City')).toBeInTheDocument()
    expect(screen.getByLabelText('State / region')).toBeInTheDocument()
    expect(screen.queryByLabelText('Division')).toBeNull()
    expect(screen.queryByText('Choose your area to see the delivery charge for it.')).toBeNull()
  })

  it('without default_country (an older API) a Bangladesh address keeps city and state', SLOW, async () => {
    seedCart([ITEM])
    const older = { ...STORE().data }
    delete older.default_country
    delete older.cod
    mockFetch({ ...CATALOG({ data: { ...older, allowed_countries: ['Bangladesh'] } }), 'POST /api/shop/cart/validate': pricing() })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByLabelText('City')).toBeInTheDocument()
    expect(screen.queryByLabelText('Division')).toBeNull()
  })
})

describe('cash on delivery (§4)', () => {
  it('not offered over the limit: shown, not choosable, says why; another method is chosen', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': pricing({ cod: COD({ available: false, reason: 'limit', maxOrderTotal: 2000 }) }) })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    const cod = await screen.findByRole('radio', { name: /Cash on delivery/ })
    await waitFor(() => expect(cod).toBeDisabled())
    const why = 'Cash on delivery is available for orders up to ৳2,000.00. Please choose another way to pay.'
    expect(cod.closest('label')).toHaveTextContent(why)
    await waitFor(() => expect(screen.getByRole('radio', { name: /SSLCommerz/ })).toBeChecked())
    expect(await screen.findByRole('button', { name: 'Continue to SSLCommerz' })).toBeInTheDocument()
  })

  it('the COD fee is a line of its own, and the phone call is announced', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(STORE({ cod: { fee: '20.00', max_order_total: null, advance: 'none', zones: [], require_confirmation: true } })), 'POST /api/shop/cart/validate': pricing({ cod: COD({ fee: 20 }) }) })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByText('Cash on delivery fee')).toBeInTheDocument()
    expect(screen.getByText('Cash on delivery fee').nextSibling).toHaveTextContent('৳20.00')
    expect(screen.getByText(/A cash on delivery fee of ৳20\.00 is added\. We'll call you to confirm your order before we send it\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Place order · ৳2,340.00' })).toBeInTheDocument()
  })

  it('advance delivery charge: pay it through SSLCommerz, then "partly paid" with the cash due', SLOW, async () => {
    seedCart([ITEM])
    const open = vi.spyOn(paymentPage, 'open').mockImplementation(() => {})
    const GATEWAY = 'https://sandbox.sslcommerz.com/EasyCheckOut/advance'
    const placed = ORDER({ status: 'pending_payment', paymentProvider: 'sslcommerz', canPay: true, payment: { provider: 'sslcommerz', url: GATEWAY, expiresAt: null, paidAt: null, canPay: true }, advanceAmount: 80, codDue: 2280 })
    const fetchMock = mockFetch({
      ...CATALOG(STORE({ cod: { fee: '0.00', max_order_total: null, advance: 'delivery_charge', zones: [], require_confirmation: false } })),
      'POST /api/shop/cart/validate': pricing({ cod: COD({ advance: 'delivery_charge' }) }),
      'POST /api/shop/orders': { status: 201, body: placed },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })
    await fillGuest(user)
    expect(await screen.findByText('Pay the delivery charge (৳80.00) now with bKash, Nagad or card. Pay the rest (৳2,200.00) in cash when your order arrives.')).toBeInTheDocument()
    expect(screen.getByText('Pay now (delivery charge)').nextSibling).toHaveTextContent('৳80.00')
    expect(screen.getByText('Due in cash on delivery').nextSibling).toHaveTextContent('৳2,200.00')
    await user.click(screen.getByRole('button', { name: 'Pay delivery charge · ৳80.00' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(GATEWAY))
    expect(screen.getByRole('status')).toHaveTextContent('Taking you to pay the delivery charge…')
    expect(lastBody(fetchMock, '/api/shop/orders')).toMatchObject({ paymentMethod: 'cod' })
    open.mockRestore()
  })

  it('back from SSLCommerz with the advance paid: "Delivery charge paid", what to keep ready', SLOW, async () => {
    window.sessionStorage.setItem('buynest.pendingPayment.v1', JSON.stringify({ number: 'BN-100001', email: 'rahim@example.com' }))
    const paid = ORDER({ paymentStatus: 'partially_paid', paymentProvider: 'sslcommerz', advancePaid: 80, codDue: 2200, confirmationStatus: 'pending' })
    mockFetch({ ...CATALOG(), 'POST /api/shop/orders/lookup': { body: paid } })
    renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001?payment=success&provider=sslcommerz', path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Delivery charge paid' })).toBeInTheDocument()
    expect(screen.getByText('We\'ve received ৳80.00 for order BN-100001. Please keep ৳2,200.00 ready to pay in cash on delivery.')).toBeInTheDocument()
    expect(screen.getAllByText('Partly paid').length).toBeGreaterThan(0)
    expect(screen.getByText('Paid in advance').nextSibling).toHaveTextContent('−৳80.00')
    expect(screen.getByText('Due in cash on delivery').nextSibling).toHaveTextContent('৳2,200.00')
    expect(screen.getByText("We'll call you to confirm")).toBeInTheDocument()
  })
})

describe('order pages and the address book', () => {
  const signIn = () => {
    document.cookie = 'buynest_session=session; Path=/'
    window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
  }
  const ME = { 'GET /api/auth/me': { body: { id: 5, firstName: 'Nadia', email: 'nadia@example.com', role: 'customer' } }, 'GET /api/shop/me/wishlist': { body: { items: [], shared: false } } }

  it('order details: the zone, the ETA in days, "Confirmed", and the places in Bangla', SLOW, async () => {
    signIn()
    mockFetch({ ...ME, ...CATALOG(), 'GET /api/shop/orders/BN-100001': { body: ORDER({ confirmationStatus: 'confirmed' }) } })
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100001', path: '/account/orders/:orderId' })
    expect(await screen.findByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText("Thanks for confirming by phone. We're preparing your order.")).toBeInTheDocument()
    expect(screen.getByText(/Delivery in 1–2 days/)).toBeInTheDocument()
    await switchToBangla()
    // The places are looked up so they show in Bangla (the order stores English names).
    await waitFor(() => expect(document.querySelector('address')).toHaveTextContent('ধানমন্ডি, ঢাকা ১২০৯ঢাকা বিভাগ'))
    expect(screen.getByText(/১–২ দিনে ডেলিভারি/)).toBeInTheDocument()
    expect(screen.getByText('নিশ্চিত হয়েছে')).toBeInTheDocument()
  })

  it('the address book adds a Bangladesh address with its places and a Bangladeshi mobile', SLOW, async () => {
    signIn()
    const fetchMock = mockFetch({
      ...ME, ...CATALOG(),
      'GET /api/shop/me/addresses': { body: { addresses: [] } },
      'POST /api/shop/me/addresses': { status: 201, body: { ...BD_SHIPPING, id: 9, phone: '+8801712345678', company: '', isDefaultShipping: true, isDefaultBilling: true } },
    })
    const user = userEvent.setup()
    renderWithProviders(<AddressBookPage />, { route: '/account/addresses', path: '/account/addresses' })
    await user.click(await screen.findByRole('button', { name: 'Add your first address' }))
    expect(screen.getByLabelText('Country')).toHaveValue('Bangladesh')
    await user.type(screen.getByLabelText('Last name'), 'Rahman')
    await chooseDhanmondi(user)
    await user.type(screen.getByLabelText('House, road or village'), 'House 12, Road 5')
    await user.type(screen.getByLabelText('Phone'), '0171234')
    await user.click(screen.getByRole('button', { name: 'Add address' }))
    expect(await screen.findByText('Enter a Bangladeshi mobile number: 11 digits starting with 01, like 01712-345678.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Phone'), '5678')
    await user.click(screen.getByRole('button', { name: 'Add address' }))
    await waitFor(() => expect(lastBody(fetchMock, '/api/shop/me/addresses')).toMatchObject({ country: 'Bangladesh', divisionId: '3', districtId: '47', areaId: '1001', postalCode: '1209', phone: '01712345678' }))
  })

  it('the cart says the delivery charge follows the area', SLOW, async () => {
    seedCart([ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': pricing() })
    renderWithProviders(<CartPage />)
    expect(await screen.findByText('Delivery charge is calculated from your area at checkout.')).toBeInTheDocument()
  })
})

describe('in Bangla', () => {
  it('the Bangladesh address form, the zone and the ETA are in Bangla, with Bangla digits', SLOW, async () => {
    await switchToBangla()
    seedCart([ITEM])
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': pricing() })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    const division = await screen.findByLabelText('বিভাগ')
    await waitFor(() => expect(within(division).getByRole('option', { name: 'রাজশাহী' })).toBeInTheDocument())
    await user.selectOptions(division, 'ঢাকা')
    await waitFor(() => expect(within(screen.getByLabelText('জেলা')).getByRole('option', { name: 'গাজীপুর' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('জেলা'), 'ঢাকা')
    await waitFor(() => expect(within(screen.getByLabelText('এলাকা (উপজেলা বা থানা)')).getByRole('option', { name: 'ধানমন্ডি' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('এলাকা (উপজেলা বা থানা)'), 'ধানমন্ডি')
    const method = screen.getByRole('radio', { name: /স্ট্যান্ডার্ড/ }).closest('label')
    await waitFor(() => expect(method).toHaveTextContent('ঢাকার ভেতরে · ১–২ দিনে ডেলিভারি'))
    expect(method).toHaveTextContent('৳৮০.০০')
    expect(screen.getByLabelText('পোস্টকোড (ঐচ্ছিক)')).toHaveValue('1209')
    expect(screen.getByText('ডেলিভারি জোন: ঢাকার ভেতরে')).toBeInTheDocument()
    // No English left on the page (product data from the fixtures aside).
    expectNoEnglish(document.body, { allow: ['Mascara', 'Essence', 'BDT', 'NEST'] })
  })
})
