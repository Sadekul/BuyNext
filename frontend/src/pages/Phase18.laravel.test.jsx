import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrdersPage from './OrdersPage'
import OrderDetailsPage from './OrderDetailsPage'
import TrackOrderPage from './TrackOrderPage'
import DeliveryTracker from '../components/orders/DeliveryTracker'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { expectNoEnglish, switchToBangla } from '../test/i18n'
import { DELIVERY_STEPS } from '../utils/delivery'

// Phase 18 (docs/backend/PHASE18_CONTRACT.md §3): the courier delivery tracker on the order page, the guest
// order lookup and the order list, in English and Bangla.
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const TOTALS = { itemCount: 1, subtotal: 1250, discount: 0, shipping: 60, tax: 0, total: 1310 }
const LINE = { productId: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 1250, discountPercentage: 0, salePrice: 1250, quantity: 1, lineTotal: 1250 }
const ADDRESS = { firstName: 'Rahim', lastName: 'Uddin', line1: 'House 12', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1207', country: 'Bangladesh' }
const ORDER = {
  number: 'BN-100001', status: 'shipped', paymentStatus: 'unpaid', paymentMethod: 'cod', shippingMethod: { id: 'standard', label: 'Standard', eta: '1–2 days' },
  email: 'rahim@example.com', phone: '+8801711000000', shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null, items: [LINE], totals: TOTALS, currency: 'BDT',
  placedAt: '2026-11-20T09:00:00Z', history: [], invoices: [], creditMemos: [],
}
const EVENTS = [
  { deliveryStatus: 'booked', label: 'Booked', message: null, occurredAt: '2026-11-21T04:00:00Z' },
  { deliveryStatus: 'picked_up', label: 'Picked up', message: null, occurredAt: '2026-11-21T09:00:00Z' },
  { deliveryStatus: 'in_transit', label: 'On the way', message: 'Reached the Dhaka hub', occurredAt: '2026-11-22T08:30:00Z' },
]
const courier = (deliveryStatus, extra = {}) => ({
  number: 'SHP-100001', carrier: 'steadfast', carrierLabel: 'Steadfast', trackingNumber: 'SFR123ABC', trackingUrl: 'https://steadfast.com.bd/t/SFR123ABC',
  createdAt: '2026-11-21T04:00:00Z', deliveryStatus, deliveryStatusLabel: deliveryStatus, events: EVENTS, ...extra,
})
const MANUAL = { number: 'SHP-100002', carrier: 'ups', carrierLabel: 'UPS', trackingNumber: '1Z999', trackingUrl: 'https://www.ups.com/track?tracknum=1Z999', createdAt: '2026-11-11T10:00:00Z' }

const STEP_NAMES = { booked: 'Booked', picked_up: 'Picked up', in_transit: 'On the way', out_for_delivery: 'Out for delivery', delivered: 'Delivered' }
const renderTracker = (shipment) => renderWithProviders(<DeliveryTracker shipment={shipment} />)
const steps = () => within(screen.getByRole('list', { name: 'Delivery progress' })).getAllByRole('listitem')

describe('delivery tracker', () => {
  it.each(DELIVERY_STEPS.map((status, index) => [status, index]))('%s: the ordered steps mark where the parcel is (aria-current) and what is done, in words', (status, index) => {
    renderTracker(courier(status))
    const items = steps()
    expect(screen.getByRole('list', { name: 'Delivery progress' }).tagName).toBe('OL')
    expect(items.map((item) => item.textContent.replace(/ \(done\)|Now$/g, ''))).toEqual(Object.values(STEP_NAMES))
    items.forEach((item, at) => expect(item.getAttribute('aria-current'), `${status} step ${at}`).toBe(at === index ? 'step' : null))
    // Not by colour alone: done steps say so, the current one says "Now" (Delivered is the end: no "Now").
    expect(items.filter((item) => item.textContent.includes('(done)'))).toHaveLength(index)
    expect(within(items[index]).queryByText('Now') !== null).toBe(status !== 'delivered')
    expect(screen.getByText(`Status: ${STEP_NAMES[status]}`)).toBeInTheDocument()
    expect(screen.queryByText(/on hold|returning|cancelled/i)).not.toBeInTheDocument()
  })

  it('shows the courier, the tracking code with Copy, the external "Track on" link, and the updates newest first', async () => {
    const user = userEvent.setup() // (user-event installs its own clipboard: replace it after)
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderTracker(courier('in_transit'))
    expect(screen.getByText('Sent with Steadfast')).toBeInTheDocument()
    expect(screen.getByText('SFR123ABC').tagName).toBe('CODE')
    const link = screen.getByRole('link', { name: /Track on Steadfast/ })
    expect(link).toHaveAttribute('href', 'https://steadfast.com.bd/t/SFR123ABC')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('(opens in a new tab)')
    expect(screen.queryByRole('link', { name: /Track with/ })).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Delivery updates' })).toBeInTheDocument()
    const updates = screen.getByRole('heading', { name: 'Delivery updates' }).nextElementSibling
    const rows = within(updates).getAllByRole('listitem')
    expect(rows.map((row) => row.querySelector('strong').textContent)).toEqual(['On the way', 'Picked up', 'Booked'])
    expect(rows[0]).toHaveTextContent('Reached the Dhaka hub')
    expect(rows[0].querySelector('time')).toHaveAttribute('dateTime', '2026-11-22T08:30:00Z')
    expect(rows[0].querySelector('time').textContent).toMatch(/Nov 22, 2026/)

    await user.click(screen.getByRole('button', { name: 'Copy tracking code' }))
    expect(writeText).toHaveBeenCalledWith('SFR123ABC')
    expect(screen.getByRole('status')).toHaveTextContent('Tracking code copied.')
  })

  it('selects the code to copy by hand when the clipboard is not available', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) }, configurable: true })
    renderTracker(courier('booked'))
    await user.click(screen.getByRole('button', { name: 'Copy tracking code' }))
    expect(screen.getByRole('status')).toHaveTextContent(/copy it by hand/)
    expect(window.getSelection().toString()).toBe('SFR123ABC')
  })

  it('on hold is a notice, not a step: the steps stay where the parcel got to', () => {
    renderTracker(courier('on_hold'))
    expect(screen.getByText('On hold', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText(/put your parcel on hold/)).toBeInTheDocument()
    expect(steps()[2]).toHaveAttribute('aria-current', 'step') // the last update was "On the way"
    expect(steps().map((item) => item.textContent)).not.toContain('On hold')
  })

  it.each([
    ['returned', 'Returned', /returning this parcel to us/],
    ['cancelled', 'Delivery cancelled', /delivery was cancelled/],
  ])('%s: a clear notice in place of the steps', (status, title, text) => {
    renderTracker(courier(status))
    expect(screen.queryByRole('list', { name: 'Delivery progress' })).not.toBeInTheDocument()
    expect(screen.getByText(title, { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy tracking code' })).toBeInTheDocument()
  })

  it('partly delivered: a notice, with the steps up to Out for delivery', () => {
    renderTracker(courier('partly_delivered', { events: [] }))
    expect(screen.getByText(/Part of your parcel was delivered/)).toBeInTheDocument()
    expect(steps()[3]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('No updates from the courier yet.')).toBeInTheDocument()
  })

  it.each([
    ['without a delivery status (older answers)', MANUAL],
    ['a manual "shipped" shipment', { ...MANUAL, deliveryStatus: 'shipped', deliveryStatusLabel: 'Shipped', events: [] }],
  ])('%s looks as before, with the carrier’s tracking link', (_name, shipment) => {
    renderTracker(shipment)
    expect(screen.queryByRole('list', { name: 'Delivery progress' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy tracking code' })).not.toBeInTheDocument()
    expect(screen.getByText(/tracking number 1Z999/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Track with UPS/ })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('in Bangla: steps, notice and texts in Bangla, dates with Bangla digits; the tracking code stays as it is', async () => {
    await switchToBangla()
    const { container } = renderTracker(courier('on_hold', { events: [{ deliveryStatus: 'in_transit', label: 'On the way', message: null, occurredAt: '2026-11-22T08:30:00Z' }] }))
    expect(screen.getByRole('list', { name: 'ডেলিভারির অগ্রগতি' })).toBeInTheDocument()
    expect(screen.getByText('অবস্থা: আপাতত আটকে আছে')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ট্র্যাকিং কোড কপি করুন' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Steadfast-এ ট্র্যাক করুন/ })).toBeInTheDocument()
    const time = container.querySelector('time')
    expect(time.textContent).toMatch(/[০-৯]/)
    expect(time.textContent).not.toMatch(/[0-9]/)
    expect(time.textContent).toContain('২০২৬')
    expect(screen.getByText('SFR123ABC')).toBeInTheDocument()
    expectNoEnglish(container, { allow: ['Steadfast', 'SFR123ABC'] })
  })

  it('in Bangla with Latin digits turned off by the store: dates keep 0–9', async () => {
    await switchToBangla({ digits: false })
    const { container } = renderTracker(courier('in_transit'))
    expect(container.querySelector('time').textContent).toContain('2026')
  })
})

describe('the tracker on the order pages', () => {
  const signIn = () => {
    document.cookie = 'buynest_session=session; Path=/'
    window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
  }
  const ME = { 'GET /api/auth/me': { body: { id: 5, firstName: 'Nadia', email: 'nadia@example.com', role: 'customer' } } }

  it('the customer’s order page shows each shipment: the courier tracker and a manual one', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100001': { body: { ...ORDER, shipments: [MANUAL, courier('out_for_delivery')] } } })
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100001', path: '/account/orders/:orderId' })
    const progress = await screen.findByRole('list', { name: 'Delivery progress' })
    expect(within(progress).getByText('Out for delivery').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('link', { name: /Track on Steadfast/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Track with UPS/ })).toBeInTheDocument()
  })

  it('the guest order lookup shows the tracker too', async () => {
    mockFetch({ 'POST /api/shop/orders/lookup': { body: { ...ORDER, shipments: [courier('delivered')] } } })
    const user = userEvent.setup()
    renderWithProviders(<TrackOrderPage />, { route: '/track-order', path: '/track-order' })
    await user.type(screen.getByLabelText('Order number'), 'BN-100001')
    await user.type(screen.getByLabelText('Email'), 'rahim@example.com')
    await user.click(screen.getByRole('button', { name: 'Find my order' }))
    const progress = await screen.findByRole('list', { name: 'Delivery progress' })
    expect(within(progress).getByText('Delivered').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Copy tracking code' })).toBeInTheDocument()
  })

  it('the order list shows the latest delivery status as a small label (none for manual shipments)', async () => {
    signIn()
    const orders = [
      { ...ORDER, shipments: [courier('booked', { number: 'SHP-1' }), courier('in_transit', { number: 'SHP-2' })] },
      { ...ORDER, number: 'BN-100002', shipments: [MANUAL] },
    ]
    mockFetch({ ...ME, 'GET /api/shop/orders': { body: { orders, total: 2, page: 1, perPage: 10, lastPage: 1 } } })
    renderWithProviders(<OrdersPage />, { route: '/account/orders', path: '/account/orders' })
    const row = (await screen.findByRole('link', { name: 'Order BN-100001' })).closest('li')
    expect(within(row).getByText('Delivery: On the way')).toBeInTheDocument()
    const manual = screen.getByRole('link', { name: 'Order BN-100002' }).closest('li')
    expect(within(manual).queryByText(/Delivery:/)).not.toBeInTheDocument()
  })

  it('the order list label in Bangla', async () => {
    signIn()
    await switchToBangla()
    mockFetch({ ...ME, 'GET /api/shop/orders': { body: { orders: [{ ...ORDER, shipments: [courier('delivered')] }], total: 1, page: 1, perPage: 10, lastPage: 1 } } })
    renderWithProviders(<OrdersPage />, { route: '/account/orders', path: '/account/orders' })
    await waitFor(() => expect(screen.getByText('ডেলিভারি: ডেলিভারি হয়েছে')).toBeInTheDocument())
  })
})
