import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

// BuyNest's backend (VITE_API_PROVIDER=laravel with Laravel accounts): phase 4 screens exist.
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const ALL = ['dashboard.view', 'products.view', 'products.edit', 'products.delete', 'orders.view', 'orders.edit', 'customers.view', 'coupons.view', 'coupons.edit', 'content.view', 'content.edit', 'reports.view', 'settings.view', 'settings.edit', 'admins.manage', 'audit.view']
const OWNER = { ...ADMIN, id: 1, name: 'Store Owner', role: { id: 1, name: 'Owner' }, permissions: ALL }
const SALES = { ...ADMIN, id: 2, name: 'Sam Sales', role: { id: 2, name: 'Sales staff' }, permissions: ['orders.view', 'orders.edit', 'customers.view'] }
const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => init?.method === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const nav = () => within(screen.getByRole('navigation', { name: 'Admin' }))

describe('permissions in the admin app', () => {
  it('shows only what the role allows, and opens the first allowed screen instead of the dashboard', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: SALES },
      'GET /api/admin/orders': { body: { orders: [], total: 0, live: true } },
    })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument()
    const links = nav().getAllByRole('link').map((link) => link.textContent)
    expect(links).toEqual(['Orders', 'Shipments', 'Invoices', 'Credit memos', 'All customers', 'Customer groups'])
    expect(screen.getByText(/Sales staff/)).toBeInTheDocument()
  })

  it('a screen the role lacks says so, naming the permission', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: SALES } })
    renderApp('/settings')
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
    expect(screen.getByText('View store settings')).toBeInTheDocument()
    expect(screen.getByText('(settings.view)')).toBeInTheDocument()
  })

  it("a 403 permission_denied from the server shows the same friendly screen", async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/reports/sales': { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'reports.view' } },
      'GET /api/admin/reports/products': { body: { products: [] } },
      'GET /api/admin/reports/customers': { body: { newCustomers: 0, returningCustomers: 0, guestOrders: 0, topCustomers: [] } },
      'GET /api/admin/reports/coupons': { body: { coupons: [] } },
      'GET /api/admin/reports/low-stock': { body: { products: [] } },
    })
    renderApp('/reports')
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
    expect(screen.getByText('View reports')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('hides actions the role can’t take', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: { ...SALES, permissions: ['products.view'] } },
      'GET /api/admin/categories': { body: [] },
      'GET /api/admin/products': { body: { products: [{ id: 1, title: 'Mascara', category: 'beauty', price: 9.99, stock: 99, status: 'active' }], total: 1, live: true } },
    })
    renderApp('/products')
    expect(await screen.findByText('Mascara')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Add product/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Mascara' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit Mascara' })).not.toBeInTheDocument()
  })

  it('an admin without a permission list (older API) sees everything', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/overview': { status: 500, body: {} } })
    renderApp('/')
    await screen.findByRole('navigation', { name: 'Admin' })
    expect(nav().getByRole('link', { name: 'Audit log' })).toBeInTheDocument()
    expect(nav().getByRole('link', { name: 'Settings' })).toBeInTheDocument()
  })
})

describe('admin users and roles', () => {
  const ROLES = {
    roles: [
      { id: 1, name: 'Owner', description: 'Everything', permissions: ALL, isSystem: true, adminCount: 1 },
      { id: 2, name: 'Sales staff', description: '', permissions: ['orders.view'], isSystem: false, adminCount: 0 },
    ],
  }
  const PERMISSIONS = { groups: [{ label: 'Sales', permissions: [{ key: 'orders.view', label: 'View orders' }, { key: 'orders.edit', label: 'Change orders' }] }] }

  it('adds an admin with a role and a strong password', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/admins': { body: { admins: [{ id: 1, name: 'Store Owner', email: 'owner@buynest.test', role: { id: 1, name: 'Owner' }, roleId: 1, isActive: true }], total: 1 } },
      'GET /api/admin/roles': { body: ROLES },
      'POST /api/admin/admins': { status: 201, body: { admin: { id: 3, name: 'Nia', email: 'nia@buynest.test', roleId: 2, isActive: true } } },
    })
    const user = userEvent.setup()
    renderApp('/admins')
    const row = (await screen.findByText('Store Owner', { selector: 'th' })).closest('tr')
    // You can't deactivate yourself.
    expect(within(row).queryByRole('button', { name: /Deactivate/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Add admin/ }))
    const dialog = screen.getByRole('dialog', { name: 'Add an admin' })
    await user.type(within(dialog).getByLabelText('Name'), 'Nia')
    await user.type(within(dialog).getByLabelText('Email'), 'nia@buynest.test')
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'Sales staff')
    await user.type(within(dialog).getByLabelText('Password'), 'short1')
    await user.click(within(dialog).getByRole('button', { name: 'Add admin' }))
    expect(within(dialog).getByText('Use at least 12 characters, with letters and numbers.')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Password'), 'LongerPass2026')
    await user.click(within(dialog).getByRole('button', { name: 'Add admin' }))
    expect(await screen.findByText('Nia can now sign in to the admin.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'POST', '/api/admin/admins')).toEqual({ name: 'Nia', email: 'nia@buynest.test', roleId: 2, isActive: true, password: 'short1LongerPass2026' })
  })

  it('shows system roles read-only and saves a role with the chosen permissions', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/roles': { body: ROLES },
      'GET /api/admin/permissions': { body: PERMISSIONS },
      'PATCH /api/admin/roles/2': { body: { role: { ...ROLES.roles[1], permissions: ['orders.view', 'orders.edit'] } } },
    })
    const user = userEvent.setup()
    renderApp('/roles')
    await user.click(await screen.findByRole('button', { name: 'View Owner' }))
    const system = screen.getByRole('dialog', { name: 'Owner (system role)' })
    expect(within(system).getByRole('checkbox', { name: 'Change orders' })).toBeDisabled()
    expect(within(system).getByRole('checkbox', { name: 'Change orders' })).toBeChecked()
    await user.click(within(system).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Delete Owner' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Sales staff' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Sales staff' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Change orders' }))
    expect(within(dialog).getByText('2 permissions chosen.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The Sales staff role was saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/roles/2')).toEqual({ name: 'Sales staff', description: null, permissions: ['orders.view', 'orders.edit'] })
  })

  it('the audit log shows before and after, and filters by action', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/admins': { body: { admins: [], total: 0 } },
      'GET /api/admin/audit': {
        body: { entries: [{ id: 1, adminName: 'Store Owner', action: 'product.updated', summary: 'Updated Mascara', changes: [{ field: 'price', before: '9.99', after: '12.50' }], ip: '127.0.0.1', createdAt: '2026-11-10T09:00:00Z' }], total: 1 },
      },
    })
    const user = userEvent.setup()
    renderApp('/audit')
    await user.click(await screen.findByText('1 field changed'))
    const changes = screen.getByRole('table', { name: 'Changes: before and after' })
    expect(within(changes).getByRole('row', { name: 'price 9.99 12.50' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Action'), 'Coupon.Updated')
    await user.click(screen.getByRole('button', { name: /Filter/ }))
    await waitFor(() => expect(new URL(fetchMock.mock.calls.at(-1)[0]).searchParams.get('action')).toBe('coupon.updated'))
  })
})

describe('content', () => {
  it("previews only the server's sanitized body, never the typed HTML", async () => {
    withSession()
    const page = { id: 3, slug: 'about', title: 'About', body: '<p>Hello <strong>there</strong></p>', metaTitle: '', metaDescription: '', isPublished: true }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/pages/3': { body: page },
      'PATCH /api/admin/pages/3': { body: { page: { ...page, body: '<p>Hi</p>' } } },
    })
    const user = userEvent.setup()
    const { container } = renderApp('/pages/3')
    const body = await screen.findByLabelText('Content (HTML)')
    expect(container.querySelector('.cms-preview strong')).toHaveTextContent('there')

    await user.clear(body)
    await user.type(body, '<p>Hi</p><img src=x onerror=alert(1)>')
    expect(screen.getByText(/You have unsaved changes/)).toBeInTheDocument()
    expect(container.querySelector('.cms-preview img')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save page' }))
    expect(await screen.findByText(/Saved and published. Some HTML was removed by the safety filter/)).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/pages/3').body).toBe('<p>Hi</p><img src=x onerror=alert(1)>')
    expect(container.querySelector('.cms-preview').innerHTML).toBe('<p>Hi</p>')
    expect(body).toHaveValue('<p>Hi</p>')
  })

  it('reorders banners and picks featured products by search', async () => {
    withSession()
    const home = {
      hero: { eyebrow: '', title: 'Hello', description: '', primaryCta: { label: 'Shop', url: '/products' }, secondaryCta: null, imageUrl: '', imageAlt: '', highlights: ['Free shipping'] },
      banners: [
        { id: 1, eyebrow: '', title: 'Laptops', description: '', cta: { label: 'Go', url: '/laptops' }, imageUrl: '', imageAlt: '', tone: 'navy', position: 1, isActive: true },
        { id: 2, eyebrow: '', title: 'Scents', description: '', cta: { label: 'Go', url: '/scents' }, imageUrl: '', imageAlt: '', tone: 'rose', position: 2, isActive: true },
      ],
      featuredProductIds: [5],
      featuredProducts: [{ id: 5, title: 'Lamp' }],
    }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/home': { body: home },
      'GET /api/admin/products': { body: { products: [{ id: 9, title: 'Mascara', price: 9.99 }], total: 1 } },
      'PUT /api/admin/home': (url, init) => ({ body: { home: { ...home, ...JSON.parse(init.body) } } }),
    })
    const user = userEvent.setup()
    renderApp('/home-page')
    await user.click(await screen.findByRole('button', { name: 'Move Laptops down' }))
    expect(screen.getByText('Laptops moved to position 2 of 2.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move Laptops up' })).toHaveFocus())

    await user.type(screen.getByLabelText('Search products to feature'), 'masc{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Feature Mascara' }))
    await user.click(screen.getByRole('button', { name: 'Save home page' }))
    expect(await screen.findByText(/Home page saved/)).toBeInTheDocument()
    const sent = sentTo(fetchMock, 'PUT', '/api/admin/home')
    expect(sent.banners.map((banner) => banner.title)).toEqual(['Scents', 'Laptops'])
    expect(sent.featuredProductIds).toEqual([5, 9])
    expect(sent.hero).toMatchObject({ secondaryCta: null, highlights: ['Free shipping'] })
  })
})

describe('reports and settings', () => {
  it('shows KPI tiles, a described chart with its table, and CSV links for the range', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/reports/sales': {
        body: {
          totals: { orders: 3, units: 5, gross: 120, discounts: 10, shipping: 4.99, refunds: 20, net: 90, averageOrder: 40 },
          series: [{ period: '2026-11-09', orders: 1, gross: 40, refunds: 0, net: 40 }, { period: '2026-11-10', orders: 2, gross: 80, refunds: 20, net: 50 }],
        },
      },
      'GET /api/admin/reports/products': { body: { products: [{ productId: 1, name: 'Mascara', sku: 'BEA-1', units: 5, revenue: 44.7 }] } },
      'GET /api/admin/reports/customers': { body: { newCustomers: 2, returningCustomers: 1, guestOrders: 1, topCustomers: [] } },
      'GET /api/admin/reports/coupons': { body: { coupons: [{ code: 'NEST10', uses: 2, discountTotal: 10 }] } },
      'GET /api/admin/reports/low-stock': { body: { products: [{ id: 4, title: 'Lamp', stock: 0 }] } },
    })
    renderApp('/reports?from=2026-11-09&to=2026-11-10&groupBy=day')
    expect(await screen.findByText('$90.00')).toBeInTheDocument()
    expect(screen.getByText('Net revenue')).toBeInTheDocument()
    const chart = screen.getByRole('img', { name: 'Net revenue by day' })
    expect(chart).toHaveAccessibleDescription('2 days from Nov 9 to Nov 10. Total $90.00; highest $50.00 (Nov 10).')
    expect(within(screen.getByRole('table', { name: 'Sales by day' })).getByRole('row', { name: 'Nov 10 2 $80.00 $20.00 $50.00' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download sales CSV' })).toHaveAttribute('href', '/api/admin/reports/sales.csv?from=2026-11-09&to=2026-11-10&groupBy=day')
    expect(await screen.findByText('Mascara')).toBeInTheDocument()
    expect(screen.getByText('Out of stock')).toBeInTheDocument()
  })

  it('saves one settings group at a time, with tax rates added in the table', async () => {
    withSession()
    const settings = {
      general: { storeName: 'BuyNest', supportEmail: '', supportPhone: '', address: '' },
      shipping: { standardPrice: 4.99, freeShippingThreshold: 50, expressPrice: 12.99, nextDayPrice: 24.99, enabledMethods: ['standard', 'express', 'nextDay'] },
      tax: { taxEnabled: false, taxRates: [], pricesIncludeTax: false },
      checkout: { allowedCountries: ['Germany'], guestCheckout: true, enabledPaymentMethods: ['card', 'cod'] },
      inventory: { lowStockThreshold: 10 },
    }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/settings': { body: settings },
      'PATCH /api/admin/settings': { body: settings },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const tax = await screen.findByRole('form', { name: 'Tax' })
    await user.click(within(tax).getByRole('checkbox', { name: 'Charge tax' }))
    await user.click(within(tax).getByRole('button', { name: /Add a rate/ }))
    await waitFor(() => expect(within(tax).getByLabelText('Country, row 1')).toHaveFocus())
    await user.click(within(tax).getByRole('button', { name: 'Save tax' }))
    expect(within(tax).getByText('Enter a country.')).toBeInTheDocument()
    await user.type(within(tax).getByLabelText('Country, row 1'), 'Germany')
    await user.type(within(tax).getByLabelText('Rate in percent for Germany'), '19')
    await user.click(within(tax).getByRole('button', { name: 'Save tax' }))
    expect(await within(tax).findByText('Tax saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ tax: { taxEnabled: true, pricesIncludeTax: false, taxRates: [{ country: 'Germany', rate: 19 }] } })
  })

  it('settings are read-only without settings.edit', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: { ...OWNER, permissions: ['settings.view'] } },
      'GET /api/admin/settings': { body: { general: { storeName: 'BuyNest' }, shipping: {}, tax: {}, checkout: {}, inventory: { lowStockThreshold: 10 } } },
    })
    renderApp('/settings')
    expect(await screen.findByLabelText('Store name')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()
  })
})
