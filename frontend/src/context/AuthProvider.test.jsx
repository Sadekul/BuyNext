import { describe, expect, it } from 'vitest'
import { act, screen } from '@testing-library/react'
import { useAuth } from '../hooks/useAuth'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'

const ACCOUNT_KEYS = ['buynest.cart.v1.user-1', 'buynest.wishlist.v1.user-1', 'buynest.orders.v1.user-1']

function SignOutProbe() {
  const { status, logout } = useAuth()
  return (
    <>
      <p>status: {status}</p>
      <button type="button" onClick={logout}>
        Sign out
      </button>
    </>
  )
}

// A signed-in customer with saved items on this device.
function signedIn({ remember }) {
  document.cookie = `buynest_session=${remember ? 'remember' : 'session'}; Path=/`
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 1, firstName: 'Emily' }, remember }))
  window.localStorage.setItem(ACCOUNT_KEYS[0], JSON.stringify({ items: [{ productId: 5, title: 'Phone', price: 10, quantity: 1 }], couponCode: null }))
  window.localStorage.setItem(ACCOUNT_KEYS[1], JSON.stringify({ items: [{ productId: 6, title: 'Lamp', price: 5, addedAt: 1 }] }))
  mockFetch({ 'GET /api/auth/me': { body: { id: 1, username: 'emilys', firstName: 'Emily' } }, 'POST /api/auth/logout': { body: { ok: true } } })
}

const savedKeys = () => ACCOUNT_KEYS.filter((key) => window.localStorage.getItem(key) !== null)

async function signOut() {
  renderWithProviders(<SignOutProbe />)
  await screen.findByText('status: authenticated')
  await act(async () => screen.getByRole('button', { name: 'Sign out' }).click())
  await screen.findByText('status: anonymous')
}

describe('AuthProvider: what a session leaves on the device', () => {
  it('keeps no token in Web Storage, only the name for the header', async () => {
    signedIn({ remember: true })
    renderWithProviders(<SignOutProbe />)
    await screen.findByText('status: authenticated')
    const everything = JSON.stringify({ ...window.localStorage, ...window.sessionStorage })
    expect(everything).not.toMatch(/token/i)
  })

  it('without "Remember me", signing out deletes the account\'s saved cart, wishlist, and orders', async () => {
    signedIn({ remember: false })
    await signOut()
    expect(savedKeys()).toEqual([])
  })

  it('with "Remember me", signing out keeps them for the next sign-in', async () => {
    signedIn({ remember: true })
    await signOut()
    expect(savedKeys()).toEqual(ACCOUNT_KEYS)
  })

  it('an unremembered session that ended with the browser leaves nothing behind on the next visit', () => {
    signedIn({ remember: false })
    document.cookie = 'buynest_session=; Max-Age=0; Path=/' // browser closed: session cookies are gone
    renderWithProviders(<SignOutProbe />)
    expect(screen.getByText('status: anonymous')).toBeInTheDocument()
    expect(savedKeys()).toEqual([])
    expect(window.localStorage.getItem('buynest.session.v2')).toBeNull()
  })

  // Regression: a reload right after signing in, before the name was cached,
  // used to forget "Remember me" and delete the items at sign-out.
  it('takes "Remember me" from the session cookie, even before the name is cached', async () => {
    signedIn({ remember: true })
    window.localStorage.removeItem('buynest.session.v2')
    await signOut()
    expect(savedKeys()).toEqual(ACCOUNT_KEYS)
  })

  it('signing out removes the session hint at once, so a quick reload starts signed out', async () => {
    signedIn({ remember: true })
    await signOut()
    expect(document.cookie).not.toMatch(/buynest_session=/)
  })

  it('removes token-bearing sessions saved by older versions', () => {
    window.localStorage.setItem('buynest.session.v1', JSON.stringify({ tokens: { accessToken: 'a', refreshToken: 'r' } }))
    renderWithProviders(<SignOutProbe />)
    expect(window.localStorage.getItem('buynest.session.v1')).toBeNull()
  })
})
