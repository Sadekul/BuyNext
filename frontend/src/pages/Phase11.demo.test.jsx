import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes } from 'react-router'
import ComparePage from './ComparePage'
import HomePage from './HomePage'
import ProductDetailsPage from './ProductDetailsPage'
import WishlistPage from './WishlistPage'
import ProductGrid from '../components/product/ProductGrid'
import CompareBar from '../components/layout/CompareBar'
import CurrencyPicker from '../components/layout/CurrencyPicker'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { galaxyS8, iphone13, productById, productDetailResponse, productListResponse, tennisRacket } from '../test/fixtures'

// Phase 11 in the DummyJSON demo (docs/backend/PHASE11_CONTRACT.md): compare and recently viewed work in
// the browser; no sharing, no currency picker, no up-sells or cross-sells; related products as before.

const FIVE = [iphone13, galaxyS8, tennisRacket, productById(78), productById(100)]

describe('compare in the demo (§2)', () => {
  it('cards add up to 4 products; a 5th is explained by the compare bar; Clear empties it', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <ProductGrid products={FIVE} />
        <CompareBar />
      </>,
    )
    expect(screen.queryByRole('complementary', { name: 'Compare products' })).not.toBeInTheDocument()
    for (const product of FIVE.slice(0, 4)) await user.click(screen.getByRole('button', { name: `Compare ${product.title}` }))
    const bar = screen.getByRole('complementary', { name: 'Compare products' })
    expect(within(bar).getByRole('link', { name: 'Compare (4)' })).toHaveAttribute('href', '/compare')
    expect(screen.getByRole('button', { name: `Compare ${iphone13.title}` })).toHaveAttribute('aria-pressed', 'true')

    const fifth = screen.getByRole('button', { name: `Compare ${FIVE[4].title}` })
    await user.click(fifth)
    expect(fifth).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'You can compare up to 4 products. Remove one to add another.')).toBe(true)
    expect(JSON.parse(window.localStorage.getItem('buynest.compare.v1')).items.map((item) => item.id)).toEqual(FIVE.slice(0, 4).map((product) => product.id))

    // Pressing a picked product again takes it out.
    await user.click(screen.getByRole('button', { name: `Compare ${iphone13.title}` }))
    expect(within(bar).getByRole('link', { name: 'Compare (3)' })).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Clear compare list' }))
    expect(screen.queryByRole('complementary', { name: 'Compare products' })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('buynest.compare.v1')).items).toEqual([])
  })

  it('the compare page loads each DummyJSON product: no specification rows, "—" for what the demo doesn’t know', async () => {
    window.localStorage.setItem('buynest.compare.v1', JSON.stringify({ items: [{ id: 123, title: iphone13.title }, { id: 152, title: tennisRacket.title }, { id: 999, title: 'Gone' }] }))
    mockFetch({
      'GET /products/123': { body: productDetailResponse() },
      'GET /products/152': { body: { ...tennisRacket, reviews: [] } },
      'GET /products/999': { status: 404, body: { message: 'Product with id 999 not found' } },
    })
    renderWithProviders(<ComparePage />, { route: '/compare', path: '/compare' })
    const table = await screen.findByRole('table', { name: 'Comparing 2 products' })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([iphone13.title, tennisRacket.title])
    expect(within(table).getAllByRole('rowheader').map((header) => header.textContent)).toEqual(['Image', 'Price', 'Rating', 'Stock', 'Brand', 'Category', 'Weight', 'Options', 'Actions'])
    const row = (name) => within(within(table).getByRole('rowheader', { name }).closest('tr')).getAllByRole('cell').map((cell) => cell.textContent)
    expect(row('Brand')).toEqual(['Apple', '—'])
    expect(row('Weight')).toEqual(['—', '—'])
    expect(row('Category')).toEqual(['Smartphones', 'Sports Accessories'])
    expect(screen.getByText('One product is no longer available and was left out.')).toBeInTheDocument()
  })

  it('nothing picked yet: says how to start', () => {
    const fetchMock = mockFetch({})
    renderWithProviders(<ComparePage />, { route: '/compare', path: '/compare' })
    expect(screen.getByRole('heading', { level: 1, name: 'Nothing to compare yet' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('recently viewed (§6) and the demo product page', () => {
  it('remembers products opened in this browser and shows them on the next product page (not itself), with Clear', async () => {
    mockFetch({
      'GET /products/123': { body: productDetailResponse() },
      'GET /products/152': { body: { ...tennisRacket, description: 'A racket.', reviews: [] } },
      'GET /products/category/smartphones': { body: productListResponse([]) },
      'GET /products/category/sports-accessories': { body: productListResponse([]) },
      'GET /products/categories': { body: [] },
    })
    const user = userEvent.setup()
    renderWithProviders(
      <Routes>
        <Route
          path="/products/:productId"
          element={
            <>
              <Link to="/products/152">Next product</Link>
              <ProductDetailsPage />
            </>
          }
        />
      </Routes>,
      { route: '/products/123' },
    )
    expect(await screen.findByRole('heading', { level: 1, name: iphone13.title })).toBeInTheDocument()
    // The demo has no specifications table and no up-sells; its own details stay.
    expect(screen.queryByRole('region', { name: 'Specifications' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'You may also like' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Product details' })).toHaveTextContent('SMA-APP-IPH-123')
    expect(screen.queryByRole('region', { name: 'Recently viewed' })).not.toBeInTheDocument() // only itself so far

    await user.click(screen.getByRole('link', { name: 'Next product' }))
    expect(await screen.findByRole('heading', { level: 1, name: tennisRacket.title })).toBeInTheDocument()
    const recent = await screen.findByRole('region', { name: 'Recently viewed' })
    expect(within(recent).getAllByRole('article').map((card) => within(card).getByRole('heading').textContent)).toEqual([iphone13.title])
    await user.click(within(recent).getByRole('button', { name: 'Clear recently viewed products' }))
    expect(screen.queryByRole('region', { name: 'Recently viewed' })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('buynest.recentlyViewed.v1') ?? '[]')).toEqual([])
  })

  it('the home page shows the recently viewed row', async () => {
    window.localStorage.setItem('buynest.recentlyViewed.v1', JSON.stringify([{ id: 152, title: tennisRacket.title, price: tennisRacket.price, discountPercentage: 0, rating: 4, stock: 3, thumbnail: null }]))
    mockFetch({ 'GET /products': { body: productListResponse([iphone13]) }, 'GET /products/categories': { body: [] } })
    renderWithProviders(<HomePage />)
    const recent = await screen.findByRole('region', { name: 'Recently viewed' })
    expect(within(recent).getByRole('link', { name: tennisRacket.title })).toHaveAttribute('href', '/products/152')
    expect(within(recent).getByRole('button', { name: /Add to cart/ })).toBeInTheDocument()
  })
})

describe('demo: nothing that needs BuyNest’s API', () => {
  it('no share panel or notes on the wishlist; the demo note stays', () => {
    window.localStorage.setItem('buynest.wishlist.v1', JSON.stringify({ items: [{ productId: 123, title: iphone13.title, price: 1099.99, addedAt: 1 }] }))
    mockFetch({ 'GET /products': { body: productListResponse([iphone13]) } })
    renderWithProviders(<WishlistPage />, { route: '/wishlist', path: '/wishlist' })
    expect(screen.getByText(/Saved on this device only/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Share my wishlist' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument()
  })

  it('no currency picker (and no request for one)', () => {
    const fetchMock = mockFetch({})
    renderWithProviders(<CurrencyPicker />)
    expect(screen.queryByLabelText('Show prices in')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
