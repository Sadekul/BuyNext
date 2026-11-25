import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import HomePage from './HomePage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'

// Phase 17 (docs/backend/PHASE17_CONTRACT.md §4): the marketplace-style home page with BuyNest's API.
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))

const resource = (id, changes = {}) => ({
  id,
  name: `Product ${id}`,
  price: '100.00',
  discount_percent: id % 2 === 0 ? 20 : 0,
  sale_price: id % 2 === 0 ? '80.00' : '100.00',
  stock_quantity: 10,
  availability: 'in_stock',
  rating_average: 4.5,
  category: { slug: 'beauty' },
  ...changes,
})
const PRODUCTS = Array.from({ length: 8 }, (_, index) => resource(index + 1))
const page = (items) => ({ body: { data: items, meta: { current_page: 1, per_page: 100, total: items.length } } })
const HERO = { eyebrow: 'Winter edit', title: 'Cosy up your nest.', description: 'Warm lights.', primary_cta: null, secondary_cta: null, image_url: null, image_alt: '', highlights: [] }
const BANNER = (id) => ({ id, eyebrow: '', title: `Banner ${id}`, description: '', cta: null, image_url: null, image_alt: '', tone: 'navy', position: id, is_active: true })
const home = (changes) => ({ body: { data: { hero: HERO, banners: [1, 2, 3, 4].map(BANNER), featured_products: [], ...changes } } })

// sort=best_selling: `units_sold` per item and `meta.has_sales` (phase 17); `sales` = units per item, in order.
function bestSelling(sales) {
  const items = PRODUCTS.slice(0, 6).map((product, index) => ({ ...product, units_sold: sales[index] ?? 0 }))
  return { body: { data: items, meta: { current_page: 1, per_page: 12, total: items.length, has_sales: sales.some((units) => units > 0) } } }
}

function shop(homeAnswer, sales = [9, 5, 2]) {
  return mockFetch({
    'GET /api/catalog/products': (url) => {
      const sort = url.searchParams.get('sort')
      if (sort === 'best_selling') return bestSelling(sales)
      return page(sort ? PRODUCTS.slice(0, 6) : PRODUCTS)
    },
    'GET /api/catalog/categories': { body: { data: [{ slug: 'beauty', name: 'Beauty', image_url: null }] } },
    'GET /api/catalog/home': homeAnswer,
    'GET /api/catalog/store': { status: 404, body: {} },
  })
}
const sortsAsked = (fetchMock) =>
  fetchMock.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname === '/api/catalog/products' && url.searchParams.get('sort')).map((url) => url.searchParams.get('sort'))

describe('marketplace home page (BuyNest API)', () => {
  it('shows the sections in the contract order, with all four rankings and the real coupon', async () => {
    const fetchMock = shop(home({ top_bar: { message: 'Save 10% today', coupon_code: 'SAVE10' } }))
    renderWithProviders(<HomePage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Cosy up your nest.' })).toBeInTheDocument()
    const offers = screen.getByRole('region', { name: 'Top offers' })
    expect(within(offers).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Banner 1', 'Banner 2'])
    const promotions = screen.getByRole('region', { name: 'Promotions' })
    expect(within(promotions).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Banner 3', 'Banner 4'])

    await waitFor(() => expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Best selling', 'Trending', 'New arrivals', 'On sale']))
    const lists = await screen.findByRole('region', { name: 'Product highlights' })
    await waitFor(() => expect(within(lists).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Best selling', 'Top rated', 'On sale', 'New']))
    // Only the three products that sold (fewer than four rows is fine), in the API's order.
    const sellers = within(lists).getByRole('region', { name: 'Best selling' })
    expect(within(sellers).getAllByRole('listitem').map((row) => within(row).getAllByRole('link')[0].textContent)).toEqual(['Product 1', 'Product 2', 'Product 3'])
    expect(within(sellers).getByRole('link', { name: 'View all: Best selling' })).toHaveAttribute('href', '/products?sort=best-selling')
    // The tab and its list share one request per ranking.
    await waitFor(() => expect(sortsAsked(fetchMock).toSorted()).toEqual(['best_selling', 'discount', 'newest', 'rating']))

    const coupon = await screen.findByRole('region', { name: 'Save 10% today' })
    expect(within(coupon).getByRole('button', { name: 'Copy coupon code SAVE10' })).toBeInTheDocument()

    // Order on the page: hero row, categories, top products, promo row, lists, deals, coupon.
    const order = [
      screen.getByRole('heading', { level: 1 }),
      screen.getByRole('region', { name: 'Shop by category' }),
      screen.getByRole('region', { name: 'Top products' }),
      promotions,
      lists,
      await screen.findByRole('region', { name: 'Big savings, in stock now' }),
      coupon,
    ]
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('shows no coupon banner without a coupon code, or without the top strip at all', async () => {
    shop(home({ top_bar: { message: 'Free delivery this week', coupon_code: null } }))
    const { unmount } = renderWithProviders(<HomePage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Cosy up your nest.' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy coupon code/ })).not.toBeInTheDocument()
    unmount()
    shop(home({ top_bar: null }))
    renderWithProviders(<HomePage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Cosy up your nest.' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy coupon code/ })).not.toBeInTheDocument()
  })

  it('never shows "Best selling" without real sales: no tab, no list, Trending first', async () => {
    const fetchMock = shop(home(), [0, 0, 0])
    renderWithProviders(<HomePage />)
    const lists = await screen.findByRole('region', { name: 'Product highlights' })
    await waitFor(() => expect(within(lists).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Top rated', 'On sale', 'New']))
    expect(sortsAsked(fetchMock)).toContain('best_selling') // asked, and nothing sold
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Trending', 'New arrivals', 'On sale'])
    expect(screen.getByRole('tab', { name: 'Trending' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/Best selling/)).not.toBeInTheDocument()
  })
})
