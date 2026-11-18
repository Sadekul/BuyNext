import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import WishlistPage from './WishlistPage'
import SharedWishlistPage from './SharedWishlistPage'
import ComparePage from './ComparePage'
import ProductDetailsPage from './ProductDetailsPage'
import CartPage from './CartPage'
import CheckoutPage from './CheckoutPage'
import OrderConfirmationPage from './OrderConfirmationPage'
import OrderDetailsPage from './OrderDetailsPage'
import RewardsPage from './RewardsPage'
import ProductCard from '../components/product/ProductCard'
import CurrencyPicker from '../components/layout/CurrencyPicker'
import WishlistSyncNotice from '../components/layout/WishlistSyncNotice'
import AccountLayout from '../layouts/AccountLayout'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { normalizeProduct } from '../services/adapters/laravelAdapter'
import { resetDisplayCurrencyForTests, useDisplayCurrency } from '../utils/displayCurrency'

// Phase 11 storefront with BuyNest's API (docs/backend/PHASE11_CONTRACT.md): the account wishlist on the
// server and sharing it, compare, specifications and linked products, reward points, display currencies.
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const SLOW = { timeout: 20_000 }
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012-_9'

/** The API's product card (snake_case), as the catalog and the shop service answer it. */
const card = (overrides = {}) => ({
  id: 7, name: 'Desk Lamp', price: '40.00', discount_percent: 0, sale_price: '40.00', rating_average: '4.40', review_count: 12, stock_quantity: 8, availability: 'in_stock',
  min_order_quantity: 1, has_variants: false, thumbnail_url: 'https://cdn.example/lamp.webp', brand: { name: 'Lumo' }, category: { slug: 'home', name: 'Home' }, weight: 900, ...overrides,
})
const FLOOR_LAMP = card({ id: 8, name: 'Floor Lamp', price: '90.00', sale_price: '90.00', brand: { name: 'Lumo' }, weight: 4200 })
const ITEM = { id: 31, product: card(), variant: null, note: 'For the office', addedAt: '2026-11-18T09:00:00Z' }
const STORE = (overrides = {}) => ({
  data: {
    store_name: 'BuyNest', support_email: 'help@buynest.test', free_shipping_threshold: '100.00', allowed_countries: ['United States', 'Bangladesh'], guest_checkout: true, tax_enabled: false,
    shipping_methods: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: '4.99' }],
    payment_methods: ['cod'], card_payments: 'manual', paypal_payments: 'manual', ga4_measurement_id: null,
    currencies: { base: 'USD', display: [] }, rewards: { enabled: false }, ...overrides,
  },
})
const CATALOG = (store = STORE()) => ({
  'GET /api/catalog/products': { body: { data: [card(), FLOOR_LAMP], meta: { current_page: 1, per_page: 100, total: 2 } } },
  'GET /api/catalog/store': { body: store },
  'GET /api/catalog/categories': { body: { data: [{ slug: 'home', name: 'Home', children: [] }] } },
})
const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
}
const NADIA = { id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', role: 'customer' }
const ME = { 'GET /api/auth/me': { body: NADIA } }
const calls = (fetchMock, method, path) => fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === path && (init?.method ?? 'GET') === method)
const lastSent = (fetchMock, method, path) => {
  const call = calls(fetchMock, method, path).at(-1)
  return call && JSON.parse(call[1].body)
}

afterEach(() => resetDisplayCurrencyForTests())

describe('the account wishlist on the server (§1)', () => {
  it('loads the server list, saves a note, and removes an item there', async () => {
    signIn()
    const fetchMock = mockFetch({
      ...ME,
      ...CATALOG(),
      'GET /api/shop/me/wishlist': { body: { items: [ITEM], shared: false } },
      'PATCH /api/shop/me/wishlist/31': (url, init) => ({ body: { ...ITEM, note: JSON.parse(init.body).note } }),
      'DELETE /api/shop/me/wishlist/31': { body: { ok: true } },
    })
    const user = userEvent.setup()
    renderWithProviders(<WishlistPage />, { route: '/wishlist', path: '/wishlist' })

    expect(await screen.findByRole('link', { name: 'Desk Lamp' })).toBeInTheDocument()
    expect(screen.getByText(/Saved to your account, so it follows you/)).toBeInTheDocument()
    const note = screen.getByLabelText('Note')
    expect(note).toHaveValue('For the office')
    await user.clear(note)
    await user.type(note, 'Size M, please')
    await user.click(screen.getByRole('button', { name: 'Save note for Desk Lamp' }))
    expect(await screen.findByText('Note saved.')).toBeInTheDocument()
    expect(lastSent(fetchMock, 'PATCH', '/api/shop/me/wishlist/31')).toEqual({ note: 'Size M, please' })

    await user.click(screen.getByRole('button', { name: 'Remove Desk Lamp from wishlist' }))
    expect(await screen.findByRole('heading', { name: 'Your wishlist is empty' })).toBeInTheDocument()
    await waitFor(() => expect(calls(fetchMock, 'DELETE', '/api/shop/me/wishlist/31')).toHaveLength(1))
  })

  it('sends the guest’s items once after signing in (merge), and shows the merged list', async () => {
    window.localStorage.setItem('buynest.wishlist.v1', JSON.stringify({ items: [{ productId: 8, title: 'Floor Lamp', price: 90, addedAt: 1 }] }))
    signIn()
    const fetchMock = mockFetch({
      ...ME,
      ...CATALOG(),
      'POST /api/shop/me/wishlist/merge': { body: { items: [{ ...ITEM, id: 32, product: FLOOR_LAMP, note: null }, ITEM], shared: false, skipped: [] } },
    })
    renderWithProviders(<WishlistPage />, { route: '/wishlist', path: '/wishlist' })
    expect(await screen.findByRole('link', { name: 'Desk Lamp' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Floor Lamp' })).toBeInTheDocument()
    expect(lastSent(fetchMock, 'POST', '/api/shop/me/wishlist/merge')).toEqual({ items: [{ productId: 8 }] })
    expect(calls(fetchMock, 'GET', '/api/shop/me/wishlist')).toHaveLength(0)
    expect(window.localStorage.getItem('buynest.wishlistPending.v1.user-5')).toBeNull()
    expect(window.localStorage.getItem('buynest.wishlist.v1')).toBeNull() // the guest copy moved into the account
  })

  it('an add the server refuses is undone, and the reason is shown', async () => {
    signIn()
    const full = 'Your wishlist is full (100 items). Remove something to add more.'
    const fetchMock = mockFetch({
      ...ME,
      ...CATALOG(),
      'GET /api/shop/me/wishlist': { body: { items: [], shared: false } },
      'POST /api/shop/me/wishlist': { status: 422, body: { message: full, code: 'wishlist_full', errors: { productId: [full] } } },
    })
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <ProductCard product={normalizeProduct(card())} />
        <WishlistSyncNotice />
      </>,
    )
    await waitFor(() => expect(calls(fetchMock, 'GET', '/api/shop/me/wishlist')).toHaveLength(1))
    const heart = screen.getByRole('button', { name: 'Save Desk Lamp to wishlist' })
    await user.click(heart)
    expect(await screen.findByText(full)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Desk Lamp to wishlist' })).toHaveAttribute('aria-pressed', 'false')
    expect(lastSent(fetchMock, 'POST', '/api/shop/me/wishlist')).toEqual({ productId: 7 })
    await user.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByText(full)).not.toBeInTheDocument()
  })

  it('shares the list: makes a link to copy, a new one, and stops sharing', async () => {
    signIn()
    const fetchMock = mockFetch({
      ...ME,
      ...CATALOG(),
      'GET /api/shop/me/wishlist': { body: { items: [ITEM], shared: false } },
      'POST /api/shop/me/wishlist/share': { status: 201, body: { shared: true, token: TOKEN, sharedAt: '2026-11-18T10:00:00Z' } },
      'DELETE /api/shop/me/wishlist/share': { body: { ok: true } },
    })
    const user = userEvent.setup()
    renderWithProviders(<WishlistPage />, { route: '/wishlist', path: '/wishlist' })
    const share = within(await screen.findByRole('region', { name: 'Share my wishlist' }))
    await user.click(share.getByRole('button', { name: 'Create share link' }))
    const link = await share.findByLabelText('Share link')
    expect(link).toHaveValue(`${window.location.origin}/wishlist/shared/${TOKEN}`)
    expect(share.getByRole('status')).toHaveTextContent('Your share link is ready.')
    await user.click(share.getByRole('button', { name: 'Copy link' }))
    expect(share.getByRole('status')).toHaveTextContent('Link copied.')
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/wishlist/shared/${TOKEN}`)

    await user.click(share.getByRole('button', { name: 'Get a new link' }))
    await waitFor(() => expect(lastSent(fetchMock, 'POST', '/api/shop/me/wishlist/share')).toEqual({ regenerate: true }))
    expect(await share.findByText(/A new share link was made/)).toBeInTheDocument()

    await user.click(share.getByRole('button', { name: 'Stop sharing' }))
    expect(await share.findByText('Sharing is off. The link no longer works.')).toBeInTheDocument()
    expect(share.queryByLabelText('Share link')).not.toBeInTheDocument()
    expect(share.getByRole('button', { name: 'Create share link' })).toBeInTheDocument()
  })

  it('an already shared list says the link can only be made again', async () => {
    signIn()
    mockFetch({ ...ME, ...CATALOG(), 'GET /api/shop/me/wishlist': { body: { items: [ITEM], shared: true } } })
    renderWithProviders(<WishlistPage />, { route: '/wishlist', path: '/wishlist' })
    const share = within(await screen.findByRole('region', { name: 'Share my wishlist' }))
    expect(await share.findByText(/Your wishlist is shared. For your privacy the link is only shown when it is made/)).toBeInTheDocument()
    expect(share.getByRole('button', { name: 'Get a new link' })).toBeInTheDocument()
    expect(share.queryByRole('button', { name: 'Create share link' })).not.toBeInTheDocument()
  })

  it('guests keep the browser list: no sharing, no notes, no requests', async () => {
    window.localStorage.setItem('buynest.wishlist.v1', JSON.stringify({ items: [{ productId: 7, title: 'Desk Lamp', price: 40, addedAt: 1 }] }))
    const fetchMock = mockFetch({ ...CATALOG() })
    renderWithProviders(<WishlistPage />, { route: '/wishlist', path: '/wishlist' })
    expect(await screen.findByText(/Saved on this device. Sign in to keep your wishlist/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Share my wishlist' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).pathname.startsWith('/api/shop/me/wishlist'))).toBe(false)
  })
})

describe('a shared wishlist (§1)', () => {
  const page = (token = TOKEN) => renderWithProviders(<SharedWishlistPage />, { route: `/wishlist/shared/${token}`, path: '/wishlist/shared/:token' })

  it('shows the owner’s first name and items; Add all to cart adds what can be bought straight away', async () => {
    mockFetch({
      [`GET /api/shop/wishlists/${TOKEN}`]: {
        body: {
          ownerFirstName: 'Nadia',
          items: [
            { product: card(), variantLabel: null, note: 'For the office' },
            { product: FLOOR_LAMP, variantLabel: null, note: null },
            { product: card({ id: 9, name: 'Lamp Shade', has_variants: true }), variantLabel: 'Color: Black', note: null },
          ],
        },
      },
    })
    const user = userEvent.setup()
    page()
    expect(await screen.findByRole('heading', { level: 1, name: "Nadia's wishlist" })).toBeInTheDocument()
    expect(document.title).toContain("Nadia's wishlist")
    expect(screen.getByText('“For the office”')).toBeInTheDocument()
    expect(screen.getByText('Color: Black')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose options for Lamp Shade' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add all to cart' }))
    expect(screen.getAllByRole('status').some((status) => status.textContent === '2 products were added to your cart.')).toBe(true)
    const cart = JSON.parse(window.localStorage.getItem('buynest.cart.v1')).items
    expect(cart.map((line) => line.productId)).toEqual([7, 8])
  })

  it('a link that was turned off (or never existed) says so; a malformed one isn’t requested', async () => {
    const fetchMock = mockFetch({ [`GET /api/shop/wishlists/${TOKEN}`]: { status: 404, body: { message: "This wishlist isn't shared any more." } } })
    page()
    expect(await screen.findByRole('heading', { name: "This wishlist link doesn't work" })).toBeInTheDocument()
    fetchMock.mockClear()
    page('bad')
    expect((await screen.findAllByRole('heading', { name: "This wishlist link doesn't work" })).length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('compare (§2)', () => {
  const seedCompare = (items) => window.localStorage.setItem('buynest.compare.v1', JSON.stringify({ items }))
  const COMPARE = {
    data: [
      { ...card(), description_short: 'A desk lamp.', options: [{ name: 'Color', values: ['Black', 'White'] }], specifications: [{ label: 'Bulb', value: 'E27' }, { label: 'Power', value: '9 W' }] },
      { ...FLOOR_LAMP, description_short: null, options: [], specifications: [{ label: 'power', value: '20 W' }, { label: 'Height', value: '160 cm' }] },
    ],
  }

  it('a real table: a column per product, row headers, the union of specifications, differences, Add to cart and Remove', SLOW, async () => {
    seedCompare([{ id: 7, title: 'Desk Lamp' }, { id: 8, title: 'Floor Lamp' }])
    const fetchMock = mockFetch({ 'GET /api/catalog/products/compare': { body: COMPARE } })
    const user = userEvent.setup()
    renderWithProviders(<ComparePage />, { route: '/compare', path: '/compare' })

    const table = await screen.findByRole('table', { name: 'Comparing 2 products' })
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('ids')).toBe('7,8')
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Desk Lamp', 'Floor Lamp'])
    expect(within(table).getAllByRole('rowheader').map((header) => header.textContent)).toEqual(['Image', 'Price', 'Rating', 'Stock', 'Brand', 'Category', 'Weight', 'Options', 'Bulb', 'Power', 'Height', 'Actions'])
    const row = (name) => within(table).getByRole('rowheader', { name }).closest('tr')
    expect(within(row('Weight')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['900 g', '4.2 kg'])
    expect(within(row('Bulb')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['E27', '—'])
    expect(within(row('Power')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['9 W', '20 W'])
    expect(within(row('Options')).getAllByRole('cell')[0]).toHaveTextContent('Color: Black, White')

    // Phones: the table scrolls sideways inside a region the keyboard can reach.
    const region = screen.getByRole('region', { name: 'Comparing 2 products' })
    expect(region).toHaveAttribute('tabindex', '0')

    await user.click(screen.getByLabelText('Highlight differences'))
    expect(within(table).getByRole('rowheader', { name: /^Price\s*\(differs\)$/ })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Brand' })).toBeInTheDocument() // the same for both

    await user.click(screen.getByRole('button', { name: 'Add Desk Lamp to cart' }))
    expect(JSON.parse(window.localStorage.getItem('buynest.cart.v1')).items[0]).toMatchObject({ productId: 7, quantity: 1 })

    await user.click(screen.getByRole('button', { name: 'Remove Floor Lamp from comparison' }))
    expect(await screen.findByRole('heading', { name: 'Add one more product to compare' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('buynest.compare.v1')).items).toEqual([{ id: 7, title: 'Desk Lamp', thumbnail: null }])
  })

  it('says when products are no longer available', async () => {
    seedCompare([{ id: 7, title: 'Desk Lamp' }, { id: 8, title: 'Floor Lamp' }, { id: 99, title: 'Gone' }])
    mockFetch({ 'GET /api/catalog/products/compare': { body: COMPARE } })
    renderWithProviders(<ComparePage />, { route: '/compare', path: '/compare' })
    expect(await screen.findByText('One product is no longer available and was left out.')).toBeInTheDocument()
  })
})

describe('the product page: specifications, linked products, points (§2, §3, §4, §6)', () => {
  const DETAIL = {
    ...card(), description: 'A bright lamp.', images: [], reviews: [],
    specifications: [{ label: 'Bulb', value: 'E27' }, { label: 'Power', value: '9 W' }],
    upsells: [card({ id: 20, name: 'Smart Lamp' })],
    related: [card({ id: 21, name: 'Lamp Shade' })],
  }

  it('shows the specifications table, "You may also like" and "Related products" from the API, Compare, and Earn points', async () => {
    signIn()
    const fetchMock = mockFetch({
      ...ME,
      ...CATALOG(STORE({ rewards: { enabled: true, earn_rate: '1.50', point_value: '0.0100', min_redeem: 100 } })),
      'GET /api/catalog/products/7': { body: { data: DETAIL } },
      'GET /api/shop/me/wishlist': { body: { items: [], shared: false } },
    })
    const user = userEvent.setup()
    renderWithProviders(<ProductDetailsPage />, { route: '/products/7', path: '/products/:productId' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Desk Lamp' })).toBeInTheDocument()
    const specs = screen.getByRole('region', { name: 'Specifications' })
    expect(within(specs).getByRole('rowheader', { name: 'Bulb' }).nextSibling).toHaveTextContent('E27')
    expect(screen.getByRole('region', { name: 'Product details' })).toHaveTextContent('Lumo')
    const upsells = screen.getByRole('region', { name: 'You may also like' })
    expect(within(upsells).getByRole('link', { name: 'Smart Lamp' })).toBeInTheDocument()
    const related = screen.getByRole('region', { name: 'Related products' })
    expect(within(related).getByRole('link', { name: 'Lamp Shade' })).toBeInTheDocument()
    // The order on the page: up-sells above the reviews, related products below.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings.indexOf('You may also like')).toBeLessThan(headings.indexOf('Customer reviews'))
    expect(headings.indexOf('Related products')).toBeGreaterThan(headings.indexOf('Customer reviews'))
    // No category request: the API chose the related products.
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).searchParams.get('category'))).toBe(false)

    expect(await screen.findByText('Earn about 60 reward points with this purchase.')).toBeInTheDocument()

    const compare = screen.getByRole('button', { name: 'Compare Desk Lamp' })
    expect(compare).toHaveAttribute('aria-pressed', 'false')
    await user.click(compare)
    expect(compare).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(window.localStorage.getItem('buynest.compare.v1')).items).toEqual([{ id: 7, title: 'Desk Lamp', thumbnail: 'https://cdn.example/lamp.webp' }])
    // Remembered as recently viewed (this browser only).
    expect(JSON.parse(window.localStorage.getItem('buynest.recentlyViewed.v1'))[0]).toMatchObject({ id: 7, title: 'Desk Lamp' })
  })

  it('no specifications, no up-sells: neither section; guests see no points', async () => {
    mockFetch({
      ...CATALOG(STORE({ rewards: { enabled: true, earn_rate: '1.00', point_value: '0.0100', min_redeem: 0 } })),
      'GET /api/catalog/products/7': { body: { data: { ...DETAIL, specifications: [], upsells: [], related: [] } } },
    })
    renderWithProviders(<ProductDetailsPage />, { route: '/products/7', path: '/products/:productId' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Desk Lamp' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Specifications' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'You may also like' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Related products' })).not.toBeInTheDocument()
    expect(screen.queryByText(/reward points/)).not.toBeInTheDocument()
  })
})

const LAMP_ITEM = { productId: 7, title: 'Desk Lamp', brand: 'Lumo', category: 'home', thumbnail: 'l.webp', price: 40, discountPercentage: 0, stock: 8, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 1 }
const seedCart = (items = [LAMP_ITEM]) => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items, couponCode: null }))
const LINE = { productId: 7, title: 'Desk Lamp', thumbnail: 'l.webp', price: 40, discountPercentage: 0, salePrice: 40, quantity: 1, lineTotal: 40, stock: 8, minimumOrderQuantity: 1, available: true }
const TOTALS = (extra = {}) => ({ itemCount: 1, subtotal: 40, discount: 0, shipping: 4.99, tax: 0, total: 44.99, giftCard: 0, amountDue: 44.99, rewardPoints: 0, ...extra })
const CART = (overrides = {}) => ({
  lines: [LINE], problems: [], coupon: null, couponError: null, appliedRules: [], shippingOptions: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 4.99 }],
  requiresShipping: true, shippingError: null, giftCard: null, giftCardError: null, crossSells: [], rewards: null, rewardPoints: null, rewardPointsError: null, totals: TOTALS(), ...overrides,
})

describe('the cart: cross-sells and display currencies (§3, §5)', () => {
  /** Re-renders the page on a currency change, like App does. */
  function Shop() {
    useDisplayCurrency()
    return (
      <>
        <CurrencyPicker />
        <CartPage />
      </>
    )
  }

  it('"Customers also bought" adds to the cart; another currency is shown with the "charged in USD" note', async () => {
    seedCart()
    mockFetch({
      ...CATALOG(STORE({ currencies: { base: 'USD', display: [{ code: 'BDT', symbol: '৳', rate: '110.00000000', decimals: 2 }] } })),
      'POST /api/shop/cart/validate': { body: CART({ crossSells: [{ ...FLOOR_LAMP }] }) },
    })
    const user = userEvent.setup()
    renderWithProviders(<Shop />)
    const crossSells = await screen.findByRole('region', { name: 'Customers also bought' })
    await user.click(within(crossSells).getByRole('button', { name: /Add to cart/ }))
    expect(JSON.parse(window.localStorage.getItem('buynest.cart.v1')).items.map((item) => item.productId)).toEqual([7, 8])

    const picker = await screen.findByLabelText('Show prices in')
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['USD', 'BDT (৳)'])
    expect(screen.queryByText(/approximate/)).not.toBeInTheDocument()
    await user.selectOptions(picker, 'BDT')
    expect(window.localStorage.getItem('buynest.currency.v1')).toBe('"BDT"')
    const summary = screen.getByRole('region', { name: 'Order summary' })
    expect(within(summary).getByText('Estimated total').nextSibling).toHaveTextContent('৳')
    expect(within(summary).getByText(/Prices in BDT are approximate. You'll be charged \$\d+\.\d\d USD./)).toBeInTheDocument()
    expect(within(crossSells).queryByText('$90.00')).not.toBeInTheDocument()
    expect(within(crossSells).getByText('৳9,900.00')).toBeInTheDocument()

    await user.selectOptions(picker, 'USD')
    expect(screen.queryByText(/approximate/)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('buynest.currency.v1')).toBeNull()
  })

  it('no display currency offered (or the demo): no picker', async () => {
    mockFetch({ ...CATALOG() })
    renderWithProviders(<CurrencyPicker />)
    await waitFor(() => expect(screen.queryByLabelText('Show prices in')).not.toBeInTheDocument())
  })
})

describe('reward points (§4)', () => {
  const HOME = { id: 7, firstName: 'Nadia', lastName: 'Rahman', phone: '+8801712345678', company: '', line1: '12 Lake Road', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1212', country: 'Bangladesh', isDefaultShipping: true, isDefaultBilling: true }
  const REWARDS = (extra = {}) => ({ enabled: true, balance: 1250, pointValue: 0.01, minRedeem: 100, maxPoints: 1000, earnEstimate: 40, appliedPoints: 0, appliedAmount: 0, ...extra })
  const ORDER = (extra = {}) => ({
    number: 'BN-100009', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod', shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' },
    email: 'nadia@example.com', phone: '+8801712345678', shippingAddress: HOME, billingAddress: HOME, couponCode: null, items: [LINE], placedAt: '2026-11-18T10:00:00Z',
    history: [], shipments: [], invoices: [], creditMemos: [], totals: TOTALS({ rewardPoints: 10, amountDue: 34.99 }), rewardPointsSpent: 1000, rewardPointsAmount: 10, rewardPointsEarned: null, ...extra,
  })
  const confirmation = <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />

  it('checkout: "Use all" applies the most points allowed; the summary and the order show them', SLOW, async () => {
    signIn()
    seedCart()
    const fetchMock = mockFetch({
      ...ME,
      ...CATALOG(),
      'GET /api/shop/me/wishlist': { body: { items: [], shared: false } },
      'GET /api/shop/me/addresses': { body: { addresses: [HOME] } },
      'POST /api/shop/cart/validate': (url, init) => {
        const points = JSON.parse(init.body).rewardPoints
        return points
          ? { body: CART({ rewards: REWARDS({ appliedPoints: points, appliedAmount: points / 100 }), rewardPoints: { points, amount: points / 100 }, totals: TOTALS({ rewardPoints: points / 100, amountDue: 44.99 - points / 100 }) }) }
          : { body: CART({ rewards: REWARDS() }) }
      },
      'POST /api/shop/orders': { status: 201, body: ORDER() },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })

    const field = await screen.findByLabelText('Use reward points')
    expect(field).toHaveAccessibleDescription('You have 1,250 pts (worth $12.50). Up to 1,000 pts can be used on this order, at least 100 pts at a time.')
    await user.type(field, '50{Enter}')
    expect(field).toHaveAccessibleDescription(/Use at least 100 pts at a time./)

    await user.click(screen.getByRole('button', { name: 'Use all' }))
    const summary = screen.getByRole('complementary', { name: 'Order summary' })
    expect(await within(summary).findByText('Reward points (1,000 pts)')).toBeInTheDocument()
    expect(within(summary).getByText('Reward points (1,000 pts)').nextSibling).toHaveTextContent('−$10.00')
    expect(lastSent(fetchMock, 'POST', '/api/shop/cart/validate')).toMatchObject({ rewardPoints: 1000 })
    expect(screen.getByText(/Your reward points pay \$10.00; the remaining \$34.99 is paid as chosen above./)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Place order · $34.99' }))
    expect(await screen.findByRole('heading', { name: /Thank you/ })).toBeInTheDocument()
    expect(lastSent(fetchMock, 'POST', '/api/shop/orders')).toMatchObject({ rewardPoints: 1000, paymentMethod: 'cod', expectedTotal: 44.99 })
    expect(screen.getByText('1,000 pts paid $10.00.')).toBeInTheDocument()
  })

  it('points that pay everything need no other payment: the order goes as "reward_points"', SLOW, async () => {
    signIn()
    seedCart()
    const fetchMock = mockFetch({
      ...ME,
      ...CATALOG(),
      'GET /api/shop/me/wishlist': { body: { items: [], shared: false } },
      'GET /api/shop/me/addresses': { body: { addresses: [HOME] } },
      'POST /api/shop/cart/validate': (url, init) =>
        JSON.parse(init.body).rewardPoints
          ? { body: CART({ rewards: REWARDS({ balance: 9000, maxPoints: 4499, minRedeem: 0, appliedPoints: 4499, appliedAmount: 44.99 }), rewardPoints: { points: 4499, amount: 44.99 }, totals: TOTALS({ rewardPoints: 44.99, amountDue: 0 }) }) }
          : { body: CART({ rewards: REWARDS({ balance: 9000, maxPoints: 4499, minRedeem: 0 }) }) },
      'POST /api/shop/orders': { status: 201, body: ORDER({ paymentStatus: 'paid', paymentMethod: 'reward_points', totals: TOTALS({ rewardPoints: 44.99, amountDue: 0 }), rewardPointsSpent: 4499, rewardPointsAmount: 44.99 }) },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout', extraRoutes: confirmation })
    await user.click(await screen.findByRole('button', { name: 'Use all' }))
    expect(await screen.findByText('Your reward points pay for the whole order: no other payment is needed.')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Place order · $0.00' }))
    await screen.findByRole('heading', { name: /Thank you/ })
    expect(lastSent(fetchMock, 'POST', '/api/shop/orders')).toMatchObject({ paymentMethod: 'reward_points', rewardPoints: 4499 })
    expect(screen.getByText('Paid in full with reward points. Thank you.')).toBeInTheDocument()
  })

  it('a refusal from the server is shown and blocks the order until the points are removed', SLOW, async () => {
    signIn()
    seedCart()
    mockFetch({
      ...ME,
      ...CATALOG(),
      'GET /api/shop/me/wishlist': { body: { items: [], shared: false } },
      'GET /api/shop/me/addresses': { body: { addresses: [HOME] } },
      'POST /api/shop/cart/validate': (url, init) =>
        JSON.parse(init.body).rewardPoints ? { body: CART({ rewards: REWARDS(), rewardPointsError: 'You can use at most 900 points on this order.' }) } : { body: CART({ rewards: REWARDS() }) },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await user.click(await screen.findByRole('button', { name: 'Use all' }))
    expect(await screen.findByText(/— You can use at most 900 points on this order./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Place order/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Stop using reward points' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Place order · $44.99' })).toBeEnabled())
  })

  it('guests and stores without points see no points field', async () => {
    seedCart()
    mockFetch({ ...CATALOG(), 'POST /api/shop/cart/validate': { body: CART() } })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByRole('button', { name: 'Place order · $44.99' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Use reward points')).not.toBeInTheDocument()
  })

  it('the account page shows the balance, its value, and the history; the account menu links to it when points are on', async () => {
    signIn()
    const fetchMock = mockFetch({
      ...ME,
      ...CATALOG(STORE({ rewards: { enabled: true, earn_rate: '1.00', point_value: '0.0100', min_redeem: 100 } })),
      'GET /api/shop/me/wishlist': { body: { items: [], shared: false } },
      'GET /api/shop/me/rewards': {
        body: {
          enabled: true, balance: 1250, value: 12.5, pointValue: 0.01, total: 2, page: 1, perPage: 20, lastPage: 1,
          transactions: [
            { id: 3, points: -500, balanceAfter: 1250, type: 'spend', orderNumber: 'BN-100004', note: null, createdAt: '2026-11-18T09:00:00Z' },
            { id: 2, points: 1750, balanceAfter: 1750, type: 'earn', orderNumber: 'BN-100001', note: null, createdAt: '2026-11-10T09:00:00Z' },
          ],
        },
      },
    })
    renderWithProviders(
      <Routes>
        <Route path="/account" element={<AccountLayout />}>
          <Route path="rewards" element={<RewardsPage />} />
        </Route>
      </Routes>,
      { route: '/account/rewards' },
    )
    expect(await screen.findByText('1,250 pts')).toBeInTheDocument()
    expect(screen.getByText('Worth $12.50 at checkout')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Reward points history, newest first' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Nov 18, 2026', 'Used on an order (BN-100004)', '−500', '1,250'])
    expect(within(rows[1]).getByRole('link', { name: 'BN-100001' })).toHaveAttribute('href', '/account/orders/BN-100001')
    expect(await screen.findByRole('link', { name: 'Reward points' })).toHaveAttribute('href', '/account/rewards')
    expect(calls(fetchMock, 'GET', '/api/shop/me/rewards')).toHaveLength(1)
  })

  it('order details show the points spent and earned', async () => {
    signIn()
    mockFetch({
      ...ME,
      ...CATALOG(),
      'GET /api/shop/me/wishlist': { body: { items: [], shared: false } },
      'GET /api/shop/orders/BN-100009': { body: ORDER({ paymentStatus: 'paid', rewardPointsEarned: 34 }) },
    })
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100009', path: '/account/orders/:orderId' })
    expect(await screen.findByText('1,000 pts paid $10.00.')).toBeInTheDocument()
    expect(screen.getByText('You earned 34 pts with this order.')).toBeInTheDocument()
    expect(screen.getByText('Reward points (1,000 pts)').nextSibling).toHaveTextContent('−$10.00')
  })
})
