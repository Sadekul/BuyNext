import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'
import { groupKey, qrImageSource, recoveryCodesText, sixDigits } from '../utils/twoFactor'
import { formatBytes } from '../utils/format'

/*
 * Phase 9 (docs/backend/PHASE9_CONTRACT.md): two-step sign-in (second step,
 * forced setup, the account page, the Owner's controls), backups, stock
 * alerts, resized photos. BuyNest's backend and accounts.
 */
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))
vi.mock('../auth/accounts', () => ({
  REAL_ACCOUNTS: true,
  ID_FIELD: { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  DEMO_ADMIN: null,
}))

const ALL = ['dashboard.view', 'admins.manage', 'settings.view', 'settings.edit', 'backups.view', 'reports.view', 'products.view', 'products.edit']
const OWNER = { ...ADMIN, id: 1, name: 'Store Owner', email: 'owner@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ALL, twoFactorEnabled: true, twoFactorRequiredByStore: false, twoFactorSetupRequired: false, recoveryCodesLeft: 8 }
const MANAGER = { ...OWNER, id: 2, name: 'Mia Manager', role: { id: 3, name: 'Store manager' }, permissions: ALL.filter((key) => key !== 'backups.view'), twoFactorEnabled: false }
const OVERVIEW = { products: { total: 0, outOfStock: 0, lowStock: 0, inventoryValue: 0 }, orders: { total: 0, revenue: 0, unitsSold: 0 }, customers: { total: 0 }, lowStockProducts: [], latestOrders: [], lowStockThreshold: 10, live: true }
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
const CODES = ['abcde-12345', 'fghij-67890', 'klmno-11111', 'pqrst-22222', 'uvwxy-33333', 'zabcd-44444', 'efghi-55555', 'jklmn-66666', 'opqrs-77777', 'tuvwx-88888']

const bodyOf = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.findLast(([url, init]) => (init?.method ?? 'GET') === method && new URL(url).pathname === path)
  return call && JSON.parse(call[1].body ?? 'null')
}
const nav = () => within(screen.getByRole('navigation', { name: 'Admin' }))

afterEach(() => {
  document.cookie = 'buynest_admin_session=; Max-Age=0; Path=/'
})

describe('two-step helpers', () => {
  it('groups the key, takes 6 digits with spaces, makes an image source and the .txt', () => {
    expect(groupKey('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    expect(sixDigits(' 123 456 ')).toBe('123456')
    expect(sixDigits('12345')).toBeNull()
    expect(sixDigits('12345a')).toBeNull()
    expect(qrImageSource('<svg/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
    const text = recoveryCodesText(['a', 'b'], { email: 'o@x.test', createdAt: new Date('2026-11-17T10:05:00Z') })
    expect(text).toContain('Account: o@x.test')
    expect(text).toContain('Created: 2026-11-17 10:05 UTC')
    expect(text.trim().split('\n').slice(-2)).toEqual(['a', 'b'])
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(3_400_000)).toBe('3.2 MB')
  })
})

describe('sign-in with two-step', () => {
  async function password(user) {
    await user.type(await screen.findByLabelText('Email'), 'owner@buynest.test')
    await user.type(screen.getByLabelText('Password'), 'OwnerPass2026')
    await user.click(screen.getByLabelText(/Keep me signed in/))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('asks for the code after the password, then signs in (the challenge is sent, never a token)', async () => {
    let signedIn = false
    const fetchMock = mockFetch({
      'POST /api/admin/auth/login': { body: { twoFactorRequired: true, challenge: 'c'.repeat(64), expiresAt: '2999-01-01T00:00:00Z' } },
      'POST /api/admin/auth/two-factor': () => {
        signedIn = true
        withSession()
        return { body: OWNER }
      },
      'GET /api/admin/me': () => (signedIn ? { body: OWNER } : { status: 401, body: {} }),
      'GET /api/admin/overview': { body: OVERVIEW },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
      'GET /api/admin/preferences/dashboard': { body: { value: null } },
    })
    const user = userEvent.setup()
    renderApp('/login')
    await password(user)

    const code = await screen.findByLabelText('Authentication code')
    expect(screen.getByRole('heading', { name: 'Two-step sign-in' })).toBeInTheDocument()
    expect(screen.getByText('Enter the 6-digit code from your authenticator app.')).toBeInTheDocument()
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    expect(code).toHaveAttribute('inputmode', 'numeric')
    expect(code).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the 6-digit code from your authenticator app.')

    await user.type(code, '123 456')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() => expect(bodyOf(fetchMock, 'POST', '/api/admin/auth/two-factor')).toEqual({ challenge: 'c'.repeat(64), remember: true, code: '123456' }))
    expect(await screen.findByRole('heading', { name: 'Overview' }, { timeout: 3000 })).toBeInTheDocument()
  })

  it('takes a recovery code instead, and an expired challenge sends the admin back to the password', async () => {
    const fetchMock = mockFetch({
      'POST /api/admin/auth/login': { body: { twoFactorRequired: true, challenge: 'd'.repeat(64), expiresAt: '2999-01-01T00:00:00Z' } },
      'POST /api/admin/auth/two-factor': (url, init) =>
        JSON.parse(init.body).recoveryCode === 'wrong-codes1'
          ? { status: 422, body: { message: 'x', errors: { recoveryCode: ["That recovery code isn't right or was already used."] } } }
          : { status: 422, body: { message: 'Too many wrong codes. Please sign in again.', errors: { challenge: ['Too many wrong codes. Please sign in again.'] } } },
    })
    const user = userEvent.setup()
    renderApp('/login')
    await password(user)
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code' }))
    const field = screen.getByLabelText('Recovery code')
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('autocomplete', 'off')

    await user.type(field, 'wrong-codes1')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    expect(await screen.findByText("That recovery code isn't right or was already used.")).toBeInTheDocument()
    expect(bodyOf(fetchMock, 'POST', '/api/admin/auth/two-factor')).toEqual({ challenge: 'd'.repeat(64), remember: true, recoveryCode: 'wrong-codes1' })

    await user.type(screen.getByLabelText('Recovery code'), 'abcde-12345')
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    // Back to the password, with the reason, and focus on the first field.
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Too many wrong codes. Please sign in again.')
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus())
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })
})

describe('forced two-step setup', () => {
  // A long flow (setup, confirm, recovery codes): more time when the whole suite runs in parallel.
  it('blocks the admin until two-step is on, then shows the recovery codes once and continues', { timeout: 20_000 }, async () => {
    withSession()
    let enabled = false
    const writeText = vi.fn(async () => {})
    const fetchMock = mockFetch({
      'GET /api/admin/me': () => ({ body: enabled ? OWNER : { ...MANAGER, twoFactorRequiredByStore: true, twoFactorSetupRequired: true } }),
      'POST /api/admin/me/two-factor': { body: { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x', qrSvg: SVG } },
      'POST /api/admin/me/two-factor/confirm': (url, init) => {
        if (JSON.parse(init.body).code !== '654321') return { status: 422, body: { message: 'x', errors: { code: ["That code isn't right. Check your authenticator app and try again."] } } }
        enabled = true
        return { body: { recoveryCodes: CODES } }
      },
      'GET /api/admin/overview': { body: OVERVIEW },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
      'GET /api/admin/preferences/dashboard': { body: { value: null } },
    })
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const createObjectURL = vi.fn(() => 'blob:codes')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Set up two-step sign-in' })).toHaveFocus()
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Set up two-step sign-in' }))
    const qr = await screen.findByRole('img', { name: /QR code to add BuyNest Admin/ })
    expect(qr.getAttribute('src')).toBe(qrImageSource(SVG))
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy key' }))
    expect(writeText).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP')

    const code = screen.getByLabelText('6-digit code')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    expect(code).toHaveAttribute('inputmode', 'numeric')
    await user.type(code, '111111')
    await user.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }))
    expect(await screen.findByText("That code isn't right. Check your authenticator app and try again.")).toBeInTheDocument()
    expect(code).toHaveFocus()

    await user.type(code, '654321')
    await user.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }))
    expect(await screen.findByRole('heading', { name: 'Save your recovery codes' })).toHaveFocus()
    expect(screen.getByText(/These codes are shown only once/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Recovery codes' })).getAllByRole('listitem')).toHaveLength(10)

    await user.click(screen.getByRole('button', { name: 'Copy codes' }))
    expect(writeText).toHaveBeenLastCalledWith(CODES.join('\n'))
    await user.click(screen.getByRole('button', { name: 'Download as .txt' }))
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(screen.getByText('Saved as buynest-admin-recovery-codes.txt.')).toHaveAttribute('role', 'status')

    const next = screen.getByRole('button', { name: 'Continue' })
    expect(next).toBeDisabled()
    await user.click(screen.getByLabelText('I saved my recovery codes'))
    await user.click(next)
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(bodyOf(fetchMock, 'POST', '/api/admin/me/two-factor/confirm')).toEqual({ code: '654321' })
  })
})

describe('forced two-step setup: the account fails to load right after', () => {
  it('keeps the admin signed in and offers "Try again" instead of signing out', { timeout: 20_000 }, async () => {
    withSession()
    let enabled = false
    let failures = 0
    mockFetch({
      'GET /api/admin/me': () => {
        if (!enabled) return { body: { ...MANAGER, twoFactorRequiredByStore: true, twoFactorSetupRequired: true } }
        // The first three loads after setup fail (a network blip), then it works.
        if (failures < 3) {
          failures++
          return { status: 503, body: { message: 'Service unavailable' } }
        }
        return { body: OWNER }
      },
      'POST /api/admin/me/two-factor': { body: { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x', qrSvg: SVG } },
      'POST /api/admin/me/two-factor/confirm': () => {
        enabled = true
        return { body: { recoveryCodes: CODES } }
      },
      'GET /api/admin/overview': { body: OVERVIEW },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
      'GET /api/admin/preferences/dashboard': { body: { value: null } },
    })
    const user = userEvent.setup()
    renderApp('/')
    await user.click(await screen.findByRole('button', { name: 'Set up two-step sign-in' }))
    await user.type(await screen.findByLabelText('6-digit code'), '654321')
    await user.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }))
    await user.click(await screen.findByLabelText('I saved my recovery codes'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(/your account didn't load/, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
  })
})

describe('Account → Two-step sign-in', () => {
  it('is linked for every admin; with two-step on it makes new recovery codes and turns it off', async () => {
    withSession()
    let enabled = true
    const fetchMock = mockFetch({
      'GET /api/admin/me': () => ({ body: { ...MANAGER, twoFactorEnabled: enabled, recoveryCodesLeft: 2 } }),
      'POST /api/admin/me/two-factor/recovery-codes': { body: { recoveryCodes: CODES } },
      'DELETE /api/admin/me/two-factor': () => {
        enabled = false
        return { body: { ok: true, message: 'Two-step sign-in is off.' } }
      },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
    })
    const user = userEvent.setup()
    renderApp('/account/two-factor')
    expect(await screen.findByRole('heading', { name: 'Two-step sign-in', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Two-step sign-in' })).toHaveAttribute('href', '/account/two-factor')
    expect(screen.getByText('On')).toBeInTheDocument()
    expect(screen.getByText(/2 recovery codes left\. Get a new set below\./)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Get new recovery codes' }))
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    await user.type(screen.getAllByLabelText('Your password')[0], 'Secret12345678')
    await user.click(screen.getByRole('button', { name: 'Get new recovery codes' }))
    expect(await screen.findByRole('heading', { name: 'Save your recovery codes' })).toBeInTheDocument()
    expect(bodyOf(fetchMock, 'POST', '/api/admin/me/two-factor/recovery-codes')).toEqual({ password: 'Secret12345678' })
    await user.click(screen.getByLabelText('I saved my recovery codes'))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Your new recovery codes are saved. The old ones no longer work.')).toBeInTheDocument()

    const off = screen.getByRole('form', { name: 'Turn off' })
    await user.type(within(off).getByLabelText('Your password'), 'Secret12345678')
    await user.type(within(off).getByLabelText('6-digit code from your app'), '123456')
    await user.click(within(off).getByRole('button', { name: 'Turn off two-step sign-in' }))
    expect(await screen.findByText('Two-step sign-in is off. You sign in with your password only.')).toBeInTheDocument()
    expect(bodyOf(fetchMock, 'DELETE', '/api/admin/me/two-factor')).toEqual({ password: 'Secret12345678', code: '123456' })
    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up two-step sign-in' })).toBeInTheDocument()
  })

  it("can't be turned off while the store requires it", async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: { ...MANAGER, twoFactorEnabled: true, twoFactorRequiredByStore: true } }, 'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } } })
    renderApp('/account/two-factor')
    expect(await screen.findByText(/can't be turned off while the store requires it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off two-step sign-in' })).not.toBeInTheDocument()
  })
})

describe("the Owner's two-step controls", () => {
  const ADMINS = {
    admins: [
      { id: 1, name: 'Store Owner', email: 'owner@buynest.test', role: { id: 1, name: 'Owner' }, roleId: 1, isActive: true, twoFactorEnabled: true },
      { id: 2, name: 'Sam Sales', email: 'sam@buynest.test', role: { id: 2, name: 'Sales staff' }, roleId: 2, isActive: true, twoFactorEnabled: true },
      { id: 3, name: 'Pat Packer', email: 'pat@buynest.test', role: { id: 2, name: 'Sales staff' }, roleId: 2, isActive: true, twoFactorEnabled: false },
    ],
    total: 3,
  }
  const routes = {
    'GET /api/admin/admins': { body: ADMINS },
    'GET /api/admin/roles': { body: { roles: [] } },
    'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
  }

  it('the Owner resets another admin’s two-step after confirming', async () => {
    withSession()
    const fetchMock = mockFetch({ 'GET /api/admin/me': { body: OWNER }, ...routes, 'POST /api/admin/admins/2/two-factor/reset': { body: { ok: true, message: 'Two-step sign-in was reset.' } } })
    const user = userEvent.setup()
    renderApp('/admins')
    const table = within(await screen.findByRole('table', { name: 'Admin users' }))
    expect(table.getByRole('columnheader', { name: 'Two-step' })).toBeInTheDocument()
    // Not for yourself, nor for someone without two-step.
    expect(table.queryByRole('button', { name: 'Reset two-step sign-in for Store Owner' })).not.toBeInTheDocument()
    expect(table.queryByRole('button', { name: 'Reset two-step sign-in for Pat Packer' })).not.toBeInTheDocument()
    await user.click(table.getByRole('button', { name: 'Reset two-step sign-in for Sam Sales' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset two-step sign-in for Sam Sales?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reset two-step' }))
    expect(await screen.findByText(/Two-step sign-in was turned off for Sam Sales, and they were signed out everywhere/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'POST' && new URL(url).pathname === '/api/admin/admins/2/two-factor/reset')).toBe(true)
  })

  it('others see no reset, no Security settings, and no Backups', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: MANAGER },
      ...routes,
      'GET /api/admin/settings': { body: { general: { storeName: 'BuyNest' }, shipping: {}, tax: {}, checkout: {}, inventory: {}, catalog: {}, security: { requireAdminTwoFactor: false }, live: true } },
    })
    renderApp('/admins')
    const table = within(await screen.findByRole('table', { name: 'Admin users' }))
    expect(table.queryByRole('button', { name: /Reset two-step/ })).not.toBeInTheDocument()
    expect(nav().queryByRole('link', { name: 'Backups' })).not.toBeInTheDocument()
  })

  it('the Owner turns on "require two-step" under Settings → Security', async () => {
    withSession()
    const settings = { general: { storeName: 'BuyNest', supportEmail: '', supportPhone: '', address: '' }, shipping: { enabledMethods: ['standard'] }, tax: { taxRates: [] }, checkout: { allowedCountries: ['Germany'], enabledPaymentMethods: ['card'] }, inventory: { lowStockThreshold: 10 }, catalog: {}, security: { requireAdminTwoFactor: false }, live: true }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/settings': { body: settings },
      'PATCH /api/admin/settings': { body: { ...settings, security: { requireAdminTwoFactor: true } } },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    const security = within(await screen.findByRole('form', { name: 'Security' }))
    await user.click(security.getByLabelText('Require two-step sign-in for every admin'))
    await user.click(security.getByRole('button', { name: 'Save security' }))
    expect(await security.findByText('Security saved.')).toBeInTheDocument()
    expect(bodyOf(fetchMock, 'PATCH', '/api/admin/settings')).toEqual({ security: { requireAdminTwoFactor: true } })
  })

  it('a manager with settings.edit does not see Security', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: MANAGER },
      'GET /api/admin/settings': { body: { general: { storeName: 'BuyNest' }, shipping: { enabledMethods: ['standard'] }, tax: { taxRates: [] }, checkout: { allowedCountries: ['Germany'], enabledPaymentMethods: ['card'] }, inventory: {}, catalog: {}, security: { requireAdminTwoFactor: false }, live: true } },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
    })
    renderApp('/settings')
    expect(await screen.findByRole('form', { name: 'General' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Security' })).not.toBeInTheDocument()
  })
})

describe('System → Backups', () => {
  it('lists backups, backs up now, and downloads through a short-lived link', async () => {
    withSession()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function remember() {
      click.lastHref = this.getAttribute('href')
    })
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/backups': { body: { backups: [{ name: 'buynest-20261117-030000.sql.gz', size: 3_400_000, createdAt: '2026-11-17T03:00:00Z' }], keepDays: 14, live: true } },
      'POST /api/admin/backups': { status: 201, body: { backup: { status: 'ok', name: 'buynest-20261117-101500.sql.gz' }, message: 'Backup buynest-20261117-101500.sql.gz is ready.' } },
      'POST /api/admin/backups/buynest-20261117-030000.sql.gz/download': { body: { url: '/api/admin/backups/buynest-20261117-030000.sql.gz/file?expires=1&signature=abc', expiresAt: '2026-11-17T10:20:00Z' } },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
    })
    const user = userEvent.setup()
    renderApp('/backups')
    expect(await screen.findByText(/kept for 14 days/)).toBeInTheDocument()
    expect(nav().getByRole('link', { name: 'Backups' })).toHaveAttribute('aria-current', 'page')
    const row = screen.getByRole('row', { name: /buynest-20261117-030000\.sql\.gz/ })
    expect(row).toHaveTextContent('3.2 MB')

    await user.click(within(row).getByRole('button', { name: 'Download buynest-20261117-030000.sql.gz' }))
    const notice = await screen.findByText('Downloading buynest-20261117-030000.sql.gz. The link works for 5 minutes.')
    await waitFor(() => expect(notice).toHaveFocus())
    expect(click.lastHref).toBe('/api/admin/backups/buynest-20261117-030000.sql.gz/file?expires=1&signature=abc')

    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    expect(await screen.findByText('Backup buynest-20261117-101500.sql.gz is ready.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === 'GET' && new URL(url).pathname === '/api/admin/backups').length).toBeGreaterThan(1)
  })

  it('shows why a backup failed', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/backups': { body: { backups: [], live: true } },
      'POST /api/admin/backups': { status: 422, body: { message: 'x', errors: { backup: ['A backup is already running. Try again in a few minutes.'] } } },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
    })
    const user = userEvent.setup()
    renderApp('/backups')
    expect(await screen.findByText(/No backups yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back up now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A backup is already running. Try again in a few minutes.')
  })
})

describe('stock alerts and resized photos', () => {
  it('Reports lists products with waiting alerts', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/reports/sales': { body: { totals: { orders: 0, units: 0, gross: 0, discounts: 0, shipping: 0, refunds: 0, net: 0, averageOrder: 0 }, series: [] } },
      'GET /api/admin/reports/products': { body: { products: [] } },
      'GET /api/admin/reports/customers': { body: { newCustomers: 0, returningCustomers: 0, guestOrders: 0, topCustomers: [] } },
      'GET /api/admin/reports/coupons': { body: { coupons: [] } },
      'GET /api/admin/reports/low-stock': { body: { products: [] } },
      'GET /api/admin/reports/stock-alerts': {
        body: {
          products: [{ productId: 4, name: 'T-shirt', sku: 'TS', stock: 0, waiting: 3, variants: [{ id: 21, sku: 'TS-s', label: 'Size: S', stock: 0, waiting: 2 }], oldestAt: '2026-11-10T00:00:00Z' }],
          total: 1,
          waitingTotal: 3,
          notifiedLast30Days: 5,
        },
      },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
    })
    renderApp('/reports')
    const panel = within(await screen.findByRole('region', { name: 'Stock alerts' }))
    expect(await panel.findByText(/3 shoppers are waiting for a back-in-stock email on 1 product\. 5 emailed in the last 30 days\./)).toBeInTheDocument()
    const row = panel.getByRole('row', { name: /T-shirt/ })
    expect(within(row).getByRole('link', { name: 'T-shirt' })).toHaveAttribute('href', '/products/4')
    expect(row).toHaveTextContent('Size: S: 2 waiting, 0 in stock')
    expect(row).toHaveTextContent('Out of stock')
  })

  it('the product page shows its waiting count and uses the small photo copy', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: OWNER },
      'GET /api/admin/categories': { body: [{ slug: 'beauty', name: 'Beauty', id: 1, parentId: null, depth: 0 }] },
      'GET /api/admin/products/4': {
        body: {
          id: 4, title: 'T-shirt', category: 'beauty', brand: '', price: 20, discountPercentage: 0, stock: 0, status: 'active', description: '',
          imageList: [
            { id: 7, url: '/media/products/4/a.jpg', alt: 'Front', position: 0, isUpload: true, variants: { 320: '/media/products/4/a-320.webp', 960: '/media/products/4/a-960.webp' } },
            { id: 8, url: 'https://cdn.dummyjson.com/b.jpg', alt: 'Back', position: 1, isUpload: false, variants: {} },
          ],
          options: [], variants: [], hasVariants: false, stockAlertsWaiting: 3, live: true,
        },
      },
      'GET /api/admin/notifications': { body: { notifications: [], unread: 0 } },
    })
    renderApp('/products/4')
    expect(await screen.findByText('3 shoppers are waiting')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all stock alerts' })).toHaveAttribute('href', '/reports#stock-alerts')
    const images = within(screen.getByRole('region', { name: 'Images' }))
    expect(images.getByRole('img', { name: 'Front' })).toHaveAttribute('src', '/media/products/4/a-320.webp')
    expect(images.getByRole('img', { name: 'Back' })).toHaveAttribute('src', 'https://cdn.dummyjson.com/b.jpg')
    expect(images.getByText('Resized copies for faster pages: 320 px, 960 px.')).toBeInTheDocument()
    expect(images.getByText('External address: shown as it is.')).toBeInTheDocument()
  })
})
