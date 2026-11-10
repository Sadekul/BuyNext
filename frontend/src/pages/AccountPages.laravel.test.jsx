import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import RegisterPage from './RegisterPage'
import VerifyEmailPage from './VerifyEmailPage'
import LoginPage from './LoginPage'
import ForgotPasswordPage from './ForgotPasswordPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'

// These screens with BuyNest accounts (VITE_ACCOUNTS_BACKEND=laravel).
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const NADIA = { id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', emailVerified: true, role: 'customer' }
const routes = (
  <>
    <Route path="/verify-email" element={<VerifyEmailPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/account" element={<p>Account home</p>} />
  </>
)
const sent = (fetchMock, path) => {
  const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}

async function fillSignUp(user, overrides = {}) {
  const values = { 'First name': 'Nadia', 'Last name': 'Rahman', Email: 'nadia@example.com', 'Phone number': '+880 1712-345678', Password: 'Secret123', 'Confirm password': 'Secret123', ...overrides }
  for (const [label, value] of Object.entries(values)) if (value) await user.type(screen.getByLabelText(label), value)
  await user.click(screen.getByLabelText(/I agree to the terms/))
}

describe('sign-up with an emailed code', () => {
  it('asks for name, email, phone, and password (no username)', () => {
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' })
    for (const label of ['First name', 'Last name', 'Email', 'Phone number', 'Password', 'Confirm password']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Phone number')).toHaveAttribute('type', 'tel')
  })

  it('checks the phone number before sending anything', async () => {
    const fetchMock = mockFetch({})
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' })
    await fillSignUp(user, { 'Phone number': '12345' })
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByLabelText('Phone number')).toHaveAccessibleDescription(/Include the country code/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates the account, then asks for the code that was emailed', async () => {
    const fetchMock = mockFetch({ 'POST /api/auth/register': { status: 201, body: { email: 'nadia@example.com', expiresIn: 600, resendIn: 60 } } })
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register', extraRoutes: routes })
    await fillSignUp(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByText('nadia@example.com')).toBeInTheDocument()
    expect(sent(fetchMock, '/api/auth/register')).toEqual({
      firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', password: 'Secret123', confirmPassword: 'Secret123', acceptTerms: true,
    })
    // The server allows one code a minute: the resend button counts down.
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled()
  })

  it("shows the server's message on the field (email already registered)", async () => {
    mockFetch({ 'POST /api/auth/register': { status: 422, body: { message: 'Invalid', errors: { email: ['An account with this email already exists. Sign in, or reset your password.'] } } } })
    const user = userEvent.setup()
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' })
    await fillSignUp(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')

    // Editing the email clears the server's message about the old value.
    await user.type(screen.getByLabelText('Email'), 'x')
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument()
  })
})

describe('confirming the email', () => {
  const verifyRoute = { pathname: '/verify-email', state: { email: 'nadia@example.com', resendIn: 0 } }

  it('keeps only digits, shows a wrong code on the field, and signs in with the right one', async () => {
    let attempts = 0
    const fetchMock = mockFetch({
      'POST /api/auth/verify-email': () =>
        ++attempts === 1 ? { status: 422, body: { message: 'Invalid', errors: { code: ['That code is incorrect or has expired.'] } } } : { body: NADIA },
    })
    const user = userEvent.setup()
    renderWithProviders(<VerifyEmailPage />, { route: verifyRoute, path: '/verify-email', extraRoutes: routes })

    const code = screen.getByLabelText('6-digit code')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    await user.type(code, '12 34-56')
    expect(code).toHaveValue('123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and sign in' }))
    expect(await screen.findByText('That code is incorrect or has expired.')).toBeInTheDocument()

    await user.clear(code)
    await user.type(code, '654321')
    await user.click(screen.getByRole('button', { name: 'Confirm and sign in' }))
    expect(await screen.findByText('Account home')).toBeInTheDocument()
    expect(sent(fetchMock, '/api/auth/verify-email')).toEqual({ email: 'nadia@example.com', code: '123456', remember: true })
  })

  it('sends a new code when asked', async () => {
    const fetchMock = mockFetch({ 'POST /api/auth/resend-code': { body: { email: 'nadia@example.com', resendIn: 60 } } })
    const user = userEvent.setup()
    renderWithProviders(<VerifyEmailPage />, { route: verifyRoute, path: '/verify-email' })
    await user.click(screen.getByRole('button', { name: 'Send a new code' }))
    expect(await screen.findByText(/We sent a new code to nadia@example.com/)).toBeInTheDocument()
    expect(sent(fetchMock, '/api/auth/resend-code')).toEqual({ email: 'nadia@example.com', purpose: 'verify_email' })
    expect(screen.getByRole('button', { name: /Send a new code in/ })).toBeDisabled()
  })

  it('without an email to confirm, points to sign-up and sign-in', () => {
    renderWithProviders(<VerifyEmailPage />, { route: '/verify-email', path: '/verify-email' })
    expect(screen.getByRole('link', { name: 'creating an account' })).toBeInTheDocument()
    expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument()
  })
})

describe('signing in with a BuyNest account', () => {
  it('signs in with an email', async () => {
    const fetchMock = mockFetch({ 'POST /api/auth/login': { body: NADIA } })
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login', extraRoutes: routes })
    await user.type(screen.getByLabelText('Email'), 'nadia@example.com')
    await user.type(screen.getByLabelText('Password'), 'Secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Account home')).toBeInTheDocument()
    expect(sent(fetchMock, '/api/auth/login')).toMatchObject({ email: 'nadia@example.com', password: 'Secret123', remember: true })
  })

  it('an unconfirmed email continues on the code page', async () => {
    mockFetch({
      'POST /api/auth/login': { status: 403, body: { message: 'Confirm first', code: 'email_unverified', data: { email: 'nadia@example.com', resendIn: 60 } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login', extraRoutes: routes })
    await user.type(screen.getByLabelText('Email'), 'nadia@example.com')
    await user.type(screen.getByLabelText('Password'), 'Secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
  })
})

describe('forgot password', () => {
  it('emails a code, then sets the new password and returns to sign-in', async () => {
    const fetchMock = mockFetch({
      'POST /api/auth/forgot-password': { body: { email: 'nadia@example.com', resendIn: 60 } },
      'POST /api/auth/reset-password': { body: { message: 'Changed' } },
    })
    const user = userEvent.setup()
    renderWithProviders(<ForgotPasswordPage />, { route: '/forgot-password', path: '/forgot-password', extraRoutes: routes })

    await user.type(screen.getByLabelText('Email'), 'nadia@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
    // Same wording whether or not the account exists.
    expect(screen.getByText(/If an account exists for/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(screen.getByLabelText('6-digit code')).toHaveFocus()

    await user.type(screen.getByLabelText('6-digit code'), '123456')
    await user.type(screen.getByLabelText('New password'), 'BrandNew99')
    await user.type(screen.getByLabelText('Confirm new password'), 'BrandNew99')
    await user.click(screen.getByRole('button', { name: 'Save new password' }))

    const notice = await screen.findByRole('status')
    expect(within(notice).getByText(/Your password has been changed/)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument() // the sign-in form
    expect(sent(fetchMock, '/api/auth/reset-password')).toEqual({ email: 'nadia@example.com', code: '123456', password: 'BrandNew99', confirmPassword: 'BrandNew99' })
  })
})
