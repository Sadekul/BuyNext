import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import Newsletter from '../components/forms/Newsletter'
import NewsletterPage from './NewsletterPage'
import NotFoundPage from './NotFoundPage'
import ProfilePage from './ProfilePage'
import CartSummary from '../components/cart/CartSummary'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { STORAGE_KEYS } from '../constants/storageKeys'

/*
 * Phase 7 storefront screens with BuyNest's API: the newsletter form, the
 * confirm and unsubscribe links, the account's newsletter switch, URL
 * redirects from "not found", and cart rule rows in the summary.
 */
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))
// The redirect lookups exist with BuyNest's catalog only (unit tests run on the DummyJSON provider).
vi.mock('../services/seoService', async (importOriginal) => ({ ...(await importOriginal()), HAS_SEO: true }))

const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
}
const NADIA = { id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: null, emailVerified: true, role: 'customer' }
const EMPTY_SAVED_CART = { body: { items: [], itemCount: 0, updatedAt: null } }
const sentBody = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url]) => new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}

describe('newsletter form (REAL_SHOP)', () => {
  it('sends the address to the shop service and shows its answer', async () => {
    const message = "Thanks! If this address isn't subscribed yet, we've sent you a link to confirm."
    const fetchMock = mockFetch({ 'POST /api/shop/newsletter': { status: 202, body: { message } } })
    const user = userEvent.setup()
    renderWithProviders(<Newsletter />)
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'ava@example.com')
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument()
    expect(screen.getByText(new RegExp(message.slice(0, 30)))).toBeInTheDocument()
    expect(sentBody(fetchMock, '/api/shop/newsletter')).toEqual({ email: 'ava@example.com', source: 'footer' })
  })

  it("shows the server's reason when it refuses", async () => {
    mockFetch({ 'POST /api/shop/newsletter': { status: 429, body: { message: 'Too many attempts. Please wait a minute.' } } })
    const user = userEvent.setup()
    renderWithProviders(<Newsletter />)
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'ava@example.com')
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a minute.')
  })
})

describe('newsletter links (/newsletter/confirm, /newsletter/unsubscribe)', () => {
  it('confirms on arrival, once', async () => {
    const fetchMock = mockFetch({ 'POST /api/shop/newsletter/confirm': { body: { message: "You're subscribed to the BuyNest newsletter.", email: 'ava@example.com', status: 'subscribed' } } })
    renderWithProviders(<NewsletterPage action="confirm" />, { route: '/newsletter/confirm?token=abc.123', path: '/newsletter/confirm' })
    expect(await screen.findByText("You're subscribed to the BuyNest newsletter.")).toBeInTheDocument()
    expect(sentBody(fetchMock, '/api/shop/newsletter/confirm')).toEqual({ token: 'abc.123' })
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/api/shop/newsletter/confirm')).toHaveLength(1)
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  })

  it('explains an expired confirmation link', async () => {
    const message = 'This confirmation link is invalid or has expired. Subscribe again to get a new one.'
    mockFetch({ 'POST /api/shop/newsletter/confirm': { status: 422, body: { message, errors: { token: [message] } } } })
    renderWithProviders(<NewsletterPage action="confirm" />, { route: '/newsletter/confirm?token=old', path: '/newsletter/confirm' })
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('unsubscribes only after a click', async () => {
    const fetchMock = mockFetch({ 'POST /api/shop/newsletter/unsubscribe': { body: { message: "You're unsubscribed. You won't get any more newsletters.", status: 'unsubscribed' } } })
    const user = userEvent.setup()
    renderWithProviders(<NewsletterPage action="unsubscribe" />, { route: '/newsletter/unsubscribe?token=12.ab', path: '/newsletter/unsubscribe' })
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    expect(await screen.findByText(/You're unsubscribed/)).toBeInTheDocument()
    expect(sentBody(fetchMock, '/api/shop/newsletter/unsubscribe')).toEqual({ token: '12.ab' })
  })

  it('says so when the link has no token', () => {
    mockFetch({})
    renderWithProviders(<NewsletterPage action="unsubscribe" />, { route: '/newsletter/unsubscribe', path: '/newsletter/unsubscribe' })
    expect(screen.getByRole('alert')).toHaveTextContent('This unsubscribe link is incomplete')
  })
})

describe('newsletter switch in the account', () => {
  it('shows the current setting and saves a change at once', async () => {
    signIn()
    const fetchMock = mockFetch({
      'GET /api/auth/me': { body: { ...NADIA, newsletter: false } },
      'PUT /api/auth/profile': { body: { ...NADIA, newsletter: true } },
      'GET /api/shop/me/cart': EMPTY_SAVED_CART,
    })
    const user = userEvent.setup()
    renderWithProviders(<ProfilePage />, { route: '/account', path: '/account' })
    const box = await screen.findByRole('checkbox', { name: /Email me new arrivals/ }, { timeout: 5000 })
    expect(box).not.toBeChecked()
    await user.click(box)
    expect(await screen.findByText("You're subscribed to the newsletter.")).toBeInTheDocument()
    expect(box).toBeChecked()
    expect(sentBody(fetchMock, '/api/auth/profile')).toEqual({ newsletter: true })
  })

  it('is hidden when the API says nothing about the newsletter', async () => {
    signIn()
    mockFetch({ 'GET /api/auth/me': { body: NADIA }, 'GET /api/shop/me/cart': EMPTY_SAVED_CART })
    renderWithProviders(<ProfilePage />, { route: '/account', path: '/account' })
    expect(await screen.findByText('nadia@example.com', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('URL redirects from "not found"', () => {
  it("goes to the redirect's target instead of showing 'not found'", async () => {
    const fetchMock = mockFetch({ 'GET /api/catalog/redirects': { body: { data: { from_path: '/old-lamp', to_path: '/products/7', status_code: 301 } } } })
    renderWithProviders(<NotFoundPage />, { route: '/old-lamp', path: '*', extraRoutes: <Route path="/products/:id" element={<p>Product page</p>} /> })
    expect(await screen.findByText('Product page')).toBeInTheDocument()
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('path')).toBe('/old-lamp')
  })

  it("shows 'not found' when there is no redirect", async () => {
    mockFetch({ 'GET /api/catalog/redirects': { status: 404, body: { message: 'No redirect for this path.' } } })
    renderWithProviders(<NotFoundPage />, { route: '/nothing-here', path: '*' })
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('ignores a target that is not a store path or an https address', async () => {
    mockFetch({ 'GET /api/catalog/redirects': { body: { data: { from_path: '/x', to_path: 'javascript:alert(1)', status_code: 301 } } } })
    renderWithProviders(<NotFoundPage />, { route: '/x', path: '*' })
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('cart price rules in the summary', () => {
  const totals = { itemCount: 2, subtotal: 60, productSavings: 0, discount: 11, shipping: 0, total: 49, amountToFreeShipping: 0, freeShippingThreshold: 50 }

  it('lists each applied rule with its saving, and free shipping', async () => {
    mockFetch({})
    renderWithProviders(
      <CartSummary
        totals={{
          ...totals,
          appliedRules: [
            { id: 1, code: null, label: 'Spend $50, get $6 off', automatic: true, discount: 6, freeShipping: true },
            { id: 2, code: 'NEST5', label: '$5 off', automatic: false, discount: 5, freeShipping: false },
          ],
        }}
        couponCode="NEST5"
        onApplyCoupon={() => {}}
        onRemoveCoupon={() => {}}
      />,
    )
    expect(screen.getByText('Spend $50, get $6 off').nextSibling).toHaveTextContent('−$6.00 + Free shipping')
    expect(screen.getByText('$5 off (NEST5)').nextSibling).toHaveTextContent('−$5.00')
    expect(screen.queryByText('Discount (NEST5)')).not.toBeInTheDocument()
  })

  it('keeps the single "Discount (CODE)" row without rule details', async () => {
    mockFetch({})
    renderWithProviders(<CartSummary totals={{ ...totals, discount: 5 }} couponCode="NEST5" onApplyCoupon={() => {}} onRemoveCoupon={() => {}} />)
    await waitFor(() => expect(screen.getByText('Discount (NEST5)')).toBeInTheDocument())
  })
})
