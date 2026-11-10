import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

const OVERVIEW = {
  products: { total: 194, outOfStock: 2, lowStock: 5, inventoryValue: 12345.5 },
  orders: { total: 50, revenue: 98765.43, unitsSold: 400 },
  customers: { total: 208 },
  lowStockProducts: [{ id: 7, title: 'Desk Lamp', category: 'home-decoration', stock: 3, thumbnail: '' }],
  latestOrders: [{ id: 50, customer: 'Mike Ross', items: 4, total: 120 }],
  lowStockThreshold: 10,
}

describe('who can open the admin dashboard', () => {
  it('sends visitors without a session to sign-in, without calling the API', async () => {
    const fetchMock = mockFetch({})
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'BuyNest Admin' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores the storefront (customer) session: the admin has its own', async () => {
    document.cookie = 'buynest_session=session; Path=/'
    const fetchMock = mockFetch({})
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'BuyNest Admin' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    document.cookie = 'buynest_session=; Max-Age=0; Path=/'
  })

  it('shows "No admin access" when the server refuses the admin session (403)', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { status: 403, body: { message: 'This account has been disabled.' } } })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'No admin access' })).toBeInTheDocument()
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument()
  })

  it('opens the overview for an admin', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/overview': { body: OVERVIEW } })
    renderApp('/')
    expect(await screen.findByText('$98.8K')).toBeInTheDocument() // revenue, compact
    expect(screen.getByText('Desk Lamp')).toBeInTheDocument()
    expect(screen.getByText('Low stock', { selector: '.status' })).toBeInTheDocument() // icon + label, not color alone
  })

  it('renews an expired session once, then continues', async () => {
    withSession()
    let meCalls = 0
    const fetchMock = mockFetch({
      'GET /api/admin/me': () => (++meCalls === 1 ? { status: 401 } : { body: ADMIN }),
      'POST /api/admin/auth/refresh': { body: { ok: true } },
      'GET /api/admin/overview': { body: OVERVIEW },
    })
    renderApp('/')
    expect(await screen.findByText('$98.8K')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/admin/auth/refresh'))).toHaveLength(1)
  })

  it('signs an admin in at the admin service, then opens the overview', async () => {
    const fetchMock = mockFetch({ 'POST /api/admin/auth/login': { body: ADMIN }, 'GET /api/admin/overview': { body: OVERVIEW } })
    const user = userEvent.setup()
    renderApp('/login')
    await user.type(await screen.findByLabelText('Username'), 'emilys')
    await user.type(screen.getByLabelText('Password'), 'emilyspass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('$98.8K')).toBeInTheDocument()
    expect(screen.getByText('Emily Johnson')).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/admin/auth/login'))
    expect(JSON.parse(init.body)).toEqual({ username: 'emilys', password: 'emilyspass', remember: false })
  })

  it("shows the server's refusal when a customer account tries the admin sign-in", async () => {
    mockFetch({ 'POST /api/admin/auth/login': { status: 403, body: { message: 'This account is not a shop admin. Sign in with an admin account.' } } })
    const user = userEvent.setup()
    renderApp('/login')
    await user.type(await screen.findByLabelText('Username'), 'averyp')
    await user.type(screen.getByLabelText('Password'), 'averyppass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not a shop admin')
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument()
  })
})
