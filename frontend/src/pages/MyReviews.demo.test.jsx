import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import AccountLayout from '../layouts/AccountLayout'
import { renderWithProviders } from '../test/renderWithProviders'

// Phase 23: My reviews needs BuyNest's API; the DummyJSON demo's account menu has no link to it.
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, firstName: 'Emily' }, logout: () => {} }) }))

describe('My reviews in the demo', () => {
  it('the account menu has no "My reviews" link', () => {
    renderWithProviders(
      <Routes>
        <Route path="/account" element={<AccountLayout />} />
      </Routes>,
      { route: '/account' },
    )
    const menu = screen.getByRole('navigation', { name: 'Account' })
    expect(menu).toHaveTextContent('Orders')
    expect(screen.queryByRole('link', { name: 'My reviews' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Stock alerts' })).not.toBeInTheDocument()
  })
})
