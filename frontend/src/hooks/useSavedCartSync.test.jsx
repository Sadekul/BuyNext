import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { useAuth } from './useAuth'
import { useCart } from './useCart'
import { quantitiesFromPricingKey } from './useSavedCartSync'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { CART_ACTIONS, cartReducer, savedLineToItem } from '../reducers/cartReducer'

/*
 * Phase 7: a signed-in customer's cart follows them between devices
 * (useSavedCartSync, through CartProvider), without counting lines twice.
 */
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

// Generous timeouts: the full suite runs many files in parallel, and sign-in + sync is several requests.
const SLOW = { timeout: 5000 }
const NADIA = { id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', role: 'customer' }
const line = (productId, quantity, extra = {}) => ({ productId, title: `Product ${productId}`, thumbnail: null, sku: null, price: 20, salePrice: 20, discountPercentage: 0, stock: 5, minimumOrderQuantity: 1, quantity, ...extra })
const stored = (productId, quantity) => ({ productId, title: `Product ${productId}`, brand: 'Nest', category: 'home', thumbnail: null, price: 20, discountPercentage: 0, stock: 5, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity })
const accountCartKey = `${STORAGE_KEYS.cart}.user-5`
const baselineKey = `${STORAGE_KEYS.cartSync}.user-5`
const readStore = (key) => JSON.parse(window.localStorage.getItem(key) ?? 'null')
const sentBody = (fetchMock, path) => {
  const call = fetchMock.mock.calls.findLast(([url]) => new URL(url).pathname === path)
  return call && JSON.parse(call[1].body)
}

function CartView() {
  const { items, clearCart } = useCart()
  const { login, status } = useAuth()
  return (
    <>
      <p>status: {status}</p>
      <p data-testid="cart">{items.map((item) => `${item.productId}x${item.quantity}`).join(',') || 'empty'}</p>
      <button type="button" onClick={() => login({ email: 'nadia@example.com', password: 'x', remember: true })}>
        Sign in
      </button>
      <button type="button" onClick={clearCart}>
        Empty cart
      </button>
    </>
  )
}

describe('saved cart: right after signing in', () => {
  it('adds only the lines the server lacks, then shows the merged cart', async () => {
    // This device last synced 1 × product 1 for Nadia; she has added product 2 since, and a guest added product 3.
    window.localStorage.setItem(accountCartKey, JSON.stringify({ items: [stored(1, 1), stored(2, 1)], couponCode: null }))
    window.localStorage.setItem(baselineKey, JSON.stringify({ 1: 1 }))
    window.localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify({ items: [stored(3, 2)], couponCode: null }))
    const fetchMock = mockFetch({
      'POST /api/auth/login': { body: NADIA },
      // The server had product 1 (from here) and product 4 (from another device).
      'POST /api/shop/me/cart/merge': { body: { items: [line(1, 1), line(2, 1), line(3, 2), line(4, 1, { stock: 3, salePrice: 15 })], itemCount: 5, updatedAt: null } },
    })
    const user = userEvent.setup()
    renderWithProviders(<CartView />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByTestId('cart')).toHaveTextContent('1x1,2x1,3x2,4x1'), SLOW)
    expect(sentBody(fetchMock, '/api/shop/me/cart/merge')).toEqual({ items: [{ productId: 2, quantity: 1 }, { productId: 3, quantity: 2 }] })
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/api/shop/me/cart/merge')).toHaveLength(1)
    expect(readStore(baselineKey)).toEqual({ 1: 1, 2: 1, 3: 2, 4: 1 })
    expect(window.localStorage.getItem('buynest.cartMerging.user-5')).toBeNull() // the cross-tab lock is released
    // A line the server priced on sale (a catalog rule) keeps that price, shown as a discount; local lines keep their brand.
    const saved = readStore(accountCartKey).items
    expect(saved.find((item) => item.productId === 4).discountPercentage).toBeCloseTo(25)
    expect(saved.find((item) => item.productId === 1).brand).toBe('Nest')
  })

  it('only fetches the saved cart when everything here is already on the server', async () => {
    window.localStorage.setItem(accountCartKey, JSON.stringify({ items: [stored(1, 2)], couponCode: null }))
    window.localStorage.setItem(baselineKey, JSON.stringify({ 1: 2 }))
    const fetchMock = mockFetch({
      'POST /api/auth/login': { body: NADIA },
      'GET /api/shop/me/cart': { body: { items: [line(1, 2), line(9, 1)], itemCount: 3, updatedAt: null } },
    })
    const user = userEvent.setup()
    renderWithProviders(<CartView />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByTestId('cart')).toHaveTextContent('1x2,9x1'), SLOW)
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).pathname === '/api/shop/me/cart/merge')).toBe(false)
  })
})

describe('saved cart: a session that continues', () => {
  it('adds what the server gained since this device last synced, once per browser session', async () => {
    document.cookie = 'buynest_session=session; Path=/'
    window.localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
    window.localStorage.setItem(accountCartKey, JSON.stringify({ items: [stored(1, 1)], couponCode: null }))
    window.localStorage.setItem(baselineKey, JSON.stringify({ 1: 1 }))
    const fetchMock = mockFetch({
      'GET /api/auth/me': { body: NADIA },
      'GET /api/shop/me/cart': { body: { items: [line(1, 3), line(2, 1)], itemCount: 4, updatedAt: null } },
    })
    const { unmount } = renderWithProviders(<CartView />)
    await waitFor(() => expect(screen.getByTestId('cart')).toHaveTextContent('1x3,2x1'), SLOW)
    expect(readStore(baselineKey)).toEqual({ 1: 3, 2: 1 })
    unmount()

    renderWithProviders(<CartView />) // a reload in the same browser session: nothing is fetched again
    await screen.findByText('status: authenticated', {}, SLOW)
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === '/api/shop/me/cart')).toHaveLength(1)
  })
})

describe('saved cart: emptied without the cart page', () => {
  it('tells the server the cart is empty, so the old lines do not come back at the next sign-in', async () => {
    window.localStorage.setItem(accountCartKey, JSON.stringify({ items: [stored(1, 2)], couponCode: null }))
    window.localStorage.setItem(baselineKey, JSON.stringify({ 1: 2 }))
    const fetchMock = mockFetch({
      'POST /api/auth/login': { body: NADIA },
      'GET /api/shop/me/cart': { body: { items: [line(1, 2)], itemCount: 2, updatedAt: null } },
      'POST /api/shop/cart/validate': { body: { lines: [], problems: [], totals: {} } },
    })
    const user = userEvent.setup()
    renderWithProviders(<CartView />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByTestId('cart')).toHaveTextContent('1x2'), SLOW)

    await user.click(screen.getByRole('button', { name: 'Empty cart' }))
    await waitFor(() => expect(sentBody(fetchMock, '/api/shop/cart/validate')?.items).toEqual([]), SLOW)
    await waitFor(() => expect(readStore(baselineKey)).toEqual({}), SLOW)
  })
})

describe('saved cart: another tab is merging', () => {
  it("doesn't fetch (and add) the saved cart while the sign-in tab's merge runs", async () => {
    document.cookie = 'buynest_session=session; Path=/'
    window.localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
    window.localStorage.setItem('buynest.cartMerging.user-5', JSON.stringify(Date.now()))
    const fetchMock = mockFetch({ 'GET /api/auth/me': { body: NADIA }, 'GET /api/shop/me/cart': { body: { items: [line(1, 3)], itemCount: 3, updatedAt: null } } })
    renderWithProviders(<CartView />)
    await screen.findByText('status: authenticated', {}, SLOW)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).pathname === '/api/shop/me/cart')).toBe(false)
    expect(screen.getByTestId('cart')).toHaveTextContent('empty')
  })
})

describe('saved cart helpers', () => {
  it('reads the cart-pricing key back into quantities', () => {
    expect(quantitiesFromPricingKey(['12x2', '15v7x1', 'junk'])).toEqual({ 12: 2, '15:7': 1 })
  })

  it('turns saved lines into cart items, skipping ones that cannot be sold', () => {
    expect(savedLineToItem(line(1, 2, { variantId: 3, variantLabel: 'Size: M' }))).toMatchObject({ productId: 1, variantId: 3, variantLabel: 'Size: M', quantity: 2, availabilityStatus: 'Low Stock' }) // 5 left
    expect(savedLineToItem(line(1, 1, { stock: 0 }))).toBeNull()
    expect(savedLineToItem({ productId: 'x' })).toBeNull()
  })

  it('caps added quantities by stock', () => {
    const state = { items: [savedLineToItem(line(1, 4))], couponCode: 'NEST5' }
    const next = cartReducer(state, { type: CART_ACTIONS.SAVED_CART_LOADED, lines: [line(1, 3)], mode: 'add' })
    expect(next.items[0].quantity).toBe(5)
    expect(next.couponCode).toBe('NEST5')
  })
})
