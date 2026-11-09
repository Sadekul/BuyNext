import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import LoginPage from './LoginPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'

const renderLogin = () =>
  renderWithProviders(<LoginPage />, { route: '/login', path: '/login', extraRoutes: <Route path="/account" element={<p>Account home</p>} /> })

describe('LoginPage (form validation)', () => {
  it('shows no errors until the first submit, then focuses the first invalid field', async () => {
    const user = userEvent.setup()
    renderLogin()
    expect(screen.queryByText('Enter your username.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const username = screen.getByLabelText('Username')
    expect(screen.getByText('Enter your username.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(username).toHaveFocus()
    expect(username).toHaveAttribute('aria-invalid', 'true')
    // Accessibility: the error is linked to the field
    expect(username).toHaveAccessibleDescription('Enter your username.')
  })

  it('clears an error as soon as the field becomes valid', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Username'), 'emilys')
    expect(screen.queryByText('Enter your username.')).not.toBeInTheDocument()
  })

  it('shows the server message for wrong credentials', async () => {
    mockFetch({ 'POST /api/auth/login': { status: 400, body: { message: 'Invalid credentials' } } })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByLabelText('Username'), 'emilys')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials')
  })

  it('signs in and redirects to the account page', async () => {
    const fetchMock = mockFetch({ 'POST /api/auth/login': { body: { id: 1, username: 'emilys', firstName: 'Emily' } } })
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole('button', { name: 'Use demo account' }))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Account home')).toBeInTheDocument()

    // Sign-in goes to BuyNest's own service, which keeps the session in HttpOnly cookies.
    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).origin).toBe(window.location.origin)
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body)).toMatchObject({ username: 'emilys', remember: true })
  })
})
