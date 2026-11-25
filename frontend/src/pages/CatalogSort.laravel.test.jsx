import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductListingPage from './ProductListingPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { switchToBangla } from '../test/i18n'

// Phase 17: the catalog's "Best selling" and "Newest" sorts with BuyNest's API (the home page's "View all" targets).
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const resource = (id, name) => ({ id, name, price: '10.00', discount_percent: 0, stock_quantity: 5, availability: 'in_stock', rating_average: 5 - id / 10, category: { slug: 'beauty' } })
// The API's own order for each sort (the client must keep it: it has no sales or dates to sort by).
const ORDERS = {
  best_selling: [resource(3, 'Gamma'), resource(1, 'Alpha'), resource(2, 'Beta')],
  newest: [resource(2, 'Beta'), resource(3, 'Gamma'), resource(1, 'Alpha')],
  none: [resource(1, 'Alpha'), resource(2, 'Beta'), resource(3, 'Gamma')],
}

function catalog() {
  return mockFetch({
    'GET /api/catalog/products': (url) => {
      const items = ORDERS[url.searchParams.get('sort') ?? 'none'] ?? ORDERS.none
      return { body: { data: items, meta: { current_page: 1, per_page: 100, total: items.length } } }
    },
    'GET /api/catalog/categories': { body: { data: [{ slug: 'beauty', name: 'Beauty', children: [] }] } },
    'GET /api/catalog/store': { status: 404, body: {} },
  })
}
const titles = () => screen.getAllByRole('article').map((card) => within(card).getByRole('heading').textContent)
const productRequests = (fetchMock) =>
  fetchMock.mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname === '/api/catalog/products').map((url) => Object.fromEntries(url.searchParams))

describe('catalog sort: Best selling and Newest (BuyNest API)', () => {
  it('?sort=best-selling asks the API for sort=best_selling and keeps its order', async () => {
    const fetchMock = catalog()
    renderWithProviders(<ProductListingPage />, { route: '/products?sort=best-selling', path: '/products' })
    await waitFor(() => expect(titles()).toEqual(['Gamma', 'Alpha', 'Beta']))
    expect(screen.getByLabelText('Sort by')).toHaveValue('best-selling')
    expect(productRequests(fetchMock)).toContainEqual(expect.objectContaining({ sort: 'best_selling', direction: 'desc' }))
  })

  it('offers both in the sort menu; choosing Newest writes ?sort=newest and asks for sort=newest', async () => {
    const fetchMock = catalog()
    const user = userEvent.setup()
    renderWithProviders(<ProductListingPage />, { route: '/products', path: '/products' })
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Beta', 'Gamma']))
    const select = screen.getByLabelText('Sort by')
    expect(within(select).getAllByRole('option').map((option) => option.textContent).slice(-2)).toEqual(['Best selling', 'Newest'])
    await user.selectOptions(select, 'newest')
    await waitFor(() => expect(titles()).toEqual(['Beta', 'Gamma', 'Alpha']))
    expect(productRequests(fetchMock)).toContainEqual(expect.objectContaining({ sort: 'newest', direction: 'desc' }))
  })

  it('labels them in Bangla', async () => {
    catalog()
    await switchToBangla()
    renderWithProviders(<ProductListingPage />, { route: '/products?sort=newest', path: '/products' })
    const select = await screen.findByRole('combobox')
    expect(within(select).getByRole('option', { name: 'সর্বাধিক বিক্রিত' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'সবচেয়ে নতুন' }).selected).toBe(true)
  })
})
