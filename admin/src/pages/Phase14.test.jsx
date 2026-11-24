import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { addressErrors, addressValues } from '../utils/address'
import { advanceAvailability, amountToCollect, etaText, formatBdMobile, historyText, normalizeBdMobile, placeText, telHref } from '../utils/bangladesh'
import { toZoneRateValues, zoneRateErrors } from '../utils/shippingRates'

/*
 * Phase 14 (docs/backend/PHASE14_CONTRACT.md): Bangladesh addresses with the
 * cascading Division → District → Area selects, delivery zones and zone
 * rates with delivery times, Settings → Cash on delivery and the default
 * country, Sales → To confirm, the order's zone and COD amounts, the
 * collection on delivery, the shipping override, and the grid's filters and
 * courier files. BuyNest's backend.
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url instanceof URL ? url.href : url).pathname === path)
  return call && (typeof call[1].body === 'string' ? JSON.parse(call[1].body) : call[1].body)
}
const calledWith = (fetchMock, method, path) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url instanceof URL ? url.href : url).pathname === path).map(([url]) => new URL(url instanceof URL ? url.href : url))

const DIVISIONS = { places: [{ id: 3, name: 'Dhaka', nameBn: 'ঢাকা' }, { id: 1, name: 'Chattogram', nameBn: 'চট্টগ্রাম' }] }
const DISTRICTS = { places: [{ id: 47, name: 'Dhaka', nameBn: 'ঢাকা', divisionId: 3 }, { id: 41, name: 'Gazipur', nameBn: 'গাজীপুর', divisionId: 3 }] }
const AREAS = {
  places: [
    { id: 1003, name: 'Mirpur', nameBn: 'মিরপুর', districtId: 47, kind: 'thana', postcodes: ['1216'] },
    { id: 1001, name: 'Gulshan', nameBn: 'গুলশান', districtId: 47, kind: 'thana', postcodes: ['1212', '1213'] },
  ],
}
const PLACES = {
  'GET /api/admin/places/bd/divisions': { body: DIVISIONS },
  'GET /api/admin/places/bd/districts': { body: DISTRICTS },
  'GET /api/admin/places/bd/areas': { body: AREAS },
}
const ZONES = {
  zones: [
    { id: 1, code: 'inside_dhaka', name: 'Inside Dhaka', nameBn: 'ঢাকার ভেতরে', position: 0, isActive: true, isFallback: false, rateCount: 2, places: [{ areaId: 1003, districtId: null, name: 'Mirpur', districtName: 'Dhaka' }] },
    { id: 2, code: 'dhaka_suburbs', name: 'Dhaka suburbs', nameBn: null, position: 1, isActive: true, isFallback: false, rateCount: 0, places: [{ districtId: 41, areaId: null, name: 'Gazipur' }] },
    { id: 3, code: 'outside_dhaka', name: 'Outside Dhaka', nameBn: 'ঢাকার বাইরে', position: 2, isActive: true, isFallback: true, rateCount: 1, places: [] },
  ],
}

describe('helpers', () => {
  it('reads Bangladeshi mobile numbers, delivery times, and the customer history', () => {
    expect(normalizeBdMobile('01712-345678')).toBe('+8801712345678')
    expect(normalizeBdMobile('+880 1912 345678')).toBe('+8801912345678')
    expect(normalizeBdMobile('01212345678')).toBeNull()
    expect(formatBdMobile('+8801712345678')).toBe('01712 345678')
    expect(telHref('+8801712345678')).toBe('tel:+8801712345678')
    expect(etaText(1, 2)).toBe('Delivery in 1–2 days')
    expect(etaText(1, 1)).toBe('Delivery in 1 day')
    expect(etaText(null, 5)).toBe('Delivery within 5 days')
    expect(etaText(null, null)).toBe('')
    expect(historyText({ orders: 3, delivered: 2, cancelled: 1, returns: 1 })).toBe('3 orders before: 2 delivered, 1 cancelled, 1 return')
    expect(historyText({ orders: 0 })).toBe('First order')
    expect(placeText({ areaId: 1003, name: 'Mirpur', kind: 'thana', districtName: 'Dhaka' })).toBe('Mirpur (thana), Dhaka')
    expect(placeText({ districtId: 41, name: 'Gazipur' })).toBe('Gazipur district')
  })

  it('checks and sends a Bangladesh address by its places', () => {
    const address = { firstName: 'Nadia', lastName: 'Rahman', company: '', phone: '01712 345678', line1: 'House 4', line2: '', city: '', state: '', postalCode: '', country: 'Bangladesh', divisionId: '3', districtId: '', areaId: '' }
    expect(addressErrors(address, { withContact: true })).toEqual({ districtId: ['Choose the district.'], areaId: ['Choose the area (upazila or thana).'] })
    expect(addressErrors({ ...address, phone: '12345', districtId: '47', areaId: '1003', postalCode: '12' }, { withContact: true })).toMatchObject({ phone: expect.any(Array), postalCode: expect.any(Array) })
    expect(addressValues({ ...address, districtId: '47', areaId: '1003' }, { withContact: true })).toEqual({
      firstName: 'Nadia', lastName: 'Rahman', line1: 'House 4', line2: null, postalCode: null, country: 'Bangladesh', divisionId: 3, districtId: 47, areaId: 1003, company: null, phone: '+8801712345678',
    })
    // An order's address: no number (the customer's or guest's is used).
    expect(addressValues({ ...address, districtId: '47', areaId: '1003' }).phone).toBeUndefined()
  })

  it('zone rate fields, the cash to collect, and whether the advance can be taken', () => {
    expect(zoneRateErrors({ country: 'Germany', zoneCode: 'inside_dhaka', etaDaysMin: '3', etaDaysMax: '1' })).toEqual({ etaDaysMax: expect.any(Array), country: expect.any(Array) })
    expect(toZoneRateValues({ zoneCode: '', etaDaysMin: '1', etaDaysMax: '' })).toEqual({ zoneCode: null, etaDaysMin: 1, etaDaysMax: null })
    expect(amountToCollect({ paymentMethod: 'cod', codDue: 900 })).toBe(900)
    expect(amountToCollect({ paymentMethod: 'cod', paymentStatus: 'unpaid', totals: { total: 1080 }, advancePaid: 80 })).toBe(1000)
    expect(amountToCollect({ paymentMethod: 'card', totals: { total: 10 } })).toBe(0)
    expect(advanceAvailability({ checkout: { enabledPaymentMethods: ['cod'] } }).ok).toBe(false)
    expect(advanceAvailability({ checkout: { enabledPaymentMethods: ['sslcommerz'] }, store: { paymentProviders: { sslcommerz: { status: 'not_configured' } } } }).ok).toBe(false)
    expect(advanceAvailability({ checkout: { enabledPaymentMethods: ['sslcommerz'] }, store: { paymentProviders: { sslcommerz: { status: 'sandbox' } } } }).ok).toBe(true)
  })
})

const NADIA = {
  id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '01712345678', emailVerified: true, isActive: true,
  group: null, groupId: null, status: 'active', ordersCount: 0, addresses: [], lifetimeSpent: 0, reviewsCount: 0, recentOrders: [], notes: [], live: true,
}

describe('Bangladesh addresses', () => {
  it('the address book asks for Division → District → Area and fills the postcode of an area with one', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/customers/5': { body: NADIA },
      'GET /api/admin/customer-groups': { body: { groups: [] } },
      'GET /api/admin/settings': { body: { checkout: { allowedCountries: ['United States', 'Bangladesh'], defaultCountry: 'Bangladesh' } } },
      ...PLACES,
      'POST /api/admin/customers/5/addresses': { status: 201, body: { address: { id: 9 } } },
    })
    const user = userEvent.setup()
    renderApp('/customers/5')
    await user.click(await screen.findByRole('tab', { name: 'Addresses' }))
    await user.click(screen.getByRole('button', { name: 'Add address' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add address' }))
    // The store's default country: the Bangladesh form, no city or state.
    await waitFor(() => expect(dialog.getByLabelText('Country')).toHaveValue('Bangladesh'))
    expect(dialog.queryByLabelText('City')).not.toBeInTheDocument()
    expect(dialog.getByLabelText('District')).toBeDisabled()

    await user.click(dialog.getByRole('button', { name: 'Add address' }))
    expect(dialog.getByLabelText('Division')).toHaveAccessibleDescription(/Choose the division/)

    await waitFor(() => expect(within(dialog.getByLabelText('Division')).getByRole('option', { name: 'Dhaka' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('Division'), 'Dhaka')
    await waitFor(() => expect(dialog.getByLabelText('District')).toBeEnabled())
    await waitFor(() => expect(within(dialog.getByLabelText('District')).getByRole('option', { name: 'Dhaka' })).toBeInTheDocument())
    expect(calledWith(fetchMock, 'GET', '/api/admin/places/bd/districts')[0].searchParams.get('division')).toBe('3')
    await user.selectOptions(dialog.getByLabelText('District'), 'Dhaka')
    await waitFor(() => expect(within(dialog.getByLabelText('Area (upazila or thana)')).getByRole('option', { name: 'Mirpur (thana)' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('Area (upazila or thana)'), 'Mirpur (thana)')
    expect(dialog.getByLabelText('Postcode (optional)')).toHaveValue('1216')
    // Several postcodes: the suggestion is taken back, nothing is guessed.
    await user.selectOptions(dialog.getByLabelText('Area (upazila or thana)'), 'Gulshan (thana)')
    expect(dialog.getByLabelText('Postcode (optional)')).toHaveValue('')
    await user.selectOptions(dialog.getByLabelText('Area (upazila or thana)'), 'Mirpur (thana)')
    // A new division clears the district and area.
    await user.selectOptions(dialog.getByLabelText('Division'), 'Chattogram')
    expect(dialog.getByLabelText('Area (upazila or thana)')).toHaveValue('')
    await user.selectOptions(dialog.getByLabelText('Division'), 'Dhaka')
    await waitFor(() => expect(within(dialog.getByLabelText('District')).getByRole('option', { name: 'Gazipur' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('District'), 'Dhaka')
    await waitFor(() => expect(within(dialog.getByLabelText('Area (upazila or thana)')).getByRole('option', { name: 'Mirpur (thana)' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('Area (upazila or thana)'), 'Mirpur (thana)')
    await user.type(dialog.getByLabelText('House, road, or village'), 'House 4, Road 2')
    await user.click(dialog.getByRole('button', { name: 'Add address' }))
    expect(await screen.findByText('Address added.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/customers/5/addresses')).toMatchObject({
      line1: 'House 4, Road 2', country: 'Bangladesh', divisionId: 3, districtId: 47, areaId: 1003, postalCode: '1216', phone: '+8801712345678',
    })
  })

  it('a saved Bangladesh address shows the area, district and mobile', async () => {
    withSession()
    const address = { id: 9, firstName: 'Nadia', lastName: 'Rahman', line1: 'House 4', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1216', country: 'Bangladesh', phone: '+8801712345678', divisionId: 3, districtId: 47, areaId: 1003, area: { id: 1003, name: 'Mirpur', nameEn: 'Mirpur' }, isDefaultShipping: true, isDefaultBilling: true }
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/customers/5': { body: { ...NADIA, addresses: [address] } }, 'GET /api/admin/customer-groups': { body: { groups: [] } } })
    const user = userEvent.setup()
    renderApp('/customers/5')
    await user.click(await screen.findByRole('tab', { name: 'Addresses' }))
    const card = screen.getByText(/House 4/).closest('address')
    expect(card).toHaveTextContent('Mirpur')
    expect(card).toHaveTextContent('Dhaka 1216')
    expect(card).toHaveTextContent('Bangladesh')
    expect(card).toHaveTextContent('01712 345678')
  })
})

describe('delivery zones and zone rates', () => {
  it('lists the zones, adds one with a district and an area, and removes a place', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/delivery-zones': { body: ZONES },
      ...PLACES,
      'POST /api/admin/delivery-zones': { status: 201, body: { zone: { ...ZONES.zones[1], id: 4, name: 'Gazipur and Mirpur' } } },
      'POST /api/admin/delivery-zones/reorder': { body: ZONES },
    })
    const user = userEvent.setup()
    renderApp('/settings/delivery-zones')
    const suburbs = (await screen.findByRole('heading', { name: 'Dhaka suburbs' })).closest('li')
    expect(within(suburbs).getByText('Gazipur district')).toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: /Inside Dhaka/ }).closest('li')).getByText('Mirpur, Dhaka')).toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: /Outside Dhaka/ }).closest('li')).getByText('Fallback: every other place')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move Dhaka suburbs up' }))
    await waitFor(() => expect(sentTo(fetchMock, 'POST', '/api/admin/delivery-zones/reorder')).toEqual({ ids: [2, 1, 3] }))

    await user.click(screen.getByRole('button', { name: 'Add zone' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add a delivery zone' }))
    await user.type(dialog.getByLabelText('Code'), 'Bad Code')
    await user.click(dialog.getByRole('button', { name: 'Add zone' }))
    expect(dialog.getByLabelText('Code')).toHaveAccessibleDescription(/lower-case letters/)
    await user.clear(dialog.getByLabelText('Code'))
    await user.type(dialog.getByLabelText('Code'), 'north')
    await user.type(dialog.getByLabelText('Name'), 'Gazipur and Mirpur')
    await user.click(dialog.getByRole('button', { name: 'Add the whole district' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('Choose a district')
    await waitFor(() => expect(within(dialog.getByLabelText('Division')).getByRole('option', { name: 'Dhaka' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('Division'), 'Dhaka')
    await waitFor(() => expect(within(dialog.getByLabelText('District')).getByRole('option', { name: 'Gazipur' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('District'), 'Gazipur')
    await user.click(dialog.getByRole('button', { name: 'Add the whole district' }))
    await user.selectOptions(dialog.getByLabelText('District'), 'Dhaka')
    await waitFor(() => expect(within(dialog.getByLabelText('Area (optional)')).getByRole('option', { name: 'Gulshan (thana)' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('Area (optional)'), 'Gulshan (thana)')
    await user.click(dialog.getByRole('button', { name: 'Add the area' }))
    await user.selectOptions(dialog.getByLabelText('Area (optional)'), 'Mirpur (thana)')
    await user.click(dialog.getByRole('button', { name: 'Add the area' }))
    expect(dialog.getByText('Gazipur district')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Remove Gulshan (thana), Dhaka' }))
    expect(dialog.queryByText('Gulshan (thana), Dhaka')).not.toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Add zone' }))
    expect(await screen.findByText('Gazipur and Mirpur added.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/delivery-zones')).toEqual({
      code: 'north', name: 'Gazipur and Mirpur', nameBn: null, isActive: true, places: [{ districtId: 41 }, { areaId: 1003 }],
    })
  })

  it('shows the zone and delivery time of each table rate, and adds a zone rate', async () => {
    withSession()
    const RATES = {
      rates: [{ id: 4, method: 'standard', country: 'Bangladesh', minWeightGrams: 0, maxWeightGrams: null, minSubtotal: 0, maxSubtotal: null, price: 60, position: 0, zoneCode: 'inside_dhaka', etaDaysMin: 1, etaDaysMax: 2 }],
      defaultWeightGrams: 500,
      methods: [{ id: 'standard', label: 'Standard', flatPrice: 5, rows: 1 }],
    }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/shipping-rates': { body: RATES },
      'GET /api/admin/settings': { body: { checkout: { allowedCountries: ['Bangladesh'] } } },
      'GET /api/admin/delivery-zones': { body: ZONES },
      'POST /api/admin/shipping-rates': { status: 201, body: { rate: { ...RATES.rates[0], id: 9, zoneCode: 'outside_dhaka', price: 120 } } },
    })
    const user = userEvent.setup()
    renderApp('/settings/shipping-rates')
    const table = await screen.findByRole('table', { name: 'Standard rates, in the order they are tried' })
    await waitFor(() => expect(within(table).getByRole('columnheader', { name: 'Zone' })).toBeInTheDocument())
    const row = within(table).getAllByRole('row')[1]
    expect(row).toHaveTextContent('Inside Dhaka')
    expect(row).toHaveTextContent('in 1–2 days')

    await user.click(screen.getByRole('button', { name: 'Add a standard rate' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.clear(dialog.getByLabelText('Country'))
    await user.type(dialog.getByLabelText('Country'), 'Bangladesh')
    await user.selectOptions(dialog.getByLabelText('Delivery zone'), 'Outside Dhaka')
    await user.type(dialog.getByLabelText('Price (USD)'), '120')
    await user.type(dialog.getByLabelText('Delivery from (days)'), '3')
    await user.type(dialog.getByLabelText('Delivery up to (days)'), '5')
    await user.click(dialog.getByRole('button', { name: 'Add rate' }))
    expect(await screen.findByText(/Standard rate for Outside Dhaka added/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/shipping-rates')).toEqual({
      method: 'standard', country: 'Bangladesh', minWeightGrams: 0, maxWeightGrams: null, minSubtotal: 0, maxSubtotal: null, price: 120, zoneCode: 'outside_dhaka', etaDaysMin: 3, etaDaysMax: 5,
    })
  })
})

const SETTINGS = {
  general: { storeName: 'BuyNest' },
  shipping: { standardPrice: 5, freeShippingThreshold: 50, expressPrice: 10, nextDayPrice: 20, enabledMethods: ['standard'] },
  tax: { taxEnabled: false, pricesIncludeTax: false, taxRates: [] },
  checkout: { allowedCountries: ['Bangladesh', 'India'], guestCheckout: true, enabledPaymentMethods: ['cod'], defaultCountry: null },
  inventory: { lowStockThreshold: 5 },
  catalog: {},
  cod: { maxOrderTotal: null, fee: 0, advance: 'none', zones: [], requireConfirmation: false },
  store: { paymentProviders: { sslcommerz: { status: 'not_configured', message: 'Not configured' } } },
}

describe('settings', () => {
  it('saves the default country, and cash on delivery (the advance explains why it needs SSLCommerz)', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': { body: { data: {} } },
      'GET /api/admin/settings': { body: SETTINGS },
      'GET /api/admin/delivery-zones': { body: ZONES },
      'GET /api/admin/currencies': { body: { currencies: [] } },
      'PATCH /api/admin/settings': (url, init) => ({ body: { ...SETTINGS, ...JSON.parse(init.body) } }),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const cod = within((await screen.findByRole('heading', { name: 'Cash on delivery' })).closest('form'))
    const advance = cod.getByRole('radio', { name: /delivery charge first/ })
    expect(advance).toBeDisabled()
    expect(cod.getByRole('group', { name: 'Paid in advance' })).toHaveAccessibleDescription(/needs SSLCommerz/)
    await waitFor(() => expect(cod.getByRole('checkbox', { name: 'Inside Dhaka' })).toBeInTheDocument())

    await user.type(cod.getByLabelText('Largest order total for cash on delivery'), '20000')
    await user.clear(cod.getByLabelText('Cash on delivery fee'))
    await user.type(cod.getByLabelText('Cash on delivery fee'), 'x')
    await user.click(cod.getByRole('button', { name: 'Save cash on delivery' }))
    expect(cod.getByLabelText('Cash on delivery fee')).toHaveAccessibleDescription(/Enter a fee/)
    await user.clear(cod.getByLabelText('Cash on delivery fee'))
    await user.type(cod.getByLabelText('Cash on delivery fee'), '20')
    await user.click(cod.getByRole('checkbox', { name: 'Inside Dhaka' }))
    await user.click(cod.getByRole('checkbox', { name: 'Confirm each order by phone before shipping' }))
    await user.click(cod.getByRole('button', { name: 'Save cash on delivery' }))
    expect(await cod.findByText('Cash on delivery saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ cod: { maxOrderTotal: 20000, fee: 20, advance: 'none', zones: ['inside_dhaka'], requireConfirmation: true } })

    const checkout = within(screen.getByRole('heading', { name: 'Checkout' }).closest('form'))
    await user.selectOptions(checkout.getByLabelText('Default country'), 'Bangladesh')
    await user.click(checkout.getByRole('button', { name: 'Save checkout' }))
    await waitFor(() => expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toMatchObject({ checkout: { defaultCountry: 'Bangladesh' } }))
  })
})

const ADDRESS = { firstName: 'Nadia', lastName: 'Rahman', line1: 'House 4', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1216', country: 'Bangladesh', divisionId: 3, districtId: 47, areaId: 1003, area: { id: 1003, name: 'Mirpur', nameEn: 'Mirpur' } }
const COD_ORDER = {
  id: 'BN-100001', number: 'BN-100001', currency: 'USD', status: 'processing', paymentStatus: 'partially_paid', paymentMethod: 'cod',
  shippingMethod: { id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days' }, email: 'nadia@example.com', phone: '+8801712345678',
  shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null,
  customer: { id: null, guest: true, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com' },
  lines: [{ id: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 1000, quantity: 1, discountedTotal: 1000 }],
  totals: { itemCount: 1, subtotal: 1000, discount: 0, shipping: 60, tax: 0, total: 1080, paid: 80, refunded: 0 }, items: 1, placedAt: '2026-11-23T09:00:00Z',
  invoices: [{ number: 'INV-100001', amount: 80, createdAt: '2026-11-23T09:10:00Z', adminName: null }], creditMemos: [], shipments: [],
  history: [{ status: 'processing', paymentStatus: 'partially_paid', note: 'Advance paid through SSLCommerz.', adminName: null, customerNotified: true, createdAt: '2026-11-23T09:10:00Z' }],
  payment: { provider: null, paidAt: null, url: null, canPay: false },
  deliveryZone: { code: 'inside_dhaka', name: 'Inside Dhaka' }, etaDaysMin: 1, etaDaysMax: 2,
  codFee: 20, advanceAmount: 80, advancePaid: 80, codDue: 1000, codCollection: null, confirmationStatus: 'pending',
  confirmation: { status: 'pending', attempts: 1, confirmedAt: null, log: [{ id: 1, outcome: 'unreachable', note: 'No answer', adminName: 'Sam', createdAt: '2026-11-23T10:00:00Z' }] },
  live: true,
}

describe('the order page', () => {
  it('shows the Bangladesh address, zone, delivery time, COD amounts, and the confirmation log; confirms the order', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': { body: { data: {} } },
      'GET /api/admin/orders/BN-100001': { body: COD_ORDER },
      'POST /api/admin/orders/BN-100001/confirmation': { body: { order: { ...COD_ORDER, confirmationStatus: 'confirmed' } } },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    const delivery = within((await screen.findByRole('heading', { name: 'Delivery and payment' })).closest('section'))
    expect(delivery.getByText('Ship to').nextElementSibling).toHaveTextContent('Mirpur')
    expect(delivery.getByText('Method').nextElementSibling).toHaveTextContent('Delivery in 1–2 days')
    expect(delivery.getByText('Delivery zone').nextElementSibling).toHaveTextContent('Inside Dhaka')
    expect(delivery.getByText('Paid in advance').nextElementSibling).toHaveTextContent('$80.00')
    expect(delivery.getByText('Cash to collect').nextElementSibling).toHaveTextContent('$1,000.00')
    expect(screen.getByRole('rowheader', { name: 'To collect on delivery' }).closest('tr')).toHaveTextContent('$1,000.00')
    expect(screen.getByRole('rowheader', { name: 'Including the cash on delivery fee' }).closest('tr')).toHaveTextContent('$20.00')
    expect(screen.getByRole('link', { name: '01712 345678' })).toHaveAttribute('href', 'tel:+8801712345678')
    expect(screen.getByRole('link', { name: /PDF.*packing slip BN-100001/ })).toHaveAttribute('href', '/api/admin/orders/BN-100001/packing-slip.pdf')

    const confirmation = within(screen.getByRole('heading', { name: 'Phone confirmation' }).closest('section'))
    expect(confirmation.getByText('To confirm')).toBeInTheDocument()
    expect(confirmation.getByText("Couldn't reach", { selector: 'strong' }).closest('li')).toHaveTextContent('No answer')
    await user.click(confirmation.getByRole('button', { name: 'Confirmed' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Confirm order BN-100001?' }))
    await user.click(dialog.getByRole('button', { name: 'Mark as confirmed' }))
    expect(await screen.findByText('Order BN-100001 confirmed. The customer was emailed.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/confirmation')).toEqual({ outcome: 'confirmed', notifyCustomer: true })
  })

  it('an unconfirmed order ships only with a reason', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': { body: { data: {} } },
      'GET /api/admin/orders/BN-100001': { body: COD_ORDER },
      'POST /api/admin/orders/BN-100001/shipments': { status: 201, body: { shipment: { number: 'SHP-100001', carrierLabel: 'Other carrier', trackingNumber: null } } },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    expect(await screen.findByText(/isn't confirmed by phone yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ship' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Ship order BN-100001' }))
    await user.selectOptions(dialog.getByLabelText('Carrier'), 'other')
    await user.click(dialog.getByRole('button', { name: 'Create shipment' }))
    expect(dialog.getByRole('checkbox', { name: 'Ship without confirmation' })).toHaveAccessibleDescription(/Confirm the order by phone first/)
    await user.click(dialog.getByRole('checkbox', { name: 'Ship without confirmation' }))
    await user.type(dialog.getByLabelText('Reason'), 'Customer confirmed by SMS')
    await user.click(dialog.getByRole('button', { name: 'Create shipment' }))
    expect(await screen.findByText(/Shipment SHP-100001 created/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/shipments')).toMatchObject({ carrier: 'other', confirmationOverride: 'Customer confirmed by SMS' })
  })

  it('marking a COD order delivered asks for the cash collected, with a note when short', async () => {
    withSession()
    const shipped = { ...COD_ORDER, status: 'shipped', confirmationStatus: 'confirmed', confirmation: { ...COD_ORDER.confirmation, status: 'confirmed' }, shipments: [{ number: 'SHP-1', carrierLabel: 'Other', createdAt: '2026-11-23T12:00:00Z' }] }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/catalog/store': { body: { data: {} } },
      'GET /api/admin/orders/BN-100001': { body: shipped },
      'PATCH /api/admin/orders/BN-100001': { body: { ...shipped, status: 'delivered' } },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    await user.click(await screen.findByRole('button', { name: 'Mark as delivered' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Mark order BN-100001 as delivered?' }))
    const amount = dialog.getByLabelText('Amount collected (USD)')
    expect(amount).toHaveValue(1000)
    await user.clear(amount)
    await user.type(amount, '1200')
    await user.click(dialog.getByRole('button', { name: 'Mark as delivered' }))
    expect(amount).toHaveAccessibleDescription(/more than the \$1,000.00 due/)
    await user.clear(amount)
    await user.type(amount, '900')
    await user.click(dialog.getByRole('button', { name: 'Mark as delivered' }))
    expect(dialog.getByLabelText('Why less was collected')).toHaveAccessibleDescription(/Say why/)
    await user.type(dialog.getByLabelText('Why less was collected'), 'Item damaged, discount given')
    await user.click(dialog.getByRole('button', { name: 'Mark as delivered' }))
    expect(await screen.findByText(/\$900.00 collected; \$100.00 is still due/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/orders/BN-100001')).toEqual({ status: 'delivered', collectedAmount: 900, collectionNote: 'Item damaged, discount given', notifyCustomer: true })
  })
})

const QUEUE = {
  orders: [
    {
      number: 'BN-100001', placedAt: '2026-11-23T09:00:00Z', total: 1080, codDue: 1080, currency: 'USD', customerName: 'Nadia Rahman', phone: '+8801712345678', address: 'House 4, Mirpur, Dhaka',
      deliveryZone: { code: 'inside_dhaka', name: 'Inside Dhaka' }, confirmationStatus: 'unreachable', attempts: 2, lastNote: 'No answer', lastAttemptAt: '2026-11-23T10:00:00Z',
      history: { orders: 3, delivered: 2, cancelled: 1, returns: 0 },
    },
  ],
  total: 1,
}

describe('Sales → To confirm', () => {
  it('lists the orders to call with a call link and history; cancelling needs a reason', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/to-confirm': { body: QUEUE },
      'POST /api/admin/orders/BN-100001/confirmation': { body: { order: { number: 'BN-100001' } } },
    })
    const user = userEvent.setup()
    renderApp('/to-confirm')
    expect(await screen.findByRole('heading', { name: 'To confirm' })).toBeInTheDocument()
    const card = within((await screen.findByRole('link', { name: 'BN-100001' })).closest('li'))
    expect(card.getByRole('link', { name: /Call 01712 345678/ })).toHaveAttribute('href', 'tel:+8801712345678')
    expect(card.getByText('3 orders before: 2 delivered, 1 cancelled')).toBeInTheDocument()
    expect(card.getByText("Couldn't reach", { selector: 'span' })).toBeInTheDocument()
    expect(card.getByText('2 so far')).toBeInTheDocument()
    expect(card.getByText('Last note: “No answer”')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'To confirm' })).toBeInTheDocument()

    await user.click(card.getByRole('button', { name: 'Cancel order BN-100001' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Cancel order BN-100001?' }))
    await user.click(dialog.getByRole('button', { name: 'Cancel order' }))
    expect(dialog.getByLabelText('Reason')).toHaveAccessibleDescription(/Choose or write the reason/)
    await user.selectOptions(dialog.getByLabelText('Reason'), 'other')
    await user.type(dialog.getByLabelText('The reason'), 'Fake address')
    await user.click(dialog.getByRole('button', { name: 'Cancel order' }))
    const notice = await screen.findByText(/Order BN-100001 cancelled/)
    expect(notice).toHaveFocus()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/confirmation')).toEqual({ outcome: 'cancelled', reason: 'Fake address' })
  })
})

describe('the order grid', () => {
  it('filters by zone, cash on delivery and confirmation, and downloads packing slips and the courier CSV', async () => {
    withSession()
    const ROW = { id: 'BN-100001', number: 'BN-100001', customer: 'Nadia Rahman', guest: true, total: 1080, status: 'processing', paymentStatus: 'unpaid', placedAt: '2026-11-23T09:00:00Z', source: 'storefront', deliveryZone: { code: 'inside_dhaka', name: 'Inside Dhaka' }, confirmationStatus: 'pending' }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders': { body: { orders: [ROW], total: 1 } },
      'GET /api/admin/delivery-zones': { body: ZONES },
      'GET /api/admin/preferences/orders_grid': { body: {} },
    })
    // The two files: a PDF and a CSV, not JSON.
    const files = []
    vi.stubGlobal('fetch', async (input, init = {}) => {
      const url = new URL(input instanceof URL ? input.href : input)
      if (url.pathname === '/api/admin/orders/packing-slips' || url.pathname === '/api/admin/orders/export/courier.csv') {
        files.push({ url, init })
        const pdf = url.pathname.endsWith('packing-slips')
        return new Response(pdf ? '%PDF' : '﻿invoice\n', { headers: { 'Content-Type': pdf ? 'application/pdf' : 'text/csv', 'Content-Disposition': `attachment; filename="${pdf ? 'packing-slips.pdf' : 'courier.csv'}"` } })
      }
      return fetchMock(input, init)
    })
    const user = userEvent.setup()
    renderApp('/orders')
    await screen.findByRole('link', { name: 'BN-100001' })
    await waitFor(() => expect(within(screen.getByLabelText('Delivery zone')).getByRole('option', { name: 'Inside Dhaka' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Delivery zone'), 'inside_dhaka')
    await user.selectOptions(screen.getByLabelText('Cash on delivery'), '1')
    await user.selectOptions(screen.getByLabelText('Confirmation'), 'pending')
    await waitFor(() => {
      const last = calledWith(fetchMock, 'GET', '/api/admin/orders').at(-1)
      expect(Object.fromEntries(last.searchParams)).toMatchObject({ zone: 'inside_dhaka', cod: '1', confirmation: 'pending' })
    })
    expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).toContain('zone=inside_dhaka')

    await user.click(await screen.findByRole('checkbox', { name: 'Select order BN-100001' }))
    await user.selectOptions(screen.getByLabelText('Action'), 'packing-slips-pdf')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Packing slips downloaded (packing-slips.pdf).')).toBeInTheDocument()
    expect(JSON.parse(files[0].init.body)).toEqual({ numbers: ['BN-100001'] })

    // The orders stay ticked for the next file.
    await user.selectOptions(screen.getByLabelText('Action'), 'courier-csv')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText('Courier CSV downloaded (courier.csv).')).toBeInTheDocument()
    expect(files[1].url.searchParams.get('numbers')).toBe('BN-100001')
  })
})
