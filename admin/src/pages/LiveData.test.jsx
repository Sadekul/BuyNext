import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

// Products and orders from BuyNest's API (VITE_API_PROVIDER=laravel with Laravel accounts).
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const ADDRESS = { firstName: 'Ava', lastName: 'Guest', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' }
const ORDER = {
  id: 'BN-100001', number: 'BN-100001', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod',
  shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' }, email: 'ava@example.com', phone: '+15550100100',
  shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null,
  customer: { id: null, guest: true, firstName: 'Ava', lastName: 'Guest', email: 'ava@example.com' },
  lines: [{ id: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 8.94, quantity: 2, discountedTotal: 17.88 }],
  totals: { itemCount: 2, subtotal: 17.88, discount: 0, shipping: 4.99, tax: 0, total: 22.87 }, items: 2, placedAt: '2026-11-10T09:41:02Z',
  history: [{ status: 'processing', paymentStatus: 'unpaid', note: 'Order placed.', adminName: null, customerNotified: false, createdAt: '2026-11-10T09:41:02Z' }],
  live: true,
}
const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.find(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}

describe('real products', () => {
  it('lists products with their status and no demo notice, and filters by status', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [{ slug: 'beauty', name: 'Beauty' }] },
      'GET /api/admin/products': { body: { products: [{ id: 1, title: 'Mascara', category: 'beauty', price: 9.99, stock: 99, status: 'draft' }], total: 1, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/products')
    const row = (await screen.findByText('Mascara')).closest('tr')
    expect(within(row).getByText('Draft')).toBeInTheDocument()
    expect(screen.queryByText(/Demo data from DummyJSON/)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Status'), 'archived')
    const last = new URL(fetchMock.mock.calls.at(-1)[0])
    expect(last.searchParams.get('status')).toBe('archived')
  })

  it('creates a product with a status, then opens it for editing', async () => {
    withSession()
    const created = { id: 195, title: 'Lamp', category: 'beauty', brand: '', description: '', price: 19.99, discountPercentage: 0, stock: 5, status: 'draft' }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/categories': { body: [{ slug: 'beauty', name: 'Beauty' }] },
      'POST /api/admin/products': { status: 201, body: { product: created, live: true } },
      'GET /api/admin/products/195': { body: { ...created, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/products/new')
    await user.type(await screen.findByLabelText('Name'), 'Lamp')
    await user.selectOptions(screen.getByLabelText('Category'), 'beauty')
    await user.selectOptions(screen.getByLabelText('Status'), 'draft')
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(await screen.findByText('Product created. It is not shown in the store until its status is Active.')).toHaveAttribute('role', 'status')
    expect(screen.getByRole('heading', { name: 'Lamp' })).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/products')).toMatchObject({ title: 'Lamp', status: 'draft' })
  })
})

describe('real orders', () => {
  it('filters orders by status and payment, showing both as icon and words', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders': { body: { orders: [{ id: 'BN-100001', number: 'BN-100001', customer: 'Ava Guest', guest: true, total: 22.87, status: 'processing', paymentStatus: 'unpaid', placedAt: ORDER.placedAt }], total: 1, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/orders')
    const row = (await screen.findByRole('link', { name: 'BN-100001' })).closest('tr')
    expect(within(row).getByText('Processing')).toBeInTheDocument()
    expect(within(row).getByText('Unpaid')).toBeInTheDocument()
    expect(within(row).getByText('· Guest', { exact: false })).toHaveTextContent('Guest')

    await user.selectOptions(screen.getByLabelText('Payment'), 'paid')
    await user.type(screen.getByLabelText('Search orders'), 'ava')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    const params = new URL(fetchMock.mock.calls.at(-1)[0]).searchParams
    expect(params.get('paymentStatus')).toBe('paid')
    expect(params.get('q')).toBe('ava')
  })

  it('offers Invoice, Ship, and Cancel (no phase 2 shortcuts), and ships with a carrier and tracking number', async () => {
    withSession()
    let current = ORDER
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': () => ({ body: current }),
      'POST /api/admin/orders/BN-100001/shipments': (url, init) => {
        const sent = JSON.parse(init.body)
        const shipment = { number: 'SHP-100001', carrier: sent.carrier, carrierLabel: 'UPS', trackingNumber: sent.trackingNumber, trackingUrl: 'https://www.ups.com/track?tracknum=1Z999', createdAt: '2026-11-11T10:00:00Z', adminName: 'Emily' }
        current = { ...current, status: 'shipped', shipments: [shipment] }
        return { status: 201, body: { shipment, live: true } }
      },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')

    const ship = await screen.findByRole('button', { name: 'Ship' })
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument()
    for (const old of ['Mark as paid', 'Mark as shipped', 'Mark as delivered', 'Refund']) expect(screen.queryByRole('button', { name: old })).not.toBeInTheDocument()

    await user.click(ship)
    const dialog = screen.getByRole('dialog', { name: 'Ship order BN-100001' })
    await user.click(within(dialog).getByRole('button', { name: 'Create shipment' }))
    expect(within(dialog).getByLabelText('Carrier')).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByLabelText('Carrier')).toHaveAccessibleDescription('Choose a carrier.')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    await user.selectOptions(within(dialog).getByLabelText('Carrier'), 'ups')
    await user.type(within(dialog).getByLabelText('Tracking number (optional)'), '1Z999')
    await user.click(within(dialog).getByLabelText('Email the customer the tracking details'))
    await user.click(within(dialog).getByRole('button', { name: 'Create shipment' }))

    const notice = await screen.findByText(/Shipment SHP-100001 created with UPS tracking number 1Z999/)
    expect(notice).toHaveFocus()
    expect(notice.closest('[role="status"]')).not.toBeNull()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/shipments')).toEqual({ carrier: 'ups', trackingNumber: '1Z999', notifyCustomer: false })
    const track = await screen.findByRole('link', { name: /1Z999/ })
    expect(track).toHaveAttribute('target', '_blank')
    expect(track.getAttribute('rel')).toMatch(/noopener/)
    expect(await screen.findByRole('button', { name: 'Mark as delivered' })).toBeInTheDocument()
  })

  it('invoices an order awaiting payment, which moves it to processing', async () => {
    withSession()
    let current = { ...ORDER, status: 'pending_payment', paymentMethod: 'card' }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': () => ({ body: current }),
      'POST /api/admin/orders/BN-100001/invoices': () => {
        const invoice = { number: 'INV-100001', orderNumber: 'BN-100001', amount: 22.87, createdAt: '2026-11-11T10:00:00Z', adminName: 'Emily' }
        current = { ...current, status: 'processing', paymentStatus: 'paid', invoices: [invoice] }
        return { status: 201, body: { invoice, live: true } }
      },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    expect(await screen.findByText(/invoice the order once the money has arrived/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ship' })).not.toBeInTheDocument() // card orders are invoiced first
    await user.click(screen.getByRole('button', { name: 'Invoice' }))
    const dialog = screen.getByRole('dialog', { name: 'Invoice order BN-100001' })
    expect(dialog).toHaveTextContent('Records a payment of $22.87')
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Bank transfer received')
    await user.click(within(dialog).getByRole('button', { name: 'Create invoice' }))
    expect(await screen.findByText('Invoice INV-100001 created: payment of $22.87 recorded. The order is now processing. The customer was emailed.')).toHaveFocus()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/invoices')).toEqual({ note: 'Bank transfer received', notifyCustomer: true })
    expect(await screen.findByRole('link', { name: 'INV-100001' })).toHaveAttribute('href', '/invoices/INV-100001')
    expect(screen.getByRole('button', { name: 'Ship' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument() // paid: refund instead
    expect(screen.getByRole('button', { name: 'Refund' })).toBeInTheDocument()
  })

  it('refunds with quantities bounded by what is refundable, a live total, and the server’s messages on the fields', async () => {
    withSession()
    const paid = { ...ORDER, status: 'delivered', paymentStatus: 'paid', invoices: [{ number: 'INV-100001', amount: 22.87, createdAt: '2026-11-10T10:00:00Z' }] }
    const limits = { items: [{ orderItemId: 11, name: 'Mascara', sku: 'BEA-1', ordered: 2, refunded: 0, refundable: 2, unitRefund: 8.94 }], shippingRefundable: 4.99, maxTotal: 22.87 }
    let answer = { status: 422, body: { message: 'Invalid', errors: { 'items.0.quantity': ['Only 1 Mascara can still be refunded.'] } } }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': { body: paid },
      'GET /api/admin/orders/BN-100001/refundable': { body: limits },
      'POST /api/admin/orders/BN-100001/credit-memos': () => answer,
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    await user.click(await screen.findByRole('button', { name: 'Refund' }))
    const dialog = screen.getByRole('dialog', { name: 'Refund order BN-100001' })
    expect(dialog).toHaveTextContent('return the money yourself by the original payment method')
    const quantity = await within(dialog).findByLabelText('Quantity of Mascara to refund (up to 2)')
    expect(quantity).toHaveAttribute('max', '2')

    await user.type(quantity, '3')
    await user.click(within(dialog).getByRole('button', { name: /^Refund \$/ }))
    expect(quantity).toHaveAttribute('aria-invalid', 'true')
    expect(quantity).toHaveAccessibleDescription('At most 2 can be refunded.')

    await user.clear(quantity)
    await user.type(quantity, '2')
    await user.type(within(dialog).getByLabelText('Shipping refund (USD)'), '4.99')
    await user.type(within(dialog).getByLabelText('Adjustment (USD)'), '-1')
    expect(within(dialog).getByText('Estimated total to refund').closest('p')).toHaveTextContent('$21.87')
    await user.click(within(dialog).getByLabelText('Return the refunded items to stock'))
    await user.click(within(dialog).getByRole('button', { name: 'Refund $21.87' }))

    expect(await within(dialog).findByText('Only 1 Mascara can still be refunded.')).toBeInTheDocument()
    expect(quantity).toHaveAttribute('aria-invalid', 'true')
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/credit-memos')).toEqual({ items: [{ orderItemId: 11, quantity: 2 }], shippingRefund: 4.99, adjustment: -1, restock: true, notifyCustomer: true })

    answer = { status: 201, body: { creditMemo: { number: 'CM-100001', total: 12.93, restocked: false, items: [] }, live: true } }
    await user.clear(quantity)
    await user.type(quantity, '1')
    await user.click(within(dialog).getByRole('button', { name: 'Refund $12.93' }))
    expect(await screen.findByText(/Credit memo CM-100001 created: \$12.93 refunded\./)).toHaveFocus()
  })

  it('asks before cancelling, and shows the server’s refusal', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': { body: ORDER },
      'PATCH /api/admin/orders/BN-100001': { status: 422, body: { message: 'Invalid', errors: { status: ["A shipped order can't be moved to cancelled. It can go to: delivered."] } } },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel order BN-100001?' })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel order' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("A shipped order can't be moved to cancelled.")
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/orders/BN-100001')).toEqual({ status: 'cancelled', notifyCustomer: true })
  })
})

describe('sales documents and coupons', () => {
  it('groups Sales and Marketing in the navigation', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/invoices': { body: { invoices: [], total: 0, live: true } } })
    renderApp('/invoices')
    const sales = await screen.findByRole('list', { name: 'Sales' })
    expect(within(sales).getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page')
    expect(within(sales).getByRole('link', { name: 'Credit memos' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Marketing' })).getByRole('link', { name: 'Coupons' })).toBeInTheDocument()
    expect(await screen.findByText(/No invoices yet/)).toBeInTheDocument()
  })

  it('lists invoices with a search, and shows one', async () => {
    withSession()
    const invoice = { number: 'INV-100001', orderNumber: 'BN-100001', amount: 22.87, createdAt: '2026-11-10T10:00:00Z', adminName: 'Emily' }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/invoices': { body: { invoices: [invoice], total: 1, live: true } },
      'GET /api/admin/invoices/INV-100001': { body: { ...invoice, billingAddress: ADDRESS, items: [{ title: 'Mascara', sku: 'BEA-1', salePrice: 8.94, quantity: 2, lineTotal: 17.88 }], totals: ORDER.totals, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/invoices')
    const row = (await screen.findByRole('link', { name: 'INV-100001' })).closest('tr')
    expect(within(row).getByRole('link', { name: 'BN-100001' })).toHaveAttribute('href', '/orders/BN-100001')
    expect(within(row).getByText('$22.87')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search invoices'), 'BN-100001')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(new URL(fetchMock.mock.calls.at(-1)[0]).searchParams.get('q')).toBe('BN-100001')

    await user.click(screen.getByRole('link', { name: 'INV-100001' }))
    expect(await screen.findByRole('heading', { name: 'Invoice INV-100001' })).toBeInTheDocument()
    expect(screen.getByText('Mascara', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('12 Market Street', { exact: false })).toBeInTheDocument()
  })

  it('lists credit memos with their restock state in words, and shows one', async () => {
    withSession()
    const memo = { number: 'CM-100001', orderNumber: 'BN-100001', items: [{ name: 'Mascara', sku: 'BEA-1', quantity: 1, amount: 8.94 }], subtotal: 8.94, shippingRefund: 0, adjustment: -1, total: 7.94, restocked: true, createdAt: '2026-11-12T10:00:00Z', adminName: 'Emily' }
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/credit-memos': { body: { creditMemos: [memo], total: 1, live: true } },
      'GET /api/admin/credit-memos/CM-100001': { body: { ...memo, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/credit-memos')
    const row = (await screen.findByRole('link', { name: 'CM-100001' })).closest('tr')
    expect(within(row).getByText('Returned to stock')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'CM-100001' }))
    expect(await screen.findByRole('heading', { name: 'Credit memo CM-100001' })).toBeInTheDocument()
    expect(screen.getByText('−$1.00 (fee kept)')).toBeInTheDocument()
  })

  const COUPON = { id: 3, code: 'WINTER5', description: '$5 off', type: 'fixed', value: 5, minSubtotal: 25, startsAt: null, endsAt: null, usageLimit: 100, usageLimitPerCustomer: 1, timesUsed: 4, isActive: true, status: 'active' }

  it('lists coupons with status badges and a filter; deleting a used one disables it, after confirming', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/coupons': { body: { coupons: [COUPON, { ...COUPON, id: 4, code: 'OLD', isActive: true, status: 'expired' }], total: 2, live: true } },
      'DELETE /api/admin/coupons/3': { body: { id: 3, disabled: true, coupon: { ...COUPON, isActive: false, status: 'inactive' }, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/coupons')
    const row = (await screen.findByRole('link', { name: 'WINTER5' })).closest('tr')
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(row).getByText('$5.00 off')).toBeInTheDocument()
    expect(within(row).getByText('4 of 100')).toBeInTheDocument()
    expect(within(row).getByText(/Spend \$25\.00\+ · 1 per customer/)).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'OLD' }).closest('tr')).getByText('Expired')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Status'), 'expired')
    expect(new URL(fetchMock.mock.calls.at(-1)[0]).searchParams.get('status')).toBe('expired')

    await user.click(screen.getByRole('button', { name: 'Delete WINTER5' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete WINTER5?' })
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('WINTER5 has been used, so it was disabled instead of deleted. Past orders keep it.')).toHaveFocus()
  })

  it('creates a coupon: checks the fields first, then sends numbers, UTC dates, and no-limit as null', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'POST /api/admin/coupons': (url, init) => {
        const body = JSON.parse(init.body)
        return body.code === 'TAKEN'
          ? { status: 422, body: { message: 'Invalid', errors: { code: ['This code is already in use.'] } } }
          : { status: 201, body: { coupon: { ...COUPON, id: 9, code: body.code, timesUsed: 0 }, live: true } }
      },
      'GET /api/admin/coupons/9': { body: { ...COUPON, id: 9, code: 'SPRING15', timesUsed: 0, live: true } },
    })
    const user = userEvent.setup()
    renderApp('/coupons/new')
    await user.type(await screen.findByLabelText('Code'), 'x')
    await user.selectOptions(screen.getByLabelText('Type'), 'percent')
    await user.type(screen.getByLabelText('Percent off'), '150')
    await user.type(screen.getByLabelText('Description (optional)'), '15% off spring')
    await user.click(screen.getByRole('button', { name: 'Add coupon' }))
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Code')).toHaveAccessibleDescription(/Use 3 to 40 letters/)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    await user.clear(screen.getByLabelText('Code'))
    await user.type(screen.getByLabelText('Code'), 'taken')
    await user.click(screen.getByRole('button', { name: 'Add coupon' }))
    expect(await screen.findByText('Enter a whole percentage from 1 to 100.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Percent off'))
    await user.type(screen.getByLabelText('Percent off'), '15')
    await user.click(screen.getByRole('button', { name: 'Add coupon' }))
    expect(await screen.findByText('This code is already in use.')).toBeInTheDocument()
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true')

    await user.clear(screen.getByLabelText('Code'))
    await user.type(screen.getByLabelText('Code'), 'spring15')
    await user.type(screen.getByLabelText('Ends (optional)'), '2026-12-31T23:59')
    await user.type(screen.getByLabelText('Uses per customer (optional)'), '1')
    await user.click(screen.getByRole('button', { name: 'Add coupon' }))
    expect(await screen.findByText('Coupon created.')).toBeInTheDocument()
    const sent = sentTo(fetchMock, 'POST', '/api/admin/coupons')
    const last = JSON.parse(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)[1].body)
    expect(sent.code).toBe('TAKEN')
    expect(last).toEqual({
      code: 'SPRING15', description: '15% off spring', type: 'percent', value: 15, minSubtotal: null, startsAt: null, endsAt: new Date('2026-12-31T23:59').toISOString(), usageLimit: null, usageLimitPerCustomer: 1, isActive: true,
      // Phase 7: the cart price rule fields, at their defaults (a code for the whole cart, everyone).
      autoApply: false, buyQuantity: null, getQuantity: null, freeShipping: false, appliesTo: 'all', categoryIds: [], productIds: [], customerGroupIds: [],
    })
  })
})
