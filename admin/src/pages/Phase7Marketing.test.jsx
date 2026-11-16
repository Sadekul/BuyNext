import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { sanitizeHtml } from '../utils/sanitizeHtml'

// BuyNest's backend (VITE_API_PROVIDER=laravel with Laravel accounts): the phase 7 screens exist.
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const MARKETING_KEYS = ['coupons.view', 'coupons.edit', 'price_rules.manage', 'newsletter.view', 'newsletter.send', 'reports.view', 'seo.manage']
const OWNER = { ...ADMIN, email: 'owner@buynest.test', name: 'Store Owner', role: { id: 1, name: 'Owner' }, permissions: [...MARKETING_KEYS, 'customers.view', 'products.view'] }
const VIEWER = { ...ADMIN, name: 'Vic Viewer', role: { id: 5, name: 'Viewer' }, permissions: ['coupons.view', 'newsletter.view', 'reports.view'] }

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const lastQuery = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === 'GET' && new URL(url).pathname === path)
  return call && new URL(call[0]).searchParams
}
const nav = () => within(screen.getByRole('navigation', { name: 'Admin' }))

const GROUPS = [
  { id: 1, name: 'General', code: 'general', discountPercent: 0, isSystem: true, customerCount: 35 },
  { id: 2, name: 'VIP', code: 'vip', discountPercent: 5, isSystem: false, customerCount: 3 },
]
const CATEGORIES = [
  { id: 5, name: 'Shoes', slug: 'shoes', parentId: null, depth: 0, isActive: true },
  { id: 6, name: 'Sneakers', slug: 'sneakers', parentId: 5, depth: 1, isActive: true },
]
const RULE = {
  id: 4, name: 'Winter sale', description: '', isActive: true, status: 'active', startsAt: null, endsAt: '2026-12-31T23:59:59Z',
  customerGroupIds: [2], categoryIds: [5], productIds: [], action: 'percent', amount: 15, priority: 1, stopFurther: true,
}
const PREVIEW = {
  products: [
    { id: 12, name: 'Trail runner', sku: 'SHO-1', status: 'active', price: 100, oldPrice: 90, newPrice: 85, hasVariants: true },
    { id: 13, name: 'Flip flop', sku: 'SHO-2', status: 'active', price: 10, oldPrice: 5, newPrice: 8.5, hasVariants: false },
  ],
  total: 61,
  live: true,
}

function start(me, route, routes) {
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: me },
    'GET /api/admin/customer-groups': { body: { groups: GROUPS } },
    'GET /api/admin/categories': { body: CATEGORIES },
    ...routes,
  })
  renderApp(route)
  return fetchMock
}

describe('navigation and permissions', () => {
  it('lists the marketing screens the role may open, and hides what it may not change', async () => {
    start(VIEWER, '/catalog-rules', { 'GET /api/admin/catalog-rules': { body: { rules: [RULE], total: 1, live: true } } })
    expect(await screen.findByRole('link', { name: 'Winter sale' })).toBeInTheDocument()
    expect(within(nav().getByRole('list', { name: 'Marketing' })).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Catalog price rules', 'Coupons', 'Newsletter subscribers', 'Newsletter campaigns', 'Abandoned carts', 'Search terms',
    ])
    expect(screen.queryByRole('link', { name: 'Add rule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Winter sale' })).not.toBeInTheDocument()
  })

  it('a rule form the role can only read is disabled, and adding one names the missing permission', async () => {
    start(VIEWER, '/catalog-rules/new', {})
    expect(await screen.findByText('(price_rules.manage)')).toBeInTheDocument()
  })
})

describe('catalog price rules', () => {
  it('lists rules with what they do, and deletes one after confirming', async () => {
    const fetchMock = start(OWNER, '/catalog-rules', {
      'GET /api/admin/catalog-rules': { body: { rules: [RULE, { ...RULE, id: 5, name: 'Old', status: 'expired', customerGroupIds: [], categoryIds: [] }], total: 2, live: true } },
      'DELETE /api/admin/catalog-rules/4': { body: { id: 4, deleted: true } },
    })
    const user = userEvent.setup()
    const row = (await screen.findByRole('link', { name: 'Winter sale' })).closest('tr')
    expect(within(row).getByText('15% off')).toBeInTheDocument()
    expect(within(row).getByText('1 group · 1 category')).toBeInTheDocument()
    expect(within(row).getByText('Stops later rules')).toBeInTheDocument()
    expect(within(screen.getByRole('link', { name: 'Old' }).closest('tr')).getByText('Everyone')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Status'), 'expired')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/catalog-rules').get('status')).toBe('expired'))

    await user.click(screen.getByRole('button', { name: 'Delete Winter sale' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete “Winter sale”?' })).getByRole('button', { name: 'Delete rule' }))
    expect(await screen.findByText(/“Winter sale” deleted/)).toHaveFocus()
  })

  it('checks the form, sends groups, categories, and products, then shows the affected products', async () => {
    const fetchMock = start(OWNER, '/catalog-rules/new', {
      'GET /api/admin/products': { body: { products: [{ id: 12, title: 'Trail runner', price: 100 }], total: 1, live: true } },
      'POST /api/admin/catalog-rules': { status: 201, body: { rule: { ...RULE, id: 9, name: 'VIP shoes' }, live: true } },
      'GET /api/admin/catalog-rules/9': { body: { ...RULE, id: 9, name: 'VIP shoes', live: true } },
      'GET /api/admin/catalog-rules/9/preview': { body: PREVIEW },
    })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Percent off'), '150')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(screen.getByLabelText('Rule name')).toHaveAccessibleDescription(/Enter a name of up to 120 characters/)
    expect(screen.getByLabelText('Percent off')).toHaveAccessibleDescription(/Enter a percentage from 0.01 to 100/)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    await user.type(screen.getByLabelText('Rule name'), 'VIP shoes')
    await user.clear(screen.getByLabelText('Percent off'))
    await user.type(screen.getByLabelText('Percent off'), '15')
    await user.click(screen.getByLabelText('Stop further rules', { exact: false }))
    await user.click(within(screen.getByRole('group', { name: 'Customer groups' })).getByRole('checkbox', { name: 'VIP' }))
    await user.click(within(screen.getByRole('group', { name: 'Categories' })).getByRole('checkbox', { name: 'Shoes › Sneakers' }))
    const products = screen.getByRole('group', { name: 'Products' })
    await user.type(within(products).getByLabelText('Search products to add'), 'trail{Enter}')
    await user.click(await within(products).findByRole('button', { name: 'Add Trail runner' }))
    expect(within(products).getByRole('button', { name: 'Remove Trail runner' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(await screen.findByText(/Rule created/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/catalog-rules')).toEqual({
      name: 'VIP shoes', description: null, isActive: true, startsAt: null, endsAt: null, action: 'percent', amount: 15, priority: 0, stopFurther: true,
      customerGroupIds: [2], categoryIds: [6], productIds: [12],
    })
    const preview = screen.getByRole('region', { name: 'Affected products' })
    expect(await within(preview).findByText('Showing the first 2 of 61 products.')).toBeInTheDocument()
    const runner = within(preview).getByRole('rowheader', { name: /Trail runner/ }).closest('tr')
    expect(within(runner).getByText('$90.00')).toBeInTheDocument()
    expect(within(runner).getByText('$85.00')).toBeInTheDocument()
    expect(within(within(preview).getByRole('rowheader', { name: /Flip flop/ }).closest('tr')).getByText('own price wins')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Rule name'))
    expect(within(preview).getByText(/unsaved changes/)).toBeInTheDocument()
  })

  it('puts the server’s 422 messages on the fields (a list field’s first item too)', async () => {
    start(OWNER, '/catalog-rules/4', {
      'GET /api/admin/catalog-rules/4': { body: { ...RULE, live: true } },
      'GET /api/admin/catalog-rules/4/preview': { body: { products: [], total: 0 } },
      'PATCH /api/admin/catalog-rules/4': { status: 422, body: { message: 'Invalid.', errors: { 'categoryIds.0': ['The selected category is invalid.'] } } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save rule' }))
    expect(await screen.findByText('The selected category is invalid.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Categories' })).toHaveAccessibleDescription(/The selected category is invalid/)
  })
})

describe('coupons as cart price rules', () => {
  it('creates an automatic buy X get Y rule for chosen categories, without a code', async () => {
    const fetchMock = start(OWNER, '/coupons/new', {
      'POST /api/admin/coupons': { status: 201, body: { coupon: { id: 7, code: null, autoApply: true, description: 'Buy 2 shoes, get 1 free', type: 'buy_x_get_y', status: 'active', timesUsed: 0 }, live: true } },
      'GET /api/admin/coupons/7': { body: { id: 7, code: null, autoApply: true, description: 'Buy 2 shoes, get 1 free', type: 'buy_x_get_y', buyQuantity: 2, getQuantity: 1, appliesTo: 'categories', categoryIds: [5], customerGroupIds: [], productIds: [], status: 'active', timesUsed: 0, isActive: true, live: true } },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: /Automatic, nothing to enter/ }))
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Type'), 'buy_x_get_y')
    expect(screen.queryByLabelText('Percent off')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Applies to'), 'categories')
    await user.click(screen.getByRole('button', { name: 'Add coupon' }))
    expect(screen.getByLabelText('Buy (units)')).toHaveAccessibleDescription(/Enter how many to buy/)
    expect(screen.getByRole('group', { name: 'Eligible categories' })).toHaveAccessibleDescription(/Choose at least one category/)

    await user.type(screen.getByLabelText('Buy (units)'), '2')
    await user.type(screen.getByLabelText('Get free (units)'), '1')
    await user.click(within(screen.getByRole('group', { name: 'Eligible categories' })).getByRole('checkbox', { name: 'Shoes' }))
    await user.type(screen.getByLabelText('Description (optional)'), 'Buy 2 shoes, get 1 free')
    await user.click(screen.getByRole('button', { name: 'Add coupon' }))
    expect(await screen.findByRole('heading', { name: 'Buy 2 shoes, get 1 free' })).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/coupons')).toMatchObject({
      code: null, autoApply: true, type: 'buy_x_get_y', value: 0, buyQuantity: 2, getQuantity: 1, appliesTo: 'categories', categoryIds: [5], productIds: [], customerGroupIds: [], freeShipping: false,
    })
  })

  it('lists automatic rules by name, filtered by kind', async () => {
    const fetchMock = start(OWNER, '/coupons', {
      'GET /api/admin/coupons': { body: { coupons: [{ id: 7, code: null, autoApply: true, description: 'Spend $50, free shipping', type: 'free_shipping', freeShipping: true, value: 0, minSubtotal: 50, timesUsed: 3, isActive: true, status: 'active', appliesTo: 'all', customerGroupIds: [2] }], total: 1, live: true } },
    })
    const user = userEvent.setup()
    const row = (await screen.findByRole('link', { name: 'Spend $50, free shipping' })).closest('tr')
    expect(within(row).getByText('Automatic, no code')).toBeInTheDocument()
    expect(within(row).getByText(/1 customer group/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Kind'), 'automatic')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/coupons').get('kind')).toBe('automatic'))
  })
})

const SUBSCRIBER = { id: 7, email: 'ava@example.com', customerId: 5, customerName: 'Ava Stone', status: 'subscribed', source: 'footer', confirmedAt: null, unsubscribedAt: null, createdAt: '2026-11-17T08:00:00Z' }

describe('newsletter', () => {
  it('filters subscribers, exports the same filters, and unsubscribes after confirming', async () => {
    const fetchMock = start(OWNER, '/newsletter/subscribers', {
      'GET /api/admin/newsletter/subscribers': { body: { subscribers: [SUBSCRIBER], total: 1, counts: { pending: 2, subscribed: 1, unsubscribed: 4 }, live: true } },
      'POST /api/admin/newsletter/subscribers/7/unsubscribe': { body: { subscriber: { ...SUBSCRIBER, status: 'unsubscribed' } } },
    })
    const user = userEvent.setup()
    const row = (await screen.findByRole('rowheader', { name: 'ava@example.com' })).closest('tr')
    expect(within(row).getByRole('link', { name: 'Ava Stone' })).toHaveAttribute('href', '/customers/5')
    expect(within(row).getByText('Store footer')).toBeInTheDocument()
    expect(screen.getByText('Unsubscribed', { selector: 'dt' }).nextSibling).toHaveTextContent('4')
    await user.selectOptions(screen.getByLabelText('Status'), 'subscribed')
    await user.selectOptions(screen.getByLabelText('Source'), 'footer')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/newsletter/subscribers').get('source')).toBe('footer'))
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/admin/newsletter/subscribers/export.csv?status=subscribed&source=footer')

    await user.click(screen.getByRole('button', { name: 'Unsubscribe ava@example.com' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Unsubscribe ava@example.com?' })).getByRole('button', { name: 'Unsubscribe' }))
    expect(await screen.findByText(/ava@example.com is unsubscribed/)).toHaveFocus()
  })

  it('previews the campaign as it is typed, cleaned like the server, and saves a draft', async () => {
    const fetchMock = start(OWNER, '/newsletter/campaigns/new', {
      'POST /api/admin/newsletter/campaigns': () => ({ status: 201, body: { campaign: { id: 2, status: 'draft', subject: 'Winter deals', preheader: '', body: '<p>Hello <a href="https://shop.example" rel="noopener">shop</a></p>', sentCount: 0 } } }),
      'GET /api/admin/newsletter/campaigns/2': { body: { id: 2, status: 'draft', subject: 'Winter deals', preheader: '', body: '<p>Hello <a href="https://shop.example" rel="noopener">shop</a></p>', sentCount: 0, live: true } },
      'GET /api/admin/newsletter/subscribers': { body: { subscribers: [], total: 3, counts: { subscribed: 3 } } },
    })
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Subject'), 'Winter deals')
    const body = screen.getByLabelText('Email body (HTML)')
    await user.click(body)
    await user.paste('<p onclick="steal()">Hello <a href="javascript:alert(1)">bad</a> <a href="https://shop.example">shop</a></p><script>alert(1)</script><img src=x onerror=alert(1)>')
    const preview = screen.getByRole('region', { name: 'Preview' })
    expect(within(preview).getByText('Winter deals')).toBeInTheDocument()
    const article = preview.querySelector('article')
    expect(article.innerHTML).toBe('<p>Hello <a rel="noopener">bad</a> <a href="https://shop.example" rel="noopener">shop</a></p>')
    expect(article.querySelector('script, img, [onclick]')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText(/Draft saved/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/newsletter/campaigns')).toMatchObject({ subject: 'Winter deals', preheader: null })
  })

  it('sends a test to the admin, then sends to subscribers after confirming; a sent campaign is read-only', async () => {
    const DRAFT = { id: 2, status: 'draft', subject: 'Winter deals', preheader: 'Up to 30% off', body: '<p>Hello</p>', sentCount: 0, recipientCount: 0, failedCount: 0, live: true }
    const SENT = { ...DRAFT, status: 'sent', recipientCount: 3, sentCount: 3, sentAt: '2026-11-17T10:00:00Z' }
    let current = DRAFT
    const fetchMock = start(OWNER, '/newsletter/campaigns/2', {
      'GET /api/admin/newsletter/campaigns/2': () => ({ body: current }),
      'GET /api/admin/newsletter/subscribers': { body: { subscribers: [], total: 3, counts: { subscribed: 3 } } },
      'POST /api/admin/newsletter/campaigns/2/test': { body: { sent: true, email: 'owner@buynest.test', message: 'Test email sent to owner@buynest.test.' } },
      'POST /api/admin/newsletter/campaigns/2/send': () => {
        current = SENT
        return { body: { campaign: SENT, message: 'Sending.' } }
      },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Send test to me' }))
    expect(await screen.findByText('Test email sent to owner@buynest.test.')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Send to subscribers' }))
    const dialog = screen.getByRole('dialog', { name: 'Send “Winter deals”?' })
    expect(within(dialog).getByText(/3 subscribed addresses/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send campaign' }))
    expect(await screen.findByText('Sent to 3 subscribers.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).endsWith('/send'))).toHaveLength(1)
    expect(await screen.findByText('This campaign has been sent, so it can’t be changed.')).toBeInTheDocument()
    expect(screen.getByLabelText('Subject')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Send to subscribers' })).not.toBeInTheDocument()
  })
})

describe('reports', () => {
  const CART = {
    customerId: 5, customer: { id: 5, name: 'Ava Stone', email: 'ava@example.com', isActive: true },
    items: [{ productId: 12, variantId: null, name: 'Mascara', variantLabel: null, quantity: 2, salePrice: 8.94, available: true }],
    itemCount: 2, subtotal: 17.88, updatedAt: '2026-11-16T08:00:00Z', ageMinutes: 1500, remindedAt: null, canRemind: true, remindAvailableAt: null,
  }

  it('lists abandoned carts, filters them, and sends a reminder (the 72-hour limit is explained)', async () => {
    const fetchMock = start(OWNER, '/abandoned-carts', {
      'GET /api/admin/reports/abandoned-carts': {
        body: { carts: [CART, { ...CART, customerId: 6, customer: { id: 6, name: 'Ben Cole', email: 'ben@example.com', isActive: true }, canRemind: false, remindedAt: '2026-11-16T09:00:00Z', remindAvailableAt: '2026-11-19T09:00:00Z' }], total: 2, live: true },
      },
      'POST /api/admin/reports/abandoned-carts/5/remind': { status: 429, body: { message: 'This customer was reminded less than 72 hours ago.', code: 'too_soon' } },
    })
    const user = userEvent.setup()
    const row = (await screen.findByRole('rowheader', { name: /Ava Stone/ })).closest('tr')
    expect(within(row).getByText('2 × Mascara')).toBeInTheDocument()
    expect(within(row).getByText('$17.88')).toBeInTheDocument()
    expect(within(row).getByText('25 hours')).toBeInTheDocument()
    const ben = screen.getByRole('rowheader', { name: /Ben Cole/ }).closest('tr')
    expect(within(ben).queryByRole('button')).not.toBeInTheDocument()
    expect(within(ben).getByText(/possible again/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Untouched for at least'), '24')
    await user.type(screen.getByLabelText('Minimum subtotal (USD)'), '20')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/reports/abandoned-carts').get('minSubtotal')).toBe('20'))
    expect(lastQuery(fetchMock, '/api/admin/reports/abandoned-carts').get('minAgeHours')).toBe('24')

    await user.click(screen.getByRole('button', { name: 'Remind Ava Stone' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This customer was reminded less than 72 hours ago.')
  })

  it('a role without newsletter.send sees no Remind button', async () => {
    start(VIEWER, '/abandoned-carts', { 'GET /api/admin/reports/abandoned-carts': { body: { carts: [CART], total: 1, live: true } } })
    expect(await screen.findByRole('rowheader', { name: /Ava Stone/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument()
  })

  const TERM = { id: 3, term: 'red shoes', hits: 14, lastResultsCount: 0, redirectUrl: null, updatedAt: '2026-11-17T09:00:00Z' }

  it('shows top and zero-result terms, and edits a term’s redirect', async () => {
    const fetchMock = start(OWNER, '/search-terms', {
      'GET /api/admin/reports/search-terms': { body: { terms: [TERM], total: 1, live: true } },
      'GET /api/admin/search-terms': { body: { terms: [], total: 0, live: true } },
      'PATCH /api/admin/search-terms/3': { body: { term: { ...TERM, redirectUrl: '/category/shoes' } } },
    })
    const user = userEvent.setup()
    const row = (await screen.findByRole('rowheader', { name: 'red shoes' })).closest('tr')
    expect(within(row).getByText('None')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Show'), 'zero')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/reports/search-terms').get('type')).toBe('zero'))
    await user.selectOptions(screen.getByLabelText('Show'), 'redirects')
    expect(await screen.findByText('No term has a redirect yet.')).toBeInTheDocument()
    expect(lastQuery(fetchMock, '/api/admin/search-terms').get('hasRedirect')).toBe('true')
    await user.selectOptions(screen.getByLabelText('Show'), 'top')

    await user.click(await screen.findByRole('button', { name: 'Edit the redirect for “red shoes”' }))
    const dialog = screen.getByRole('dialog', { name: 'Redirect for “red shoes”' })
    await user.type(within(dialog).getByLabelText('Redirect to'), '//evil.example')
    await user.click(within(dialog).getByRole('button', { name: 'Save redirect' }))
    expect(within(dialog).getByLabelText('Redirect to')).toHaveAccessibleDescription(/Enter a store path like/)
    await user.clear(within(dialog).getByLabelText('Redirect to'))
    await user.type(within(dialog).getByLabelText('Redirect to'), '/category/shoes')
    await user.click(within(dialog).getByRole('button', { name: 'Save redirect' }))
    expect(await screen.findByText('Searching “red shoes” now goes to /category/shoes.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/search-terms/3')).toEqual({ redirectUrl: '/category/shoes' })
  })

  it('without seo.manage the report is read-only', async () => {
    start(VIEWER, '/search-terms', { 'GET /api/admin/reports/search-terms': { body: { terms: [TERM], total: 1, live: true } } })
    expect(await screen.findByRole('rowheader', { name: 'red shoes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /redirect/i })).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('Show')).queryByRole('option', { name: 'Terms with a redirect' })).not.toBeInTheDocument()
  })
})

describe('sanitizeHtml (the campaign preview)', () => {
  it('keeps the allow-list, unwraps wrappers, and drops everything else with its content', () => {
    expect(sanitizeHtml('<div><b>Hi</b> <span style="color:red">there</span></div>')).toBe('Hi there')
    expect(sanitizeHtml('<h1>Title</h1><h2 class="x" id="y">Sub</h2>')).toBe('Title<h2>Sub</h2>')
    expect(sanitizeHtml('<style>p{}</style><iframe src="https://x"></iframe><p>ok</p>')).toBe('<p>ok</p>')
    expect(sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">x</a><a href="java\tscript:alert(1)">y</a><a href="/sale" title="Sale">z</a>')).toBe(
      '<a rel="noopener">x</a><a rel="noopener">y</a><a href="/sale" title="Sale" rel="noopener">z</a>',
    )
    expect(sanitizeHtml('<table><tr><th scope="col" onclick="x()">A</th></tr></table>')).toBe('<table><tbody><tr><th scope="col">A</th></tr></tbody></table>')
    expect(sanitizeHtml('   ')).toBe('')
  })
})
