import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import ProtectedRoute from './ProtectedRoute'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'

function LoginProbe() {
  const location = useLocation()
  return <p>Login page (from {location.state?.from?.pathname})</p>
}

const renderProtected = () =>
  renderWithProviders(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/account" element={<p>Secret account page</p>} />
      </Route>
      <Route path="/login" element={<LoginProbe />} />
    </Routes>,
    { route: '/account' },
  )

const storeSession = () =>
  window.sessionStorage.setItem(
    'buynest.session.v1',
    JSON.stringify({ user: { id: 1, firstName: 'Emily' }, tokens: { accessToken: 'a', refreshToken: 'r' }, remember: false }),
  )

describe('ProtectedRoute', () => {
  it('redirects anonymous visitors to /login and remembers where they were going', () => {
    renderProtected()
    expect(screen.getByText('Login page (from /account)')).toBeInTheDocument()
    expect(screen.queryByText('Secret account page')).not.toBeInTheDocument()
  })

  it('shows a loader while a stored session is checked, then the page', async () => {
    storeSession()
    mockFetch({ 'GET /auth/me': { body: { id: 1, username: 'emilys', firstName: 'Emily' }, delay: 30 } })
    renderProtected()
    expect(screen.getByText('Checking your session…')).toBeInTheDocument()
    expect(await screen.findByText('Secret account page')).toBeInTheDocument()
  })

  it('signs out and redirects when the stored session is invalid', async () => {
    storeSession()
    mockFetch({
      'GET /auth/me': { status: 401, body: { message: 'Invalid/Expired Token!' } },
      'POST /auth/refresh': { status: 401, body: { message: 'Invalid refresh token' } },
    })
    renderProtected()
    expect(await screen.findByText(/Login page/)).toBeInTheDocument()
    expect(window.sessionStorage.getItem('buynest.session.v1')).toBeNull()
  })

  // A server outage says nothing about whether the tokens are still valid.
  it('keeps the session when the session check hits a server error', async () => {
    storeSession()
    mockFetch({ 'GET /auth/me': { status: 503, body: { message: 'Service unavailable' } } })
    renderProtected()
    expect(await screen.findByText('Secret account page')).toBeInTheDocument()
    expect(window.sessionStorage.getItem('buynest.session.v1')).not.toBeNull()
  })

  it('saves only identity fields of the profile, not phone or address', async () => {
    storeSession()
    mockFetch({
      'GET /auth/me': {
        body: { id: 1, username: 'emilys', firstName: 'Emily', phone: '+1 555 0100', address: { address: '1 Main St', city: 'X' } },
      },
    })
    renderProtected()
    await screen.findByText('Secret account page')
    const stored = JSON.parse(window.sessionStorage.getItem('buynest.session.v1'))
    expect(stored.user).toMatchObject({ id: 1, username: 'emilys', firstName: 'Emily' })
    expect(stored.user).not.toHaveProperty('phone')
    expect(stored.user).not.toHaveProperty('address')
  })
})
