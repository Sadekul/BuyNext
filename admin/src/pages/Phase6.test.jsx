import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

// BuyNest's backend (VITE_API_PROVIDER=laravel with Laravel accounts): the phase 6 screens exist.
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const SALES_KEYS = ['orders.view', 'orders.edit', 'orders.create', 'invoices.create', 'shipments.create', 'credit_memos.create', 'returns.view', 'returns.manage']
const CUSTOMER_KEYS = ['customers.view', 'customers.edit', 'customers.create', 'customers.delete', 'customer_groups.manage']
const OWNER = { ...ADMIN, name: 'Store Owner', role: { id: 1, name: 'Owner' }, permissions: [...SALES_KEYS, ...CUSTOMER_KEYS, 'products.view', 'settings.view', 'settings.edit'] }
const VIEWER = { ...ADMIN, name: 'Vic Viewer', role: { id: 5, name: 'Viewer' }, permissions: ['orders.view', 'customers.view', 'returns.view'] }

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const lastQuery = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === 'GET' && new URL(url).pathname === path)
  return call && new URL(call[0]).searchParams
}

const GROUPS = [
  { id: 1, name: 'General', code: 'general', discountPercent: 0, isSystem: true, customerCount: 35 },
  { id: 2, name: 'Wholesale', code: 'wholesale', discountPercent: 10, isSystem: false, customerCount: 3 },
]
const ADDRESS = { id: 4, firstName: 'Nadia', lastName: 'Rahman', company: '', phone: '+15550100100', line1: '1 Main St', line2: '', city: 'Austin', state: 'TX', postalCode: '78701', country: 'United States', isDefaultShipping: true, isDefaultBilling: true }
const NADIA = {
  id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+15550100100', emailVerified: true, isActive: true,
  group: { id: 2, name: 'Wholesale', discountPercent: 10 }, groupId: 2, status: 'active', ordersCount: 12, createdByAdmin: false,
  createdAt: '2026-11-10T08:00:00Z', lastLoginAt: '2026-11-15T08:00:00Z',
  addresses: [ADDRESS], lifetimeSpent: 1234.5, reviewsCount: 2,
  recentOrders: [{ number: 'BN-100009', status: 'delivered', paymentStatus: 'paid', source: 'admin', total: 99.5, items: 2, placedAt: '2026-11-12T08:00:00Z' }],
  notes: [{ id: 1, body: 'Prefers phone orders.', adminName: 'Store Owner', createdAt: '2026-11-14T08:00:00Z' }],
  live: true,
}

function start(me, route, routes) {
  withSession()
  const fetchMock = mockFetch({ 'GET /api/admin/me': { body: me }, 'GET /api/admin/customer-groups': { body: { groups: GROUPS } }, ...routes })
  renderApp(route)
  return fetchMock
}

describe('navigation and permissions', () => {
  it('shows the phase 6 screens the role may open, and hides the actions it may not take', async () => {
    start(VIEWER, '/customers/5', { 'GET /api/admin/customers/5': { body: NADIA } })
    expect(await screen.findByRole('heading', { name: 'Nadia Rahman' })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Admin' }))
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual(['Orders', 'Shipments', 'Returns', 'Invoices', 'Credit memos', 'All customers', 'Customer groups'])
    for (const name of ['Send password reset', 'Block', 'Delete', 'Create order', 'Save account']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeDisabled()
  })

  it('a screen the role lacks names the permission, and so does a 403 from the API', async () => {
    start(VIEWER, '/orders/new', {})
    expect(await screen.findByText('(orders.create)')).toBeInTheDocument()
  })

  it('a 403 permission_denied from the API shows the no-access screen', async () => {
    start(OWNER, '/returns', { 'GET /api/admin/returns': { status: 403, body: { message: 'Forbidden.', code: 'permission_denied', permission: 'returns.view' } } })
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
    expect(screen.getByText('(returns.view)')).toBeInTheDocument()
  })
})

describe('customers', () => {
  const LIST = { customers: [{ ...NADIA, addresses: undefined }], total: 1, manageable: true, live: true }

  it('filters by email, group, and joined dates, and exports the same filters', async () => {
    const fetchMock = start(OWNER, '/customers', { 'GET /api/admin/customers': { body: LIST } })
    const user = userEvent.setup()
    expect(await screen.findByRole('link', { name: 'Nadia Rahman' })).toHaveAttribute('href', '/customers/5')
    expect(screen.getByRole('cell', { name: 'Wholesale' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Email'), 'no')
    await user.selectOptions(await screen.findByLabelText('Group'), '2')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/customers').get('groupId')).toBe('2'))
    expect(lastQuery(fetchMock, '/api/admin/customers').get('verified')).toBe('no')
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/admin/customers/export.csv?verified=no&groupId=2')
  })

  it('adds a customer, then opens their page', async () => {
    const fetchMock = start(OWNER, '/customers', {
      'GET /api/admin/customers': { body: LIST },
      'POST /api/admin/customers': { status: 201, body: { customer: { ...NADIA, id: 9, firstName: 'Omar', lastName: 'Faruk' } } },
      'GET /api/admin/customers/9': { body: { ...NADIA, id: 9, firstName: 'Omar', lastName: 'Faruk', addresses: [], notes: [], recentOrders: [] } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add customer' }))
    const dialog = screen.getByRole('dialog', { name: 'Add customer' })
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))
    expect(within(dialog).getByText('Enter a phone number with its country code.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('First name'), 'Omar')
    await user.type(within(dialog).getByLabelText('Last name'), 'Faruk')
    await user.type(within(dialog).getByLabelText('Email'), 'omar@example.com')
    await user.type(within(dialog).getByLabelText('Phone'), '+1 555 010 0199')
    await user.selectOptions(within(dialog).getByLabelText('Customer group'), '2')
    await user.click(within(dialog).getByRole('button', { name: 'Add customer' }))
    expect(await screen.findByRole('heading', { name: 'Omar Faruk' })).toBeInTheDocument()
    expect(screen.getByText(/They were emailed a link to set their password/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/customers')).toEqual({ firstName: 'Omar', lastName: 'Faruk', email: 'omar@example.com', phone: '+1 555 010 0199', groupId: 2 })
  })

  it('has keyboard tabs, and saves only the changed account fields', async () => {
    const fetchMock = start(OWNER, '/customers/5', {
      'GET /api/admin/customers/5': { body: NADIA },
      'PATCH /api/admin/customers/5': { body: { ...NADIA, email: 'nadia.new@example.com', emailVerified: false } },
    })
    const user = userEvent.setup()
    const account = await screen.findByRole('tab', { name: 'Account' })
    expect(account).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('$1,234.50')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'Nadia.New@example.com')
    expect(screen.getByText(/signs the customer out everywhere/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save account' }))
    expect(await screen.findByText(/must confirm the new address/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/customers/5')).toEqual({ email: 'nadia.new@example.com' })

    account.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Addresses' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Addresses' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Default shipping')).toBeInTheDocument()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveFocus()
    expect(screen.getByText('Prefers phone orders.')).toBeInTheDocument()
  })

  it('adds an address and a note', async () => {
    const fetchMock = start(OWNER, '/customers/5', {
      'GET /api/admin/customers/5': { body: { ...NADIA, addresses: [] } },
      'POST /api/admin/customers/5/addresses': { status: 201, body: { address: ADDRESS } },
      'POST /api/admin/customers/5/notes': { status: 201, body: { note: { id: 2, body: 'Called about delivery.' } } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: 'Addresses' }))
    await user.click(screen.getByRole('button', { name: 'Add address' }))
    const dialog = screen.getByRole('dialog', { name: 'Add address' })
    expect(within(dialog).getByLabelText('First name')).toHaveValue('Nadia')
    await user.type(within(dialog).getByLabelText('Address'), '9 Elm St')
    await user.type(within(dialog).getByLabelText('City'), 'Dhaka')
    await user.type(within(dialog).getByLabelText('Postal code'), '1207')
    await user.type(within(dialog).getByLabelText('Country'), 'Bangladesh')
    await user.click(within(dialog).getByRole('button', { name: 'Add address' }))
    expect(await screen.findByText('Address added.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/customers/5/addresses')).toMatchObject({ line1: '9 Elm St', city: 'Dhaka', postalCode: '1207', country: 'Bangladesh', phone: '+15550100100', line2: null, isDefaultShipping: true, isDefaultBilling: true })

    await user.click(screen.getByRole('tab', { name: 'Notes' }))
    await user.type(screen.getByLabelText('New note'), 'Called about delivery.')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByText('Note added.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/customers/5/notes')).toEqual({ body: 'Called about delivery.' })
  })

  it("shows the server's reason when a customer can't be deleted, and goes back to the list once deleted", async () => {
    let refuse = true
    start(OWNER, '/customers/5', {
      'GET /api/admin/customers/5': { body: NADIA },
      'GET /api/admin/customers': { body: LIST },
      'DELETE /api/admin/customers/5': () =>
        refuse
          ? { status: 422, body: { message: 'This customer has 1 open order.', errors: { customer: ['This customer has 1 open order. Complete or cancel it first.'] } } }
          : { body: { deleted: true } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Nadia Rahman?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete customer' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This customer has 1 open order. Complete or cancel it first.')
    refuse = false
    await user.click(within(dialog).getByRole('button', { name: 'Delete customer' }))
    expect(await screen.findByText(/account was deleted. Their orders and reviews are kept/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
  })

  it('sends a password reset and says when it is too soon', async () => {
    let first = true
    start(OWNER, '/customers/5', {
      'GET /api/admin/customers/5': { body: NADIA },
      'POST /api/admin/customers/5/password-reset': () => {
        const answer = first ? { body: { sent: true } } : { status: 429, body: { message: 'A code was sent less than a minute ago.', code: 'too_soon' } }
        first = false
        return answer
      },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Send password reset' }))
    expect(await screen.findByText('A password reset email is on its way to nadia@example.com.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send password reset' }))
    expect(await screen.findByText('A code was sent less than a minute ago.')).toBeInTheDocument()
  })
})

describe('customer groups', () => {
  it('adds a group with a code made from the name, and explains why one in use stays', async () => {
    const fetchMock = start(OWNER, '/customer-groups', {
      'POST /api/admin/customer-groups': { status: 201, body: { group: { id: 7, name: 'Trade Buyers' } } },
      'DELETE /api/admin/customer-groups/2': { status: 422, body: { message: 'In use.', errors: { group: ['3 customers are in the Wholesale group. Move them all to another group first.'] } } },
    })
    const user = userEvent.setup()
    expect(await screen.findByText('default for new sign-ups', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete General' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add group' }))
    const dialog = screen.getByRole('dialog', { name: 'Add customer group' })
    await user.type(within(dialog).getByLabelText('Name'), 'Trade Buyers')
    expect(within(dialog).getByLabelText('Code')).toHaveValue('trade_buyers')
    await user.clear(within(dialog).getByLabelText('Discount (%)'))
    await user.type(within(dialog).getByLabelText('Discount (%)'), '12.5')
    await user.click(within(dialog).getByRole('button', { name: 'Add group' }))
    expect(await screen.findByText('Trade Buyers added.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/customer-groups')).toEqual({ name: 'Trade Buyers', code: 'trade_buyers', discountPercent: 12.5 })

    await user.click(screen.getByRole('button', { name: 'Delete Wholesale' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete Wholesale?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete group' }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('3 customers are in the Wholesale group')
  })
})

const QUOTE = {
  lines: [{ productId: 81, variantId: null, title: 'Lenovo Yoga 920', price: 1099.99, salePrice: 925.15, quantity: 1, lineTotal: 925.15 }],
  problems: [],
  coupon: null,
  couponError: null,
  shippingOptions: [
    { id: 'standard', label: 'Standard', eta: '3–5 business days', price: 0 },
    { id: 'express', label: 'Express', eta: '1–2 business days', price: 12.99 },
  ],
  totals: { itemCount: 1, subtotal: 925.15, discount: 0, shipping: 0, tax: 0, total: 925.15, groupDiscount: 102.79 },
  taxEstimated: true,
  paymentMethods: ['card', 'cod', 'bank_transfer', 'cash'],
  customerGroup: 'Wholesale',
  groupDiscountPercent: 10,
  live: true,
}

describe('create order', () => {
  it('finds the customer and a product, fills the saved address, shows live totals, and places the order', async () => {
    const fetchMock = start(OWNER, '/orders/new', {
      'GET /api/admin/settings': { body: { checkout: { allowedCountries: ['United States', 'Bangladesh'], enabledPaymentMethods: ['card', 'cod'] } } },
      'GET /api/admin/customers': { body: { customers: [NADIA], total: 1, manageable: true } },
      'GET /api/admin/customers/5': { body: NADIA },
      'GET /api/admin/products': { body: { products: [{ id: 81, title: 'Lenovo Yoga 920', price: 1099.99, stock: 40, thumbnail: null, hasVariants: false, minimumOrderQuantity: 1 }], total: 1 } },
      'POST /api/admin/orders/quote': { body: QUOTE },
      'POST /api/admin/orders': { status: 201, body: { order: { number: 'BN-100200', status: 'processing' } } },
      'GET /api/admin/orders/BN-100200': { body: { ...ORDER, id: 'BN-100200', number: 'BN-100200', source: 'admin' } },
    })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Find a customer'), 'nadia')
    await user.click(screen.getAllByRole('button', { name: 'Search' })[0])
    // Role queries over the whole form are slow in jsdom: look inside the results list.
    await user.click(within(await screen.findByRole('list', { name: 'Matching customers' })).getByRole('button', { name: 'Choose Nadia Rahman' }))
    expect(await screen.findByText(/Wholesale: 10% off every product/)).toBeInTheDocument()
    // The default shipping address is filled in.
    await waitFor(() => expect(screen.getAllByLabelText('City')[0]).toHaveValue('Austin'))

    await user.type(screen.getByLabelText('Find a product'), 'lenovo')
    await user.click(screen.getAllByRole('button', { name: 'Search' })[0])
    await user.click(within(await screen.findByRole('list', { name: 'Matching products' })).getByRole('button', { name: 'Add Lenovo Yoga 920' }))
    expect(await screen.findByText(/Wholesale price: 10% off every product/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getAllByText('$925.15').length).toBeGreaterThan(0)

    // Bank transfer and cash are offered to staff only.
    expect(screen.getByRole('option', { name: 'Cash (staff only)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByText('Choose a payment method.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Payment method'), 'cash')
    await user.click(screen.getByRole('radio', { name: /Express/ }))
    await user.type(screen.getByLabelText('Order note (optional)'), 'Phone order')
    await user.click(screen.getByLabelText('Email the customer an order confirmation'))
    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(await screen.findByRole('heading', { name: 'Order BN-100200' })).toBeInTheDocument()
    expect(screen.getByText('Order BN-100200 placed.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders')).toEqual({
      customerId: 5,
      items: [{ productId: 81, quantity: 1 }],
      shippingAddress: { firstName: 'Nadia', lastName: 'Rahman', line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postalCode: '78701', country: 'United States' },
      sameAsShipping: true,
      shippingMethod: 'express',
      paymentMethod: 'cash',
      note: 'Phone order',
      notifyCustomer: false,
    })
  })

  it("shows the server's line problems when the order is refused", async () => {
    start(OWNER, '/orders/new?customer=5', {
      'GET /api/admin/settings': { body: { checkout: { allowedCountries: ['United States'] } } },
      'GET /api/admin/customers/5': { body: NADIA },
      'GET /api/admin/products': { body: { products: [{ id: 81, title: 'Lenovo Yoga 920', price: 1099.99, stock: 40, hasVariants: false, minimumOrderQuantity: 1 }], total: 1 } },
      'POST /api/admin/orders/quote': { body: QUOTE },
      'POST /api/admin/orders': {
        status: 422,
        body: { message: "Some items in your cart can't be ordered.", errors: { items: ['Only 1 left.'] }, problems: [{ productId: 81, code: 'out_of_stock', message: 'Only 1 Lenovo Yoga 920 left.' }] },
      },
    })
    const user = userEvent.setup()
    expect(await screen.findByText('Nadia Rahman', { selector: 'strong' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Find a product'), 'lenovo')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await user.click(within(await screen.findByRole('list', { name: 'Matching products' })).getByRole('button', { name: 'Add Lenovo Yoga 920' }))
    await user.selectOptions(screen.getByLabelText('Payment method'), 'bank_transfer')
    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByText('Only 1 Lenovo Yoga 920 left.')).toBeInTheDocument()
  })
})

const ROW = (number, extra = {}) => ({ id: number, number, customer: 'Ava', email: 'ava@example.com', guest: false, items: 1, total: 10, status: 'processing', paymentStatus: 'unpaid', placedAt: '2026-11-10T09:41:02Z', source: 'storefront', ...extra })
const ORDER = {
  id: 'BN-100001', number: 'BN-100001', status: 'delivered', paymentStatus: 'paid', paymentMethod: 'card', source: 'admin', createdByAdmin: 'Store Owner', customerGroup: 'Wholesale',
  shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' }, email: 'ava@example.com', phone: '+15550100100',
  shippingAddress: { firstName: 'Ava', lastName: 'Customer', line1: '1 Main St', line2: '', city: 'Austin', state: 'TX', postalCode: '78701', country: 'United States' },
  billingAddress: null, couponCode: null,
  customer: { id: 5, guest: false, firstName: 'Ava', lastName: 'Customer', email: 'ava@example.com' },
  lines: [{ id: 1, orderItemId: null, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 8.94, quantity: 2, discountedTotal: 17.88 }],
  totals: { itemCount: 2, subtotal: 17.88, discount: 0, shipping: 4.99, tax: 0, total: 22.87, paid: 22.87, refunded: 0 }, items: 2, placedAt: '2026-11-10T09:41:02Z',
  invoices: [{ number: 'INV-100001', amount: 22.87, createdAt: '2026-11-10T10:00:00Z' }],
  shipments: [{ number: 'SHP-100001', carrierLabel: 'UPS', createdAt: '2026-11-11T10:00:00Z' }],
  creditMemos: [],
  returns: [],
  returnEligibility: {
    eligible: false, code: 'window_closed', message: 'The 30-day return window closed on Dec 11, 2026.', deadline: '2026-12-11T00:00:00Z', windowDays: 30,
    reasons: ['Damaged', 'Other'],
    items: [{ orderItemId: 31, name: 'Mascara', variantLabel: null, sku: 'BEA-1', ordered: 2, returnable: 2 }],
  },
  history: [{ status: 'delivered', paymentStatus: 'paid', note: null, adminName: null, customerNotified: false, createdAt: '2026-11-12T09:41:02Z' }],
  live: true,
}

describe('order grid', () => {
  it('ticks orders for a mass action and shows what was done and skipped', async () => {
    const fetchMock = start(OWNER, '/orders', {
      'GET /api/admin/orders': { body: { orders: [ROW('BN-100002'), ROW('BN-100001', { source: 'admin' })], total: 2, live: true } },
      'POST /api/admin/orders/bulk': { body: { done: ['BN-100002'], skipped: [{ number: 'BN-100001', reason: 'This order has already been invoiced.' }] } },
    })
    const user = userEvent.setup()
    const row = (await screen.findByRole('link', { name: 'BN-100001' })).closest('tr')
    expect(within(row).getByText('Admin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/admin/orders/export.csv')
    await user.click(screen.getByRole('checkbox', { name: 'Select all orders on this page' }))
    expect(screen.getByText('selected').parentElement).toHaveTextContent('2 selected')
    await user.selectOptions(screen.getByLabelText('Action'), 'ship')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByText('Choose a carrier.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Carrier'), 'ups')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByText(/1 order shipped. 1 skipped:/)).toBeInTheDocument()
    expect(screen.getByText(/This order has already been invoiced./)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/bulk')).toEqual({ numbers: ['BN-100002', 'BN-100001'], action: 'ship', carrier: 'ups', notifyCustomer: true })
  })

  it('prints packing slips for the selected orders (no prices)', async () => {
    start(OWNER, '/orders', {
      'GET /api/admin/orders': { body: { orders: [ROW('BN-100002')], total: 1, live: true } },
      'GET /api/admin/orders/BN-100002/packing-slip': {
        body: { orderNumber: 'BN-100002', placedAt: '2026-11-10T09:41:02Z', shippingAddress: ORDER.shippingAddress, shippingMethod: 'Standard', items: [{ name: 'Mascara', sku: 'BEA-1', variantLabel: 'Color: Black', quantity: 2 }], shipments: [] },
      },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'Select order BN-100002' }))
    await user.selectOptions(screen.getByLabelText('Action'), 'print-packing-slips')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(await screen.findByRole('heading', { name: 'Packing slip for BN-100002' })).toBeInTheDocument()
    const slip = await screen.findByRole('article')
    expect(within(slip).getByText('Mascara')).toBeInTheDocument()
    expect(within(slip).queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled()
  })
})

describe('returns', () => {
  it('creates a return from an order, overriding a closed window', async () => {
    const fetchMock = start(OWNER, '/orders/BN-100001', {
      'GET /api/admin/orders/BN-100001': { body: ORDER },
      'POST /api/admin/orders/BN-100001/returns': { status: 201, body: { return: { number: 'RMA-100001' } } },
    })
    const user = userEvent.setup()
    expect(await screen.findByText('Store Owner (admin)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Packing slip' })).toHaveAttribute('href', '/print/packing-slips?orders=BN-100001')
    await user.click(screen.getByRole('button', { name: 'Create return' }))
    const dialog = screen.getByRole('dialog', { name: 'Create a return for order BN-100001' })
    expect(within(dialog).getByText(/The 30-day return window closed/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Quantity of Mascara to return (up to 2)'), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Create return' }))
    expect(within(dialog).getByText('At most 2 can be returned.')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose a reason.')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Quantity of Mascara to return (up to 2)'))
    await user.type(within(dialog).getByLabelText('Quantity of Mascara to return (up to 2)'), '1')
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'Damaged')
    await user.click(within(dialog).getByRole('button', { name: 'Create return' }))
    expect(await screen.findByText(/Return RMA-100001 created for order BN-100001/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/returns')).toEqual({ items: [{ orderItemId: 31, quantity: 1 }], reason: 'Damaged', overrideWindow: true, notifyCustomer: true })
  })

  const RMA = {
    number: 'RMA-100001', orderNumber: 'BN-100001', status: 'requested', reason: 'Damaged', comment: 'Screen cracked', adminNote: null, resolution: null,
    customer: { id: 5, name: 'Ava Customer', email: 'ava@example.com' }, email: 'ava@example.com',
    items: [{ id: 11, orderItemId: 31, name: 'Mascara', sku: 'BEA-1', variantLabel: null, quantity: 1, condition: null }],
    itemCount: 1, restocked: false, creditMemoNumber: null, allowedTransitions: ['approved', 'rejected'], canRefund: false, createdAt: '2026-11-13T09:00:00Z', live: true,
  }

  it('lists returns with their status', async () => {
    const fetchMock = start(OWNER, '/returns', { 'GET /api/admin/returns': { body: { returns: [RMA], total: 1, counts: {} } } })
    const user = userEvent.setup()
    const row = (await screen.findByRole('link', { name: 'RMA-100001' })).closest('tr')
    expect(within(row).getByText('Requested')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Status'), 'received')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/returns').get('status')).toBe('received'))
  })

  it('rejects only with a reason for the customer', async () => {
    const fetchMock = start(OWNER, '/returns/RMA-100001', {
      'GET /api/admin/returns/RMA-100001': { body: RMA },
      'PATCH /api/admin/returns/RMA-100001': { body: { return: { ...RMA, status: 'rejected' } } },
    })
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refund this return' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    const dialog = screen.getByRole('dialog', { name: 'Reject return RMA-100001?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(within(dialog).getByText(/Say why the return is rejected/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Why is it rejected?'), 'Outside the warranty.')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText(/Return RMA-100001 rejected/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/returns/RMA-100001')).toEqual({ status: 'rejected', adminNote: 'Outside the warranty.', notifyCustomer: true })
  })

  it('marks a return received with each condition and restocking', async () => {
    const fetchMock = start(OWNER, '/returns/RMA-100001', {
      'GET /api/admin/returns/RMA-100001': { body: { ...RMA, status: 'approved', allowedTransitions: ['received'] } },
      'PATCH /api/admin/returns/RMA-100001': { body: { return: { ...RMA, status: 'received' } } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Mark as received' }))
    const dialog = screen.getByRole('dialog', { name: 'Receive return RMA-100001' })
    await user.click(within(dialog).getByRole('button', { name: 'Mark as received' }))
    expect(within(dialog).getByText('Choose the condition.')).toBeInTheDocument()
    await user.selectOptions(within(dialog).getByLabelText('Condition of Mascara'), 'opened')
    await user.click(within(dialog).getByLabelText('Email the customer'))
    await user.click(within(dialog).getByRole('button', { name: 'Mark as received' }))
    expect(await screen.findByText('Return RMA-100001 marked as received. The items are back in stock.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/returns/RMA-100001')).toEqual({ status: 'received', notifyCustomer: false, items: [{ returnItemId: 11, condition: 'opened' }], restock: true })
  })

  it('refunds a received return through the credit memo dialog, pre-filled', async () => {
    const fetchMock = start(OWNER, '/returns/RMA-100001', {
      'GET /api/admin/returns/RMA-100001': { body: { ...RMA, status: 'received', restocked: true, allowedTransitions: ['closed'], canRefund: true } },
      'GET /api/admin/orders/BN-100001/refundable': {
        body: { items: [{ orderItemId: 31, name: 'Mascara', sku: 'BEA-1', ordered: 2, refunded: 0, refundable: 2, unitRefund: 8.94 }, { orderItemId: 32, name: 'Lipstick', sku: 'BEA-2', ordered: 1, refunded: 0, refundable: 1, unitRefund: 5 }], shippingRefundable: 4.99, maxTotal: 27.87 },
      },
      'POST /api/admin/orders/BN-100001/credit-memos': { status: 201, body: { creditMemo: { number: 'CM-100009', total: 8.94, restocked: false, returnNumber: 'RMA-100001' } } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Refund this return' }))
    const dialog = await screen.findByRole('dialog', { name: 'Refund return RMA-100001' })
    expect(await within(dialog).findByLabelText(/Quantity of Mascara to refund/)).toHaveValue(1)
    expect(within(dialog).getByLabelText(/Quantity of Lipstick to refund/)).toHaveValue(null)
    expect(within(dialog).getByText(/won't be added twice/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Refund $8.94' }))
    expect(await screen.findByText(/Return RMA-100001 is now refunded/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/credit-memos')).toEqual({
      items: [{ orderItemId: 31, quantity: 1 }], shippingRefund: 0, adjustment: 0, restock: false, notifyCustomer: true, returnNumber: 'RMA-100001',
    })
  })
})

describe('shipments and settings', () => {
  it('lists shipments with carrier filters and opens one', async () => {
    const SHIPMENT = { number: 'SHP-100021', orderNumber: 'BN-100001', carrier: 'ups', carrierLabel: 'UPS', trackingNumber: '1Z999', trackingUrl: 'https://ups.example/1Z999', createdAt: '2026-11-16T09:00:42Z', itemCount: 2, order: { number: 'BN-100001', customerName: 'Ava Customer', shipTo: 'Austin, United States', status: 'shipped' } }
    const fetchMock = start(OWNER, '/shipments', {
      'GET /api/admin/shipments': { body: { shipments: [SHIPMENT], total: 1 } },
      'GET /api/admin/shipments/SHP-100021': { body: { ...SHIPMENT, items: [{ name: 'Mascara', sku: 'BEA-1', variantLabel: null, quantity: 2 }], live: true } },
    })
    const user = userEvent.setup()
    expect(await screen.findByText('Ava Customer')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Carrier'), 'ups')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/shipments').get('carrier')).toBe('ups'))
    await user.click(screen.getByRole('link', { name: 'SHP-100021' }))
    expect(await screen.findByRole('heading', { name: 'Shipment SHP-100021' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Packing slip' })).toHaveAttribute('href', '/print/packing-slips?orders=BN-100001')
  })

  it('saves the returns settings', async () => {
    const SETTINGS = { general: {}, shipping: {}, tax: { taxRates: [] }, checkout: {}, inventory: {}, catalog: {}, returns: { returnsEnabled: true, returnWindowDays: 30, returnReasons: ['Damaged', 'Other'] } }
    const fetchMock = start(OWNER, '/settings', { 'GET /api/admin/settings': { body: SETTINGS }, 'PATCH /api/admin/settings': { body: SETTINGS } })
    const user = userEvent.setup()
    const days = await screen.findByLabelText('Return window (days)')
    await user.clear(days)
    await user.type(days, '14')
    await user.click(screen.getByRole('button', { name: 'Remove the reason Other' }))
    await user.type(screen.getByLabelText('Add a reason'), 'Too small{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save returns' }))
    expect(await screen.findByText('Returns saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ returns: { returnsEnabled: true, returnWindowDays: 14, returnReasons: ['Damaged', 'Too small'] } })
  })
})
