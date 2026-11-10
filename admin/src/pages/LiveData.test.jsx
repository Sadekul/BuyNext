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

  it('offers only the allowed next steps, with a note and the email choice', async () => {
    withSession()
    let current = ORDER
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': () => ({ body: current }),
      'PATCH /api/admin/orders/BN-100001': (url, init) => {
        const changes = JSON.parse(init.body)
        current = { ...current, status: changes.status, history: [...current.history, { status: changes.status, note: changes.note, adminName: 'Emily', customerNotified: changes.notifyCustomer, createdAt: '2026-11-11T10:00:00Z' }] }
        return { body: current }
      },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')

    expect(await screen.findByRole('button', { name: 'Mark as shipped' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as delivered' })).not.toBeInTheDocument() // not allowed from processing
    expect(screen.getByRole('button', { name: 'Mark as paid' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Note (optional)'), 'Tracking 1Z999')
    await user.click(screen.getByLabelText('Email the customer'))
    await user.click(screen.getByRole('button', { name: 'Mark as shipped' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Status changed to Shipped.')
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/orders/BN-100001')).toEqual({ status: 'shipped', note: 'Tracking 1Z999', notifyCustomer: false })
    const history = screen.getByRole('list', { name: 'History' })
    expect(within(history).getByText('Tracking 1Z999')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark as delivered' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument() // shipped orders can't be cancelled
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
    expect(await screen.findByRole('alert')).toHaveTextContent("A shipped order can't be moved to cancelled.")
  })
})
