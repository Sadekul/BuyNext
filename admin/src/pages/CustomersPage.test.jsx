import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

const NADIA = { id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', emailVerified: true, isActive: true, createdAt: '2026-11-10T08:00:00Z', lastLoginAt: null }
const RAFI = { ...NADIA, id: 6, firstName: 'Rafi', email: 'rafi@example.com', emailVerified: false }

describe('customers (BuyNest accounts)', () => {
  it('lists real sign-ups with their status, as icon and words', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/customers': { body: { customers: [NADIA, RAFI], total: 2, manageable: true } } })
    renderApp('/customers')
    const nadiaRow = (await screen.findByRole('cell', { name: 'Nadia Rahman' })).closest('tr')
    expect(within(nadiaRow).getByText('Active')).toBeInTheDocument()
    expect(within(nadiaRow).getByText('Never')).toBeInTheDocument() // hasn't signed in yet
    expect(within(screen.getByRole('cell', { name: 'Rafi Rahman' }).closest('tr')).getByText('Email not confirmed')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
  })

  it('blocks a customer after confirming', async () => {
    withSession()
    let blocked = false
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/customers': () => ({ body: { customers: [{ ...NADIA, isActive: !blocked }], total: 1, manageable: true } }),
      'PATCH /api/admin/customers/5': (url, init) => {
        blocked = JSON.parse(init.body).isActive === false
        return { body: { ...NADIA, isActive: !blocked } }
      },
    })
    const user = userEvent.setup()
    renderApp('/customers')
    await user.click(await screen.findByRole('button', { name: 'Block Nadia Rahman' }))
    const dialog = screen.getByRole('dialog', { name: 'Block Nadia Rahman?' })
    await user.click(within(dialog).getByRole('button', { name: 'Block account' }))

    expect(await screen.findByText(/is blocked and has been signed out everywhere/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Unblock Nadia Rahman' })).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/admin/customers/5'))
    expect(JSON.parse(init.body)).toEqual({ isActive: false })
  })
})
