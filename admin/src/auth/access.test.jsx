import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, CUSTOMER, mockFetch, withSession } from '../test/mockFetch'
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

  it('shows "No admin access" to a signed-in customer (the server answered 403)', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { status: 403, body: { message: 'No' } }, 'GET /api/auth/me': { body: CUSTOMER } })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'No admin access' })).toBeInTheDocument()
    expect(screen.getByText('Avery Perez')).toBeInTheDocument()
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
      'POST /api/auth/refresh': { body: { ok: true } },
      'GET /api/admin/overview': { body: OVERVIEW },
    })
    renderApp('/')
    expect(await screen.findByText('$98.8K')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/refresh'))).toHaveLength(1)
  })

  it('refuses a customer who signs in on the admin page, and signs them back out', async () => {
    const fetchMock = mockFetch({
      'POST /api/auth/login': { body: CUSTOMER },
      'GET /api/admin/me': { status: 403, body: { message: 'No' } },
      'POST /api/auth/logout': { body: { ok: true } },
    })
    const user = userEvent.setup()
    renderApp('/login')
    await user.type(await screen.findByLabelText('Username'), 'averyp')
    await user.type(screen.getByLabelText('Password'), 'averyppass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not a shop admin')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/auth/logout'))).toBe(true)
  })
})
