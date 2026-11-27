import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { setStoreCurrency } from '../utils/format'
import { settingsToForm, toWelcomePayload, welcomeErrors, welcomePreview } from '../utils/welcomeCoupon'

/*
 * Phase 19 (docs/backend/PHASE19_CONTRACT.md §2): Marketing → Welcome coupon
 * (settings, live preview, stats, codes sent), and the Coupons page's
 * "Your coupons" / "Welcome codes" tabs, "First order only" on staff coupons,
 * and a welcome code's read-only page. BuyNest's backend; the admin service
 * is mocked.
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

afterEach(() => {
  setStoreCurrency(null) // back to USD for the next test
})

const OWNER = { ...ADMIN, role: { id: 1, name: 'Owner' }, permissions: ['coupons.view', 'coupons.edit', 'customers.view', 'orders.view'] }
const VIEWER = { ...ADMIN, role: { id: 5, name: 'Viewer' }, permissions: ['coupons.view'] }
const BDT_STORE = { body: { data: { currency: { code: 'BDT', symbol: '৳', decimals: 2 } } } }

const sentTo = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}
const lastQuery = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === 'GET' && new URL(url).pathname === path)
  return call && new URL(call[0]).searchParams
}
const callsTo = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)

const SETTINGS = { enabled: false, triggers: ['signup', 'newsletter'], type: 'percent', value: 10, minSubtotal: null, validDays: 30, firstOrderOnly: true }
const WELCOME = { settings: SETTINGS, offer: { type: 'percent', value: 10, label: '10% off', minSubtotal: null, validDays: 30, firstOrderOnly: true, triggers: ['signup', 'newsletter'] }, stats: { issued: 12, used: 3, active: 7, expired: 2 }, live: true }
const CODES = {
  codes: [
    { id: 9, code: 'WELCOME-ABC234', email: 'nadia@example.com', trigger: 'signup', customer: { id: 5, name: 'Nadia Rahman' }, issuedAt: '2026-11-20T09:00:00Z', expiresAt: '2026-12-20T17:59:59Z', status: 'used', usedOnOrder: 'BN-100042' },
    { code: 'WELCOME-XYZ789', email: 'guest@example.com', trigger: 'newsletter', customer: null, issuedAt: '2026-11-19T09:00:00Z', expiresAt: '2026-12-19T17:59:59Z', status: 'expired', usedOnOrder: null },
  ],
  total: 2,
  live: true,
}

function welcomePage(me = OWNER, extra = {}) {
  withSession()
  const fetchMock = mockFetch({
    'GET /api/admin/me': { body: me },
    'GET /api/catalog/store': BDT_STORE,
    'GET /api/admin/marketing/welcome-coupon': { body: WELCOME },
    'GET /api/admin/marketing/welcome-coupon/codes': { body: CODES },
    ...extra,
  })
  renderApp('/welcome-coupon')
  return fetchMock
}

describe('helpers', () => {
  const form = settingsToForm(SETTINGS)

  it('turns the saved settings into the form and back', () => {
    expect(form).toEqual({ enabled: false, triggers: ['signup', 'newsletter'], type: 'percent', value: '10', minSubtotal: '', validDays: '30', firstOrderOnly: true })
    expect(settingsToForm({})).toMatchObject({ enabled: false, triggers: ['signup', 'newsletter'], type: 'percent', value: '', validDays: '30', firstOrderOnly: true })
    expect(toWelcomePayload({ ...form, enabled: true, triggers: ['newsletter'], type: 'fixed', value: '100', minSubtotal: '500', validDays: '14', firstOrderOnly: false })).toEqual({
      enabled: true, triggers: ['newsletter'], type: 'fixed', value: 100, minSubtotal: 500, validDays: 14, firstOrderOnly: false,
    })
    expect(toWelcomePayload(form)).toMatchObject({ minSubtotal: null, value: 10, validDays: 30 })
  })

  it('checks the settings with the server’s words', () => {
    expect(welcomeErrors(form)).toEqual({})
    expect(welcomeErrors({ ...form, triggers: [], value: '95', validDays: '0', minSubtotal: '-5' })).toEqual({
      triggers: ['Choose at least one way to earn the code.'],
      value: ['A percentage discount is between 1 and 90.'],
      validDays: ['A code is valid for 1 to 365 days.'],
      minSubtotal: [expect.stringMatching(/minimum order/)],
    })
    expect(welcomeErrors({ ...form, value: '12.5' }).value).toBeDefined()
    expect(welcomeErrors({ ...form, value: '' }).value).toBeDefined()
    expect(welcomeErrors({ ...form, type: 'fixed', value: '99.5' })).toEqual({})
    expect(welcomeErrors({ ...form, type: 'fixed', value: '100001' }).value).toBeDefined()
    expect(welcomeErrors({ ...form, type: 'fixed', value: '1.234' }).value).toBeDefined()
    expect(welcomeErrors({ ...form, validDays: '366' }).validDays).toBeDefined()
  })

  it('writes the preview shoppers will see', () => {
    const money = (value) => `৳${value}`
    expect(welcomePreview(form, money)).toEqual({
      title: 'Get 10% off your first order',
      minimum: null,
      newsletter: "Confirm your email and we'll send your personal code.",
      signup: 'Create an account and get 10% off your first order.',
    })
    expect(welcomePreview({ ...form, type: 'fixed', value: '100', minSubtotal: '500', firstOrderOnly: false, triggers: ['signup'] }, money)).toEqual({
      title: 'Get ৳100 off', minimum: 'Orders over ৳500.', newsletter: null, signup: 'Create an account and get ৳100 off.',
    })
    expect(welcomePreview({ ...form, value: '95' }, money)).toBeNull()
  })
})

describe('Marketing → Welcome coupon', () => {
  it('is in the Marketing menu, next to Coupons', async () => {
    welcomePage()
    expect(await screen.findByRole('heading', { name: 'Welcome coupon', level: 1 })).toBeInTheDocument()
    const marketing = within(within(screen.getByRole('navigation', { name: 'Admin' })).getByRole('list', { name: 'Marketing' }))
    const links = marketing.getAllByRole('link').map((link) => link.textContent)
    expect(links.indexOf('Welcome coupon')).toBe(links.indexOf('Coupons') + 1)
  })

  it('shows the stats, the state in words, and a live preview; saves the settings', async () => {
    const fetchMock = welcomePage(OWNER, {
      'PUT /api/admin/marketing/welcome-coupon': (url, init) => ({ body: { ...WELCOME, settings: { ...SETTINGS, ...JSON.parse(init.body) } } }),
    })
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'Settings' }))
    // Stats tiles.
    for (const [label, value] of [['Issued', '12'], ['Used', '3'], ['Active', '7'], ['Expired', '2']]) expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(value)
    // The help text.
    expect(screen.getByText(/only to confirmed email addresses/)).toHaveTextContent(/one per email address, ever/)
    expect(screen.getByText(/only to confirmed email addresses/)).toHaveTextContent(/Changes apply to new codes only/)

    // Off: the state in words, and the preview says the store shows nothing.
    const toggle = form.getByRole('switch', { name: 'Welcome coupon' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription('Off')
    expect(form.getByText('The store shows no offer while the welcome coupon is off.')).toBeInTheDocument()
    const preview = within(form.getByRole('region', { name: 'Preview: what shoppers see' }))
    expect(preview.getByText('Get 10% off your first order')).toBeInTheDocument()
    expect(preview.getByText("Confirm your email and we'll send your personal code.")).toBeInTheDocument()
    // Nothing changed yet: nothing to save.
    expect(form.getByRole('button', { name: 'Save welcome coupon' })).toBeDisabled()

    await user.click(toggle)
    expect(toggle).toHaveAccessibleDescription('On: new customers get a code')
    await user.selectOptions(form.getByLabelText('Discount type'), 'fixed')
    // The store currency in the labels.
    await user.clear(form.getByLabelText('Amount off (BDT)'))
    await user.type(form.getByLabelText('Amount off (BDT)'), '0')
    expect(preview.queryByText(/^Get /)).not.toBeInTheDocument()
    expect(preview.getByText('Enter a valid discount to see the preview.')).toBeInTheDocument()
    await user.clear(form.getByLabelText('Amount off (BDT)'))
    await user.type(form.getByLabelText('Amount off (BDT)'), '100')
    await user.type(form.getByLabelText('Minimum order (BDT, optional)'), '500')
    await user.click(form.getByRole('checkbox', { name: 'First order only' }))
    expect(preview.getByText('Get ৳100 off')).toBeInTheDocument()
    expect(preview.getByText('Orders over ৳500.')).toBeInTheDocument()
    await user.click(form.getByRole('checkbox', { name: 'When someone confirms the newsletter' }))
    expect(preview.queryByText(/Confirm your email/)).not.toBeInTheDocument()
    expect(preview.getByText(/Create an account and get ৳100 off\./)).toBeInTheDocument()
    await user.clear(form.getByLabelText('Valid for (days)'))
    await user.type(form.getByLabelText('Valid for (days)'), '14')

    await user.click(form.getByRole('button', { name: 'Save welcome coupon' }))
    expect(await screen.findByText('Welcome coupon saved.')).toHaveFocus()
    expect(sentTo(fetchMock, 'PUT', '/api/admin/marketing/welcome-coupon')).toEqual({
      enabled: true, triggers: ['signup'], type: 'fixed', value: 100, minSubtotal: 500, validDays: 14, firstOrderOnly: false,
    })
    // The form now shows what was saved, with nothing left to save.
    expect(screen.getByRole('switch', { name: 'Welcome coupon' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save welcome coupon' })).toBeDisabled()
  })

  it('checks the fields before saving, and shows the server’s messages on them', async () => {
    const fetchMock = welcomePage(OWNER, {
      'PUT /api/admin/marketing/welcome-coupon': { status: 422, body: { message: 'Please check the highlighted fields.', errors: { validDays: ['A code is valid for 1 to 365 days.'] } } },
    })
    const user = userEvent.setup()
    const form = within(await screen.findByRole('form', { name: 'Settings' }))
    await user.click(form.getByRole('checkbox', { name: 'When someone creates an account' }))
    await user.click(form.getByRole('checkbox', { name: 'When someone confirms the newsletter' }))
    await user.clear(form.getByLabelText('Percent off'))
    await user.type(form.getByLabelText('Percent off'), '95')
    await user.click(form.getByRole('button', { name: 'Save welcome coupon' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check the highlighted fields.')
    expect(form.getByRole('group', { name: 'How customers earn it' })).toHaveAccessibleDescription('Choose at least one way to earn the code.')
    expect(form.getByLabelText('Percent off')).toHaveAttribute('aria-invalid', 'true')
    expect(form.getByLabelText('Percent off')).toHaveAccessibleDescription(/A percentage discount is between 1 and 90\./)
    expect(callsTo(fetchMock, 'PUT', '/api/admin/marketing/welcome-coupon')).toHaveLength(0)

    await user.click(form.getByRole('checkbox', { name: 'When someone confirms the newsletter' }))
    await user.clear(form.getByLabelText('Percent off'))
    await user.type(form.getByLabelText('Percent off'), '15')
    await user.click(form.getByRole('button', { name: 'Save welcome coupon' }))
    await waitFor(() => expect(form.getByLabelText('Valid for (days)')).toHaveAccessibleDescription(/A code is valid for 1 to 365 days\./))
    expect(sentTo(fetchMock, 'PUT', '/api/admin/marketing/welcome-coupon')).toMatchObject({ triggers: ['newsletter'], value: 15 })
  })

  it('is read-only without coupons.edit', async () => {
    welcomePage(VIEWER)
    const form = within(await screen.findByRole('form', { name: 'Settings' }))
    expect(form.getByRole('switch', { name: 'Welcome coupon' })).toBeDisabled()
    expect(form.getByLabelText('Percent off')).toBeDisabled()
    expect(form.getByRole('checkbox', { name: 'First order only' })).toBeDisabled()
    expect(form.queryByRole('button', { name: 'Save welcome coupon' })).not.toBeInTheDocument()
    expect(form.getByText('Your role can view these settings but not change them.')).toBeInTheDocument()
  })

  it('lists the codes sent, with the status in words, filters and search', async () => {
    const fetchMock = welcomePage()
    const user = userEvent.setup()
    const table = within(await screen.findByRole('table', { name: 'Welcome codes sent, newest first' }))
    const used = table.getByText('WELCOME-ABC234').closest('tr')
    expect(within(used).getByText('Used')).toBeInTheDocument()
    expect(within(used).getByText('Account sign-up')).toBeInTheDocument()
    expect(within(used).getByRole('link', { name: 'Nadia Rahman' })).toHaveAttribute('href', '/customers/5')
    expect(within(used).getByRole('link', { name: 'BN-100042' })).toHaveAttribute('href', '/orders/BN-100042')
    const expired = table.getByText('WELCOME-XYZ789').closest('tr')
    expect(within(expired).getByText('Expired')).toBeInTheDocument()
    expect(within(expired).getByText('Newsletter')).toBeInTheDocument()
    expect(within(expired).queryByRole('link')).not.toBeInTheDocument()
    // A code links to its coupon page (read-only, except Active).
    expect(within(used).getByRole('link', { name: 'WELCOME-ABC234' })).toHaveAttribute('href', '/coupons/9')

    const codes = within(screen.getByRole('region', { name: 'Codes sent' }))
    await user.selectOptions(codes.getByLabelText('Status'), 'used')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/marketing/welcome-coupon/codes').get('status')).toBe('used'))
    await user.type(codes.getByLabelText('Search welcome codes'), 'nadia')
    await user.click(codes.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/marketing/welcome-coupon/codes').get('q')).toBe('nadia'))
  })

  it('says so when no code was sent yet', async () => {
    welcomePage(OWNER, { 'GET /api/admin/marketing/welcome-coupon/codes': { body: { codes: [], total: 0, live: true } } })
    expect(await screen.findByText('No welcome codes sent yet.')).toBeInTheDocument()
  })
})

const STAFF = { id: 3, code: 'WINTER5', description: '$5 off', type: 'fixed', value: 5, minSubtotal: 25, usageLimit: 100, usageLimitPerCustomer: 1, timesUsed: 4, isActive: true, status: 'active', source: 'staff', issuedToEmail: null, firstOrderOnly: true }
const WELCOME_CODE = {
  id: 9, code: 'WELCOME-ABC234', description: 'Welcome offer for nadia@example.com', type: 'percent', value: 10, minSubtotal: 500, startsAt: '2026-11-20T09:00:00Z', endsAt: '2026-12-20T17:59:59Z',
  usageLimit: 1, usageLimitPerCustomer: 1, timesUsed: 0, isActive: true, status: 'active', appliesTo: 'all', autoApply: false, source: 'welcome', issuedToEmail: 'nadia@example.com', firstOrderOnly: true,
}

describe('Coupons: your coupons and welcome codes', () => {
  it('shows your coupons first, and welcome codes in their own tab, without delete', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/coupons': (url) => ({ body: url.searchParams.get('source') === 'welcome' ? { coupons: [WELCOME_CODE], total: 1, live: true } : { coupons: [STAFF], total: 1, live: true } }),
    })
    const user = userEvent.setup()
    renderApp('/coupons')
    expect(await screen.findByRole('link', { name: 'WINTER5' })).toBeInTheDocument()
    const tabs = within(screen.getByRole('tablist', { name: 'Coupon lists' }))
    expect(tabs.getByRole('tab', { name: 'Your coupons' })).toHaveAttribute('aria-selected', 'true')
    expect(lastQuery(fetchMock, '/api/admin/coupons').get('source')).toBe('staff')
    expect(within(screen.getByRole('link', { name: 'WINTER5' }).closest('tr')).getByText(/first order only/)).toBeInTheDocument()
    expect(screen.getByLabelText('Kind')).toBeInTheDocument()

    await user.click(tabs.getByRole('tab', { name: 'Welcome codes' }))
    const row = (await screen.findByRole('link', { name: 'WELCOME-ABC234' })).closest('tr')
    expect(lastQuery(fetchMock, '/api/admin/coupons').get('source')).toBe('welcome')
    expect(tabs.getByRole('tab', { name: 'Welcome codes' })).toHaveAttribute('aria-selected', 'true')
    expect(within(row).getByText('Sent to nadia@example.com')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'View WELCOME-ABC234' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Disable WELCOME-ABC234' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Delete WELCOME-ABC234' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Kind')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Search welcome codes')).toBeInTheDocument()

    // Arrow keys move between the tabs (and choose).
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(lastQuery(fetchMock, '/api/admin/coupons').get('source')).toBe('staff'))
  })

  it('a welcome code is read-only, except switching it off', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/coupons/9': { body: { ...WELCOME_CODE, live: true } },
      'PATCH /api/admin/coupons/9': (url, init) => ({ body: { coupon: { ...WELCOME_CODE, ...JSON.parse(init.body), status: 'inactive' }, live: true } }),
    })
    const user = userEvent.setup()
    renderApp('/coupons/9')
    expect(await screen.findByRole('heading', { name: 'WELCOME-ABC234', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Welcome code for nadia@example.com')).toBeInTheDocument()
    expect(screen.getByText('Sent to', { selector: 'dt' }).nextElementSibling).toHaveTextContent('nadia@example.com')
    expect(screen.getByText('First order only', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Yes')
    // No field to change its terms.
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Active (the customer can use it until it expires)' }))
    await user.click(save)
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/coupons/9')).toEqual({ isActive: false })
  })

  it('a staff coupon can be for a first order only', async () => {
    withSession()
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/coupons/3': { body: { ...STAFF, firstOrderOnly: false, live: true } },
      'PATCH /api/admin/coupons/3': (url, init) => ({ body: { coupon: { ...STAFF, ...JSON.parse(init.body) }, live: true } }),
    })
    const user = userEvent.setup()
    renderApp('/coupons/3')
    const box = await screen.findByRole('checkbox', { name: 'First order only' })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription(/already placed an order/)
    // The labels the browser suites use stay unique.
    expect(screen.getByLabelText('Code')).toHaveValue('WINTER5')
    await user.click(box)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
    expect(sentTo(fetchMock, 'PATCH', '/api/admin/coupons/3')).toMatchObject({ code: 'WINTER5', firstOrderOnly: true })
  })
})
