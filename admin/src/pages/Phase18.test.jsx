import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { bookingErrors, deliveryStatus, toBookingValues } from '../utils/couriers'

/*
 * Phase 18 (docs/backend/PHASE18_CONTRACT.md §2): Settings → Couriers, the
 * Book courier dialog (Steadfast, and Pathao's City → Zone → Area), the
 * parcel card with its timeline and Refresh status, the order grid's
 * delivery filter and column, and the bulk Steadfast booking. BuyNest's
 * backend; no courier is ever called (the admin service is mocked).
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url instanceof URL ? url.href : url).pathname === path)
  return call && (typeof call[1].body === 'string' ? JSON.parse(call[1].body) : call[1].body)
}
const calledWith = (fetchMock, method, path) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url instanceof URL ? url.href : url).pathname === path).map(([url]) => new URL(url instanceof URL ? url.href : url))

const SETTINGS = { defaultCourier: 'steadfast', autoSync: true, noteTemplate: 'Handle with care', pathaoItemType: 'parcel', pathaoDeliveryType: 'normal' }
const STEADFAST = { key: 'steadfast', label: 'Steadfast', configured: true, mode: null, balance: null, webhookUrl: 'https://api.example/api/v1/couriers/steadfast/webhook' }
const PATHAO = { key: 'pathao', label: 'Pathao', configured: true, mode: 'sandbox', balance: null, webhookUrl: 'https://api.example/api/v1/couriers/pathao/webhook' }
const COURIERS = { couriers: [STEADFAST, PATHAO], settings: SETTINGS }
const NONE_SET_UP = { couriers: [{ ...STEADFAST, configured: false }, { ...PATHAO, configured: false }], settings: SETTINGS }

const ADDRESS = { firstName: 'Nadia', lastName: 'Rahman', line1: 'House 4', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1216', country: 'Bangladesh', divisionId: 3, districtId: 47, areaId: 1003, area: { id: 1003, name: 'Mirpur', nameEn: 'Mirpur' } }
const ORDER = {
  id: 'BN-100001', number: 'BN-100001', currency: 'BDT', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod',
  shippingMethod: { id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days' }, email: 'nadia@example.com', phone: '+8801712345678',
  shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null,
  customer: { id: 5, guest: false, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com' },
  lines: [{ id: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 1000, quantity: 1, discountedTotal: 1000 }],
  totals: { itemCount: 1, subtotal: 1000, discount: 0, shipping: 60, tax: 0, total: 1060, refunded: 0 }, items: 1, placedAt: '2026-11-25T09:00:00Z',
  invoices: [], creditMemos: [], shipments: [], history: [], payment: { provider: null, paidAt: null, url: null, canPay: false },
  codDue: 1060, codCollection: null, confirmationStatus: 'confirmed', confirmation: { status: 'confirmed', attempts: 1, confirmedAt: '2026-11-25T09:30:00Z', log: [] },
  live: true,
}
const UNCONFIRMED = { ...ORDER, confirmationStatus: 'pending', confirmation: { status: 'pending', attempts: 0, confirmedAt: null, log: [] } }
const BOOKING = {
  booking: {
    defaultCourier: 'steadfast',
    couriers: [{ key: 'steadfast', label: 'Steadfast', mode: null }, { key: 'pathao', label: 'Pathao', mode: 'sandbox' }],
    codAmount: 1060, weightKg: 0.5, note: 'Handle with care', phone: '01712345678', addressLine: 'House 4, Mirpur, Dhaka', pathaoMatch: { cityId: 1, zoneId: 298, areaId: null }, problem: null, awaitsConfirmation: false,
  },
}
const PATHAO_PLACES = {
  'GET /api/admin/couriers/pathao/cities': { body: { options: [{ id: 1, name: 'Dhaka' }, { id: 2, name: 'Chattogram' }] } },
  'GET /api/admin/couriers/pathao/cities/1/zones': { body: { options: [{ id: 298, name: 'Mirpur 10' }, { id: 299, name: 'Gulshan 1' }] } },
  'GET /api/admin/couriers/pathao/cities/2/zones': { body: { options: [{ id: 401, name: 'Agrabad' }] } },
  'GET /api/admin/couriers/pathao/zones/298/areas': { body: { options: [{ id: 37, name: 'Senpara', homeDelivery: true, pickup: true }] } },
  'GET /api/admin/couriers/pathao/zones/401/areas': { body: { options: [] } },
}
const SHIPMENT = {
  number: 'SHP-100001', orderNumber: 'BN-100001', carrier: 'steadfast', carrierLabel: 'Steadfast', trackingNumber: '15BAEB8A', trackingUrl: 'https://steadfast.com.bd/t/15BAEB8A', createdAt: '2026-11-25T10:00:00Z',
  deliveryStatus: 'booked', deliveryStatusLabel: 'Booked',
  courier: {
    key: 'steadfast', label: 'Steadfast', consignmentId: '1424107', trackingCode: '15BAEB8A', bookedViaApi: true, courierStatus: 'in_review', deliveryStatus: 'booked', deliveryStatusLabel: 'Booked',
    codAmount: 1060, courierFee: 60, collected: null, statusUpdatedAt: '2026-11-25T10:00:00Z', lastSyncedAt: '2026-11-25T10:05:00Z',
  },
  events: [{ deliveryStatus: 'booked', label: 'Booked', courierStatus: 'in_review', message: null, source: 'booking', occurredAt: '2026-11-25T10:00:00Z' }],
}

function orderPage(order, extra = {}) {
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: ADMIN },
    'GET /api/catalog/store': { body: { data: {} } },
    'GET /api/admin/orders/BN-100001': { body: order },
    'GET /api/admin/couriers': { body: COURIERS },
    'GET /api/admin/orders/BN-100001/courier-booking': { body: BOOKING },
    ...PATHAO_PLACES,
    ...extra,
  })
  renderApp('/orders/BN-100001')
  return fetchMock
}

describe('helpers', () => {
  it('checks the booking form and builds what is sent', () => {
    const form = { courier: 'pathao', codAmount: '2000', weightKg: '0', note: '', notify: true, override: false, overrideReason: '', pathaoCityId: '', pathaoZoneId: '', pathaoAreaId: '' }
    expect(Object.keys(bookingErrors(form, { maxCod: 1060, unconfirmed: true })).sort()).toEqual(['codAmount', 'overrideConfirmation', 'pathaoCityId', 'pathaoZoneId', 'weightKg'])
    expect(bookingErrors({ ...form, courier: '', codAmount: '0', weightKg: '', override: true, overrideReason: 'ok' }, { maxCod: 1060, unconfirmed: true })).toEqual({ courier: expect.any(Array), confirmationOverride: expect.any(Array) })
    expect(toBookingValues({ ...form, codAmount: '500', weightKg: '1.25', note: ' Fragile ', pathaoCityId: '1', pathaoZoneId: '298', pathaoAreaId: '37', override: true, overrideReason: ' SMS ' }, { unconfirmed: true })).toEqual({
      courier: 'pathao', codAmount: 500, weightKg: 1.25, note: 'Fragile', notifyCustomer: true, confirmationOverride: 'SMS', pathao: { cityId: 1, zoneId: 298, areaId: 37 },
    })
    expect(toBookingValues({ ...form, courier: 'steadfast', codAmount: '0', weightKg: '', notify: false }, { unconfirmed: false })).toEqual({ courier: 'steadfast', codAmount: 0, note: null, notifyCustomer: false })
    expect(deliveryStatus('on_hold')).toMatchObject({ label: 'On hold', tone: 'warning' })
    expect(deliveryStatus('delivered', 'ডেলিভারি হয়েছে').label).toBe('ডেলিভারি হয়েছে')
  })
})

describe('Settings → Couriers', () => {
  it('shows each courier’s set-up state, webhook URL and balance, never a secret field, and saves the defaults', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/couriers': (url) => ({
        body: url.searchParams.get('balance') === '1' ? { ...COURIERS, couriers: [{ ...STEADFAST, balance: '৳ 1,250.00' }, { ...PATHAO, configured: false }] } : { ...COURIERS, couriers: [STEADFAST, { ...PATHAO, configured: false }] },
      }),
      'PUT /api/admin/couriers/settings': { body: { settings: { ...SETTINGS, defaultCourier: 'pathao' } } },
    })
    const user = userEvent.setup()
    renderApp('/settings/couriers')
    const steadfast = within(await screen.findByRole('region', { name: 'Steadfast' }))
    const pathao = within(screen.getByRole('region', { name: 'Pathao' }))
    expect(steadfast.getByText('Set up')).toBeInTheDocument()
    expect(pathao.getByText('Not set up')).toBeInTheDocument()
    expect(pathao.getByText('Sandbox (test bookings)')).toBeInTheDocument()
    expect(steadfast.getByLabelText('Webhook URL')).toHaveValue('https://api.example/api/v1/couriers/steadfast/webhook')
    expect(steadfast.getByRole('button', { name: 'Copy webhook URL for Steadfast' })).toBeInTheDocument()
    // The variable names, never a value, and no field to type a key into.
    expect(pathao.getByText('PATHAO_CLIENT_SECRET')).toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByLabelText(/key|secret|password|token/i)).not.toBeInTheDocument()
    // Only Steadfast has a balance.
    expect(pathao.queryByRole('button', { name: 'Check balance' })).not.toBeInTheDocument()
    await user.click(steadfast.getByRole('button', { name: 'Check balance' }))
    expect(await steadfast.findByText('Balance: ৳ 1,250.00')).toBeInTheDocument()
    expect(calledWith(fetchMock, 'GET', '/api/admin/couriers').at(-1).searchParams.get('balance')).toBe('1')

    const form = within(screen.getByRole('form', { name: 'Booking defaults' }))
    expect(form.getByLabelText('Default courier')).toHaveValue('steadfast')
    await user.selectOptions(form.getByLabelText('Default courier'), 'pathao')
    await user.selectOptions(form.getByLabelText('Pathao delivery type'), 'on_demand')
    await user.click(form.getByRole('checkbox', { name: 'Check booked parcels with the courier every 30 minutes' }))
    await user.clear(form.getByLabelText('Default note for the courier (optional)'))
    await user.click(form.getByRole('button', { name: 'Save courier settings' }))
    expect(await screen.findByText('Courier settings saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/couriers/settings')).toEqual({ defaultCourier: 'pathao', autoSync: false, noteTemplate: null, pathaoItemType: 'parcel', pathaoDeliveryType: 'on_demand' })
  })

  it('is read-only without settings.edit', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: { ...ADMIN, role: { id: 5, name: 'Viewer' }, permissions: ['settings.view', 'orders.view'] } },
      'GET /api/admin/couriers': { body: COURIERS },
    })
    renderApp('/settings/couriers')
    const form = within(await screen.findByRole('form', { name: 'Booking defaults' }))
    expect(form.getByLabelText('Default courier')).toBeDisabled()
    expect(form.queryByRole('button', { name: 'Save courier settings' })).not.toBeInTheDocument()
  })
})

describe('Book courier', () => {
  it('is disabled with the reason when no courier is set up, or the order can’t ship yet', async () => {
    orderPage(ORDER, { 'GET /api/admin/couriers': { body: NONE_SET_UP } })
    const button = await screen.findByRole('button', { name: 'Book courier' })
    await waitFor(() => expect(button).toHaveAccessibleDescription('No courier is set up yet (Settings → Couriers). Set up a courier'))
    expect(button).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Set up a courier' })).toHaveAttribute('href', '/settings/couriers')
  })

  it('waits for payment on an unpaid card order', async () => {
    orderPage({ ...ORDER, status: 'pending_payment', paymentMethod: 'card', codDue: undefined, confirmationStatus: undefined, confirmation: undefined })
    const button = await screen.findByRole('button', { name: 'Book courier' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/once the order is processing/)
  })

  it('is not offered without shipments.create', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: { ...ADMIN, role: { id: 5, name: 'Viewer' }, permissions: ['orders.view', 'invoices.create'] } },
      'GET /api/catalog/store': { body: { data: {} } },
      'GET /api/admin/orders/BN-100001': { body: ORDER },
    })
    renderApp('/orders/BN-100001')
    await screen.findByRole('heading', { name: 'Manage order' })
    expect(screen.queryByRole('button', { name: 'Book courier' })).not.toBeInTheDocument()
  })

  it('books Steadfast with the checked amounts, and shows the courier’s own error', async () => {
    let attempt = 0
    const fetchMock = orderPage(ORDER, {
      'POST /api/admin/orders/BN-100001/courier-booking': () =>
        ++attempt === 1
          ? { status: 422, body: { message: 'Steadfast: The recipient phone must be 11 digits.', errors: { courier: ['Steadfast: The recipient phone must be 11 digits.'] } } }
          : { status: 201, body: { shipment: SHIPMENT } },
    })
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Book courier' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    const dialog = within(await screen.findByRole('dialog', { name: 'Book a courier for order BN-100001' }))
    // The default courier, the recipient, and the amounts the API suggested.
    expect(await dialog.findByRole('radio', { name: /Steadfast/ })).toBeChecked()
    const recipient = within(dialog.getByRole('region', { name: 'Recipient' }))
    expect(recipient.getByText('Mobile').nextElementSibling).toHaveTextContent('01712345678')
    expect(recipient.getByText('Address').nextElementSibling).toHaveTextContent('House 4, Mirpur, Dhaka')
    expect(recipient.getByRole('link', { name: 'Edit the customer\'s addresses' })).toHaveAttribute('href', '/customers/5')
    expect(dialog.getByLabelText('Cash to collect (BDT)')).toHaveValue(1060)
    expect(dialog.getByLabelText('Weight (kg)')).toHaveValue(0.5)
    expect(dialog.getByLabelText('Note for the courier (optional)')).toHaveValue('Handle with care')
    expect(dialog.queryByLabelText('City')).not.toBeInTheDocument()

    // More than the order total is caught before sending.
    await user.clear(dialog.getByLabelText('Cash to collect (BDT)'))
    await user.type(dialog.getByLabelText('Cash to collect (BDT)'), '5000')
    await user.click(dialog.getByRole('button', { name: 'Book with Steadfast' }))
    expect(dialog.getByLabelText('Cash to collect (BDT)')).toHaveAccessibleDescription(/more than the order total/)
    expect(calledWith(fetchMock, 'POST', '/api/admin/orders/BN-100001/courier-booking')).toHaveLength(0)

    await user.clear(dialog.getByLabelText('Cash to collect (BDT)'))
    await user.type(dialog.getByLabelText('Cash to collect (BDT)'), '1000')
    await user.click(dialog.getByRole('button', { name: 'Book with Steadfast' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Steadfast: The recipient phone must be 11 digits.')
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/courier-booking')).toEqual({ courier: 'steadfast', codAmount: 1000, weightKg: 0.5, note: 'Handle with care', notifyCustomer: true })

    await user.click(dialog.getByRole('button', { name: 'Book with Steadfast' }))
    expect(await screen.findByText('Booked with Steadfast (consignment 1424107, tracking code 15BAEB8A). Shipment SHP-100001 created and the order is now shipped. The customer was emailed.')).toBeInTheDocument()
  })

  it('an unconfirmed COD order needs the reason, as in the Ship dialog', async () => {
    const fetchMock = orderPage(UNCONFIRMED, { 'POST /api/admin/orders/BN-100001/courier-booking': { status: 201, body: { shipment: SHIPMENT } } })
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Book courier' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    const dialog = within(await screen.findByRole('dialog', { name: 'Book a courier for order BN-100001' }))
    await user.click(await dialog.findByRole('button', { name: 'Book with Steadfast' }))
    expect(dialog.getByRole('checkbox', { name: 'Book without confirmation' })).toHaveAccessibleDescription(/Confirm the order by phone first/)
    await user.click(dialog.getByRole('checkbox', { name: 'Book without confirmation' }))
    await user.type(dialog.getByLabelText('Reason'), 'Confirmed by SMS')
    await user.click(dialog.getByRole('button', { name: 'Book with Steadfast' }))
    expect(await screen.findByText(/Booked with Steadfast/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/courier-booking')).toMatchObject({ courier: 'steadfast', confirmationOverride: 'Confirmed by SMS' })
  })

  it('Pathao: City → Zone → Area from the API, pre-selected from the order’s place', async () => {
    const fetchMock = orderPage(ORDER, { 'POST /api/admin/orders/BN-100001/courier-booking': { status: 201, body: { shipment: { ...SHIPMENT, courier: { ...SHIPMENT.courier, key: 'pathao', label: 'Pathao' } } } } })
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Book courier' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    const dialog = within(await screen.findByRole('dialog', { name: 'Book a courier for order BN-100001' }))
    await user.click(await dialog.findByRole('radio', { name: /Pathao/ }))
    expect(dialog.getByRole('radio', { name: /Pathao/ })).toHaveAccessibleName(/sandbox/)
    // The matched city and zone are chosen once their lists load.
    await waitFor(() => expect(dialog.getByLabelText('City')).toHaveValue('1'))
    await waitFor(() => expect(dialog.getByLabelText('Zone')).toHaveValue('298'))
    await waitFor(() => expect(within(dialog.getByLabelText('Area (optional)')).getByRole('option', { name: 'Senpara' })).toBeInTheDocument())
    expect(dialog.getByLabelText('Area (optional)')).toHaveValue('')
    expect(dialog.getByRole('button', { name: 'Book with Pathao' })).toBeInTheDocument()

    // Another city clears the zone and area.
    await user.selectOptions(dialog.getByLabelText('City'), '2')
    expect(dialog.getByLabelText('Zone')).toHaveValue('')
    expect(dialog.getByLabelText('Area (optional)')).toBeDisabled()
    await user.click(dialog.getByRole('button', { name: 'Book with Pathao' }))
    expect(dialog.getByLabelText('Zone')).toHaveAccessibleDescription(/Choose the zone/)
    await user.selectOptions(dialog.getByLabelText('City'), '1')
    await waitFor(() => expect(within(dialog.getByLabelText('Zone')).getByRole('option', { name: 'Mirpur 10' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('Zone'), '298')
    await waitFor(() => expect(within(dialog.getByLabelText('Area (optional)')).getByRole('option', { name: 'Senpara' })).toBeInTheDocument())
    await user.selectOptions(dialog.getByLabelText('Area (optional)'), '37')
    await user.click(dialog.getByRole('button', { name: 'Book with Pathao' }))
    expect(await screen.findByText(/Booked with Pathao/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/courier-booking')).toEqual({
      courier: 'pathao', codAmount: 1060, weightKg: 0.5, note: 'Handle with care', notifyCustomer: true, pathao: { cityId: 1, zoneId: 298, areaId: 37 },
    })
  })

  it('Pathao without a matching city says so and pre-selects nothing', async () => {
    orderPage(ORDER, { 'GET /api/admin/orders/BN-100001/courier-booking': { body: { booking: { ...BOOKING.booking, defaultCourier: 'pathao', pathaoMatch: { cityId: null, zoneId: null, areaId: null } } } } })
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Book courier' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    const dialog = within(await screen.findByRole('dialog', { name: 'Book a courier for order BN-100001' }))
    expect(await dialog.findByText("Choose the city: none of Pathao's cities matched the order's district.")).toBeInTheDocument()
    await waitFor(() => expect(within(dialog.getByLabelText('City')).getByRole('option', { name: 'Dhaka' })).toBeInTheDocument())
    expect(dialog.getByLabelText('City')).toHaveValue('')
    expect(dialog.getByLabelText('Zone')).toBeDisabled()
  })
})

describe('Book courier: the API’s reason', () => {
  it('shows why the order can’t be booked now (here: the store currency)', async () => {
    orderPage(ORDER, { 'GET /api/admin/orders/BN-100001/courier-booking': { body: { booking: { ...BOOKING.booking, problem: 'Couriers collect taka: switch the store currency to taka first.' } } } })
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Book courier' })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    const dialog = within(await screen.findByRole('dialog', { name: 'Book a courier for order BN-100001' }))
    expect(await dialog.findByRole('note')).toHaveTextContent('Couriers collect taka: switch the store currency to taka first.')
    expect(dialog.getByRole('button', { name: 'Book with Steadfast' })).toBeDisabled()
  })
})

describe('the parcel on the order page', () => {
  it('shows the courier, codes, amounts and timeline newest first; Refresh status asks the courier', async () => {
    const delivered = {
      ...SHIPMENT,
      deliveryStatus: 'delivered',
      deliveryStatusLabel: 'Delivered',
      courier: { ...SHIPMENT.courier, deliveryStatus: 'delivered', deliveryStatusLabel: 'Delivered', courierStatus: 'delivered', collected: 1060 },
      events: [...SHIPMENT.events, { deliveryStatus: 'delivered', label: 'Delivered', courierStatus: 'delivered', message: 'Handed to the customer', source: 'sync', occurredAt: '2026-11-26T15:00:00Z' }],
    }
    const fetchMock = orderPage({ ...ORDER, status: 'shipped', shipments: [SHIPMENT] }, { 'POST /api/admin/shipments/SHP-100001/sync': { body: { shipment: delivered } } })
    const user = userEvent.setup()
    const card = within(await screen.findByRole('region', { name: 'Steadfast parcel · SHP-100001' }))
    expect(card.getByText('Booked', { selector: '.courier-shipment__status .status' })).toBeInTheDocument()
    expect(card.getByText('Consignment').nextElementSibling).toHaveTextContent('1424107')
    expect(card.getByRole('button', { name: 'Copy consignment ID 1424107' })).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Copy tracking code 15BAEB8A' })).toBeInTheDocument()
    expect(card.getByRole('link', { name: /Track on Steadfast/ })).toHaveAttribute('href', 'https://steadfast.com.bd/t/15BAEB8A')
    expect(card.getByRole('link', { name: /Track on Steadfast/ })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(card.getByText('Courier fee').nextElementSibling).toHaveTextContent('60')
    expect(card.getByText('Collected').nextElementSibling).toHaveTextContent('Nothing reported yet')
    expect(card.queryByRole('note')).not.toBeInTheDocument()
    // No booking from a shipped order.
    expect(screen.queryByRole('button', { name: 'Book courier' })).not.toBeInTheDocument()

    await user.click(card.getByRole('button', { name: 'Refresh status of SHP-100001' }))
    expect(await card.findByText('Steadfast says: Delivered.')).toBeInTheDocument()
    expect(calledWith(fetchMock, 'POST', '/api/admin/shipments/SHP-100001/sync')).toHaveLength(1)
  })

  it('lists the events newest first and explains what to do with a returned parcel', async () => {
    const returned = {
      ...SHIPMENT,
      deliveryStatus: 'returned',
      deliveryStatusLabel: 'Returned',
      courier: { ...SHIPMENT.courier, deliveryStatus: 'returned', deliveryStatusLabel: 'Returned', courierStatus: 'return' },
      events: [
        { deliveryStatus: 'booked', label: 'Booked', courierStatus: 'pending', message: null, source: 'booking', occurredAt: '2026-11-25T10:00:00Z' },
        { deliveryStatus: 'returned', label: 'Returned', courierStatus: 'return', message: 'Customer refused', source: 'webhook', occurredAt: '2026-11-27T12:00:00Z' },
        { deliveryStatus: 'in_transit', label: 'In transit', courierStatus: 'at_the_sorting_hub', message: null, source: 'sync', occurredAt: '2026-11-26T08:00:00Z' },
      ],
    }
    orderPage({ ...ORDER, status: 'shipped', shipments: [returned] })
    const card = within(await screen.findByRole('region', { name: 'Steadfast parcel · SHP-100001' }))
    expect(card.getByRole('note', { name: 'Returned: what to do next' })).toHaveTextContent(/coming back to you/)
    const steps = within(card.getByRole('list', { name: 'Tracking history' })).getAllByRole('listitem')
    expect(steps.map((step) => step.querySelector('.status').textContent)).toEqual(['Returned', 'In transit', 'Booked'])
    expect(steps[0]).toHaveTextContent('reported by the courier')
    expect(steps[0]).toHaveTextContent('Customer refused')
    // The documents list shows the status too (words, not only colour).
    expect(within(screen.getByRole('region', { name: 'Shipments' })).getByText('Returned')).toBeInTheDocument()
  })
})

describe('the order grid', () => {
  const ROWS = [
    { id: 'BN-100001', number: 'BN-100001', customer: 'Nadia Rahman', guest: true, total: 1060, status: 'processing', paymentStatus: 'unpaid', placedAt: '2026-11-25T09:00:00Z', source: 'storefront' },
    { id: 'BN-100002', number: 'BN-100002', customer: 'Rafi Ahmed', guest: true, total: 500, status: 'shipped', paymentStatus: 'unpaid', placedAt: '2026-11-25T09:00:00Z', source: 'storefront', deliveryStatus: 'on_hold', deliveryStatusLabel: 'On hold' },
  ]
  const grid = (extra = {}) => {
    withSession()
    return mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders': { body: { orders: ROWS, total: 2 } },
      'GET /api/admin/delivery-zones': { body: { zones: [] } },
      'GET /api/admin/preferences/orders_grid': { body: { columns: ['order', 'customer', 'status', 'delivery'] } },
      'GET /api/admin/couriers': { body: COURIERS },
      ...extra,
    })
  }

  it('filters by delivery progress and shows each order’s', async () => {
    const fetchMock = grid()
    const user = userEvent.setup()
    renderApp('/orders')
    await screen.findByRole('link', { name: 'BN-100001' })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Delivery status' })).toBeInTheDocument())
    expect(screen.getByRole('row', { name: /BN-100002/ })).toHaveTextContent('On hold')
    await user.selectOptions(screen.getByLabelText('Delivery progress'), 'on_hold')
    await waitFor(() => expect(calledWith(fetchMock, 'GET', '/api/admin/orders').at(-1).searchParams.get('delivery')).toBe('on_hold'))
  })

  it('books the selected orders with Steadfast and lists what was booked and what was not', async () => {
    const fetchMock = grid({
      'POST /api/admin/orders/courier-bookings': {
        body: { booked: [{ number: 'BN-100001', consignmentId: '1424107', trackingCode: '15BAEB8A' }], failed: [{ number: 'BN-100002', message: 'This order is already shipped.' }] },
      },
    })
    const user = userEvent.setup()
    renderApp('/orders')
    await user.click(await screen.findByRole('checkbox', { name: 'Select all orders on this page' }))
    await waitFor(() => expect(within(screen.getByLabelText('Action')).getByRole('option', { name: 'Book with Steadfast' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Action'), 'book-steadfast')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Steadfast booking results' }))
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/courier-bookings')).toEqual({ courier: 'steadfast', numbers: ['BN-100001', 'BN-100002'] })
    expect(dialog.getByText('1 order booked with Steadfast; 1 order not booked.')).toBeInTheDocument()
    expect(within(dialog.getByRole('region', { name: 'Booked (1)' })).getByRole('listitem')).toHaveTextContent('BN-100001 · consignment 1424107 · tracking code 15BAEB8A')
    expect(within(dialog.getByRole('region', { name: 'Not booked (1)' })).getByRole('listitem')).toHaveTextContent('BN-100002: This order is already shipped.')
    await user.click(dialog.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText(/1 order booked with Steadfast\./)).toBeInTheDocument()
  })

  it('offers no Steadfast bulk booking until Steadfast is set up', async () => {
    grid({ 'GET /api/admin/couriers': { body: NONE_SET_UP } })
    const user = userEvent.setup()
    renderApp('/orders')
    await user.click(await screen.findByRole('checkbox', { name: 'Select order BN-100001' }))
    await waitFor(() => expect(within(screen.getByLabelText('Action')).getByRole('option', { name: 'Courier CSV' })).toBeInTheDocument())
    expect(within(screen.getByLabelText('Action')).queryByRole('option', { name: 'Book with Steadfast' })).not.toBeInTheDocument()
  })
})

describe('Shipments and the Ship dialog', () => {
  it('lists the delivery status and filters by the new carriers', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/shipments': { body: { shipments: [{ ...SHIPMENT, itemCount: 1, order: { customerName: 'Nadia Rahman' } }], total: 1 } },
    })
    const user = userEvent.setup()
    renderApp('/shipments')
    const row = await screen.findByRole('row', { name: /SHP-100001/ })
    expect(row).toHaveTextContent('Booked')
    await user.selectOptions(screen.getByLabelText('Carrier'), 'pathao')
    await waitFor(() => expect(calledWith(fetchMock, 'GET', '/api/admin/shipments').at(-1).searchParams.get('carrier')).toBe('pathao'))
    for (const name of ['Steadfast', 'Pathao', 'RedX', 'Paperfly', 'Sundarban Courier']) expect(within(screen.getByLabelText('Carrier')).getByRole('option', { name })).toBeInTheDocument()
  })

  it('the manual Ship dialog offers the Bangladesh couriers', async () => {
    orderPage(ORDER)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Ship' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Ship order BN-100001' }))
    expect(within(dialog.getByLabelText('Carrier')).getByRole('option', { name: 'RedX' })).toBeInTheDocument()
    expect(within(dialog.getByLabelText('Carrier')).getByRole('option', { name: 'Sundarban Courier' })).toBeInTheDocument()
  })
})
