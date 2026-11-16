import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

// BuyNest's backend: the phase 7 screens, the bell, and the grid settings exist.
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const VIEW_KEYS = ['dashboard.view', 'products.view', 'products.edit', 'products.delete', 'orders.view', 'customers.view', 'reports.view', 'returns.view', 'reviews.view', 'content.view', 'content.edit', 'categories.edit']
const OWNER = { ...ADMIN, name: 'Store Owner', role: { id: 1, name: 'Owner' }, permissions: [...VIEW_KEYS, 'email_templates.manage', 'seo.manage'] }
const SALES = { ...ADMIN, name: 'Sam Sales', role: { id: 4, name: 'Sales' }, permissions: ['dashboard.view', 'orders.view'] }

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && (typeof call[1].body === 'string' ? JSON.parse(call[1].body) : call[1].body)
}
const callsTo = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)

const NO_NOTES = { body: { notifications: [], unreadCount: 0, total: 0, live: true } }
const NO_PREFS = (key) => ({ body: { key, columns: null, pageSize: null, sort: null, direction: null, filters: [], live: true } })

function start(me, route, routes) {
  withSession()
  const fetchMock = mockFetch({ 'GET /api/admin/me': { body: me }, 'GET /api/admin/notifications': NO_NOTES, ...routes })
  renderApp(route)
  return fetchMock
}

describe('navigation and permissions', () => {
  it('shows Email templates and URL redirects only to roles with their permissions', async () => {
    start(OWNER, '/redirects', { 'GET /api/admin/redirects': { body: { redirects: [], total: 0 } } })
    expect(await screen.findByRole('heading', { name: 'URL redirects' })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Admin' }))
    expect(nav.getByRole('link', { name: 'Email templates' })).toHaveAttribute('href', '/email-templates')
    expect(nav.getByRole('link', { name: 'URL redirects' })).toHaveAttribute('href', '/redirects')
  })

  it('names the missing permission for a role without it', async () => {
    start(SALES, '/email-templates', {})
    expect(await screen.findByText('(email_templates.manage)')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Admin' })).queryByRole('link', { name: 'Email templates' })).not.toBeInTheDocument()
  })
})

const TEMPLATE = {
  key: 'email_verification',
  name: 'Email verification code',
  description: 'Sent when a customer signs up.',
  subject: 'Your BuyNest code',
  body: '<p>Hello</p><p>{{ code }}</p>',
  isCustomized: true,
  updatedAt: '2026-11-16T10:00:00Z',
  updatedBy: 'Store Owner',
  variables: [
    { name: 'customer_first_name', description: 'First name', kind: 'text', required: false },
    { name: 'code', description: 'The 6-digit code', kind: 'text', required: true },
    { name: 'button', description: 'A button', kind: 'block', required: false },
  ],
  requiredGroups: [['code']],
  live: true,
}

describe('email templates', () => {
  it('lists the templates with their status', async () => {
    start(OWNER, '/email-templates', {
      'GET /api/admin/email-templates': { body: { templates: [TEMPLATE, { ...TEMPLATE, key: 'invoice', name: 'Invoice', isCustomized: false, updatedAt: null }] } },
    })
    expect(await screen.findByRole('link', { name: 'Email verification code' })).toHaveAttribute('href', '/email-templates/email_verification')
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Customized')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Default')).toBeInTheDocument()
  })

  it('previews the draft, checks variables, inserts one, saves, test-sends, and resets', async () => {
    const fetchMock = start(OWNER, '/email-templates/email_verification', {
      'GET /api/admin/email-templates/email_verification': { body: TEMPLATE },
      'POST /api/admin/email-templates/email_verification/preview': (url, init) => ({ body: { subject: JSON.parse(init.body).subject, html: '<p>Hello Nadia</p>', text: 'Hello Nadia' } }),
      'PUT /api/admin/email-templates/email_verification': (url, init) => ({ body: { template: { ...TEMPLATE, ...JSON.parse(init.body), updatedAt: '2026-11-17T10:00:00Z' } } }),
      'POST /api/admin/email-templates/email_verification/test': { body: { sent: true, to: 'admin@buynest.test', message: 'Test email sent to admin@buynest.test.' } },
      'POST /api/admin/email-templates/email_verification/reset': { body: { template: { ...TEMPLATE, isCustomized: false, updatedAt: null } } },
    })
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Email verification code', level: 1 })).toBeInTheDocument()
    // The preview: a sandboxed frame (no scripts) with the server's rendering of the draft.
    const frame = await screen.findByTitle('Preview of Email verification code')
    expect(frame).toHaveAttribute('sandbox', '')
    expect(frame).toHaveAttribute('srcdoc', '<p>Hello Nadia</p>')

    const subject = screen.getByLabelText('Subject')
    await user.clear(subject)
    await user.type(subject, 'Welcome')
    await waitFor(() => expect(sentTo(fetchMock, 'POST', '/api/admin/email-templates/email_verification/preview')).toEqual({ subject: 'Welcome', body: TEMPLATE.body }), { timeout: 2000 })
    expect(await screen.findByText('Welcome')).toBeInTheDocument()

    // A required variable removed, then an unknown one: refused before saving.
    const body = screen.getByLabelText('Body (HTML)')
    fireEvent.change(body, { target: { value: '<p>Hello</p>' } })
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(screen.getByText('This email must include {{ code }}.')).toBeInTheDocument()
    expect(body).toHaveAccessibleDescription(/This email must include/)
    fireEvent.change(body, { target: { value: '<p>{{ code }} {{ coupon }}</p>' } })
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(screen.getByText(/Unknown variables: \{\{ coupon \}\}/)).toBeInTheDocument()
    expect(callsTo(fetchMock, 'PUT', '/api/admin/email-templates/email_verification')).toHaveLength(0)

    // Insert at the cursor (the end), then save.
    fireEvent.change(body, { target: { value: '<p>Hi </p>' } })
    body.setSelectionRange(6, 6)
    await user.click(screen.getByRole('button', { name: 'Insert code (required)' }))
    expect(body).toHaveValue('<p>Hi {{ code }}</p>')
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Template saved. New emails use it now.')).toHaveFocus()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/email-templates/email_verification')).toEqual({ subject: 'Welcome', body: '<p>Hi {{ code }}</p>' })

    await user.click(screen.getByRole('button', { name: 'Send test to me' }))
    expect(await screen.findByText('Test email sent to admin@buynest.test.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reset to default' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset "Email verification code"?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reset to default' }))
    expect(await screen.findByText('Back to the default template.')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
  })

  it('shows a block variable in the subject as a problem', async () => {
    start(OWNER, '/email-templates/email_verification', {
      'GET /api/admin/email-templates/email_verification': { body: TEMPLATE },
      'POST /api/admin/email-templates/email_verification/preview': { body: { subject: 'x', html: '<p>x</p>', text: 'x' } },
    })
    const user = userEvent.setup()
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Hi {{ button }}' } })
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(screen.getByText('{{ button }} can only be used in the body.')).toBeInTheDocument()
  })
})

const REDIRECT = { id: 4, fromPath: '/old-sale', toPath: '/deals', statusCode: 301, hits: 12, createdAt: '2026-11-17T10:00:00Z', updatedAt: '2026-11-17T10:00:00Z' }

describe('URL redirects', () => {
  it('adds (checked first), edits, and deletes redirects', async () => {
    const fetchMock = start(OWNER, '/redirects', {
      'GET /api/admin/redirects': { body: { redirects: [REDIRECT], total: 1 } },
      'POST /api/admin/redirects': (url, init) => ({ status: 201, body: { redirect: { ...REDIRECT, id: 5, ...JSON.parse(init.body) } } }),
      'PATCH /api/admin/redirects/4': (url, init) => ({ body: { redirect: { ...REDIRECT, ...JSON.parse(init.body) } } }),
      'DELETE /api/admin/redirects/4': { body: { deleted: true } },
    })
    const user = userEvent.setup()
    expect(await screen.findByText('/old-sale')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '12' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add redirect' }))
    let dialog = screen.getByRole('dialog', { name: 'Add redirect' })
    await user.type(within(dialog).getByLabelText('From (old address)'), 'summer')
    await user.type(within(dialog).getByLabelText('To'), 'http://x.example')
    await user.click(within(dialog).getByRole('button', { name: 'Add redirect' }))
    expect(within(dialog).getByLabelText('From (old address)')).toHaveAccessibleDescription(/starting with \//)
    expect(within(dialog).getByText('Enter a store path starting with / or an https:// address.')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('From (old address)'))
    await user.type(within(dialog).getByLabelText('From (old address)'), '/summer')
    await user.clear(within(dialog).getByLabelText('To'))
    await user.type(within(dialog).getByLabelText('To'), '/categories/beauty')
    await user.selectOptions(within(dialog).getByLabelText('Type'), '302')
    await user.click(within(dialog).getByRole('button', { name: 'Add redirect' }))
    // The announced result takes focus (its box, around the text).
    expect((await screen.findByText('Redirect added: /summer goes to /categories/beauty.')).parentElement).toHaveFocus()
    expect(sentTo(fetchMock, 'POST', '/api/admin/redirects')).toEqual({ fromPath: '/summer', toPath: '/categories/beauty', statusCode: 302 })

    await user.click(screen.getByRole('button', { name: 'Edit redirect from /old-sale' }))
    dialog = screen.getByRole('dialog', { name: 'Edit redirect' })
    expect(within(dialog).getByLabelText('To')).toHaveValue('/deals')
    await user.clear(within(dialog).getByLabelText('To'))
    await user.type(within(dialog).getByLabelText('To'), 'https://blog.example/sale')
    await user.click(within(dialog).getByRole('button', { name: 'Save redirect' }))
    expect(await screen.findByText('Redirect saved: /old-sale goes to https://blog.example/sale.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete redirect from /old-sale' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this redirect?' })).getByRole('button', { name: 'Delete redirect' }))
    expect(await screen.findByText('Redirect from /old-sale deleted.')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'DELETE', '/api/admin/redirects/4')).toHaveLength(1)
  })

  it('imports a CSV and lists the skipped rows', async () => {
    const fetchMock = start(OWNER, '/redirects', {
      'GET /api/admin/redirects': { body: { redirects: [], total: 0 } },
      'POST /api/admin/redirects/import': { body: { created: 2, updated: 1, skipped: 1, errors: [{ row: 4, message: 'to_path: Enter a store path.' }] } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Import CSV' }))
    const dialog = screen.getByRole('dialog', { name: 'Import redirects' })
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(within(dialog).getByText('Choose a CSV file.')).toBeInTheDocument()
    await user.upload(within(dialog).getByLabelText('CSV file'), new File(['from_path,to_path\n/a,/b\n'], 'redirects.csv', { type: 'text/csv' }))
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(await screen.findByText('Import finished: 2 added, 1 updated, 1 skipped.')).toBeInTheDocument()
    expect(screen.getByText('Row 4: to_path: Enter a store path.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/redirects/import')).toBeInstanceOf(FormData)
  })

  it('offers a redirect after a product is deleted', async () => {
    const fetchMock = start(OWNER, '/products', {
      'GET /api/admin/products': { body: { products: [{ id: 12, title: 'Mascara', category: 'beauty', price: 9.99, stock: 99, status: 'active' }], total: 1, live: true } },
      'GET /api/admin/categories': { body: [] },
      'GET /api/admin/preferences/products_grid': NO_PREFS('products_grid'),
      'DELETE /api/admin/products/12': { body: { deleted: true, live: true } },
      'POST /api/admin/redirects': (url, init) => ({ status: 201, body: { redirect: { ...REDIRECT, ...JSON.parse(init.body) } } }),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Delete Mascara' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this product?' })).getByRole('button', { name: 'Delete product' }))
    const offer = await screen.findByRole('region', { name: 'Keep old links working?' })
    expect(within(offer).getByText('/products/12')).toBeInTheDocument()
    expect(within(offer).getByLabelText('Send visitors to')).toHaveValue('/categories/beauty')
    await user.click(within(offer).getByRole('button', { name: 'Add redirect' }))
    expect(await screen.findByText('Redirect added: /products/12 now goes to /categories/beauty.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/redirects')).toEqual({ fromPath: '/products/12', toPath: '/categories/beauty', statusCode: 301 })
  })
})

const NOTES = {
  notifications: [
    { id: 7, type: 'out_of_stock', severity: 'critical', title: 'Mascara is out of stock', body: 'No units left.', link: '/products/1', createdAt: '2026-11-17T10:00:00Z', readAt: null },
    { id: 8, type: 'review_pending', severity: 'info', title: 'A review is waiting', body: '', link: '/reviews?status=pending', createdAt: '2026-11-17T09:00:00Z', readAt: null },
  ],
  unreadCount: 2,
  total: 2,
  live: true,
}

describe('notifications bell', () => {
  it('names the unread count, opens a list, marks read, and returns focus on Escape', async () => {
    const fetchMock = start(OWNER, '/redirects', {
      'GET /api/admin/redirects': { body: { redirects: [], total: 0 } },
      'GET /api/admin/notifications': { body: NOTES },
      'POST /api/admin/notifications/7/read': { body: { notification: { ...NOTES.notifications[0], readAt: '2026-11-17T11:00:00Z' } } },
      'POST /api/admin/notifications/read-all': { body: { marked: 1, unreadCount: 0 } },
    })
    const user = userEvent.setup()
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    await user.click(bell)
    const panel = screen.getByRole('dialog', { name: 'Notifications' })
    expect(within(panel).getByRole('heading', { name: 'Notifications' })).toHaveFocus()
    expect(within(panel).getByRole('link', { name: 'Mascara is out of stock' })).toHaveAttribute('href', '/products/1')
    expect(within(panel).getByText('Critical, unread:')).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Mark "Mascara is out of stock" as read' }))
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
    expect(within(panel).getByRole('status')).toHaveTextContent('Marked "Mascara is out of stock" as read.')
    await user.click(within(panel).getByRole('button', { name: 'Mark all as read' }))
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/admin/notifications/read-all')).toHaveLength(1)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications' })).toHaveFocus()
  })

  it('polls the count every 60 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const fetchMock = start(OWNER, '/redirects', { 'GET /api/admin/redirects': { body: { redirects: [], total: 0 } }, 'GET /api/admin/notifications': { body: NOTES } })
      await screen.findByRole('button', { name: 'Notifications, 2 unread' })
      const before = callsTo(fetchMock, 'GET', '/api/admin/notifications').length
      await vi.advanceTimersByTimeAsync(60_000)
      await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/admin/notifications').length).toBe(before + 1))
    } finally {
      vi.useRealTimers()
    }
  })
})

const OVERVIEW = {
  products: null,
  customers: null,
  lowStockProducts: null,
  newCustomers: null,
  orders: { total: 3, revenue: 120, unitsSold: 5, averageOrder: 40, byStatus: { processing: 1 } },
  latestOrders: [],
  revenueChart: Array.from({ length: 30 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}`, orders: index === 29 ? 2 : 0, revenue: index === 29 ? 80.5 : 0 })),
  bestsellers: [{ productId: 1, name: 'Mascara', sku: 'MAS-1', units: 4, revenue: 39.96 }],
  topSearchTerms: [{ term: 'lipstick', hits: 9, results: 0 }],
  todo: { ordersToInvoice: 2, ordersToShip: 1, pendingReviews: 3 },
  lowStockThreshold: 5,
  live: true,
}

describe('dashboard', () => {
  it('shows the blocks the role may see, with the revenue chart as text', async () => {
    start({ ...OWNER, permissions: ['dashboard.view', 'orders.view', 'reports.view'] }, '/', { 'GET /api/admin/overview': { body: OVERVIEW } })
    expect(await screen.findByText('Lifetime sales')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '2 Orders to invoice' })).toHaveAttribute('href', '/orders?paymentStatus=unpaid')
    expect(screen.getByRole('link', { name: '1 Orders to ship' })).toBeInTheDocument()
    // Sent, but the role has no reviews.view: not shown.
    expect(screen.queryByText('Reviews to approve')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Revenue, last 30 days' })).toHaveAccessibleDescription(/\$80\.50 from 2 orders/)
    expect(screen.getByRole('heading', { name: 'Bestsellers' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'lipstick' })).toBeInTheDocument()
    for (const name of ['Needs restocking', 'New customers', 'Products']) expect(screen.queryByRole('heading', { name })).not.toBeInTheDocument()
    expect(screen.queryByText('Inventory value')).not.toBeInTheDocument()
  })
})

describe('grid preferences', () => {
  const ORDERS = { orders: [{ number: 'BN-100001', customer: 'Nadia Rahman', guest: false, placedAt: '2026-11-17T10:00:00Z', source: 'storefront', status: 'processing', paymentStatus: 'paid', total: 50 }], total: 1, live: true }

  it('hides a column, saves rows per page, and saves and applies named filters', async () => {
    let saved = { key: 'orders_grid', columns: null, pageSize: null, filters: [{ name: 'To ship', query: { status: 'processing' } }], live: true }
    const fetchMock = start(OWNER, '/orders?paymentStatus=paid', {
      'GET /api/admin/orders': { body: ORDERS },
      'GET /api/admin/preferences/orders_grid': () => ({ body: saved }),
      'PUT /api/admin/preferences/orders_grid': (url, init) => {
        saved = { key: 'orders_grid', ...JSON.parse(init.body), live: true }
        return { body: saved }
      },
    })
    const user = userEvent.setup()
    expect(await screen.findByRole('columnheader', { name: 'Source' })).toBeInTheDocument()

    await user.click(screen.getByText('Columns'))
    const chooser = screen.getByRole('group', { name: 'Columns to show' })
    expect(within(chooser).getByRole('checkbox', { name: /Order/ })).toBeDisabled()
    await user.click(within(chooser).getByRole('checkbox', { name: 'Source' }))
    expect(screen.queryByRole('columnheader', { name: 'Source' })).not.toBeInTheDocument()
    expect(await screen.findByText('Source column hidden.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/preferences/orders_grid')).toMatchObject({ columns: ['order', 'customer', 'placed', 'status', 'payment', 'total'] })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Columns to show' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Rows per page'), '50')
    expect(await screen.findByText('Showing 50 orders per page.')).toBeInTheDocument()
    await waitFor(() => expect(new URL(fetchMock.mock.calls.findLast(([url]) => new URL(url).pathname === '/api/admin/orders')[0]).searchParams.get('limit')).toBe('50'))

    // The current filters (payment: paid) under a name.
    await user.click(screen.getByRole('button', { name: 'Save filters' }))
    const dialog = screen.getByRole('dialog', { name: 'Save these filters' })
    await user.type(within(dialog).getByLabelText('Name'), 'to ship')
    await user.click(within(dialog).getByRole('button', { name: 'Save filters' }))
    expect(within(dialog).getByText('You already have saved filters with that name.')).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Paid')
    await user.click(within(dialog).getByRole('button', { name: 'Save filters' }))
    expect(await screen.findByText('Filters saved as "Paid".')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/preferences/orders_grid').filters).toEqual([
      { name: 'To ship', query: { status: 'processing' } },
      { name: 'Paid', query: { q: '', status: '', paymentStatus: 'paid', source: '' } },
    ])

    await user.selectOptions(screen.getByLabelText('Saved filters'), 'To ship')
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('processing'))
    expect(screen.getByLabelText('Payment')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Delete saved filters To ship' })).toBeInTheDocument()
  })

  it('keeps the default grid when the preferences fail to load', async () => {
    start(OWNER, '/orders', { 'GET /api/admin/orders': { body: ORDERS }, 'GET /api/admin/preferences/orders_grid': { status: 500, body: {} } })
    expect(await screen.findByRole('columnheader', { name: 'Total' })).toBeInTheDocument()
    expect(screen.getByLabelText('Rows per page')).toHaveValue('20')
  })
})

describe('product SEO fields', () => {
  it('edits the meta title and description with the product', async () => {
    const PRODUCT = { id: 1, title: 'Mascara', brand: '', category: 'beauty', price: 9.99, discountPercentage: 0, stock: 99, status: 'active', description: 'Lashes.', metaTitle: '', metaDescription: '', live: true, imageList: [], options: [], variants: [] }
    const fetchMock = start(OWNER, '/products/1', {
      'GET /api/admin/products/1': { body: PRODUCT },
      'GET /api/admin/categories': { body: [{ id: 1, name: 'Beauty', slug: 'beauty', parentId: null, depth: 0 }] },
      'PUT /api/admin/products/1': (url, init) => ({ body: { product: { ...PRODUCT, ...JSON.parse(init.body) }, live: true } }),
    })
    const user = userEvent.setup()
    const group = await screen.findByRole('group', { name: 'Search engines' })
    await user.type(within(group).getByLabelText('Meta title (optional)'), 'Best mascara | BuyNest')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/Changes saved/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/products/1')).toMatchObject({ metaTitle: 'Best mascara | BuyNest', metaDescription: '' })
  })
})
