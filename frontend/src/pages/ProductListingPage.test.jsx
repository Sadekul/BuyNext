import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductListingPage from './ProductListingPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { galaxyS8, iphone13, productListResponse, tennisRacket } from '../test/fixtures'

const categories = { body: [{ slug: 'smartphones', name: 'Smartphones', url: '' }] }
const renderCatalog = (route = '/products') => renderWithProviders(<ProductListingPage />, { route, path: '/products' })

describe('ProductListingPage', () => {
  it('shows a loading skeleton, then the products (loading state)', async () => {
    mockFetch({
      'GET /products': { body: productListResponse([iphone13, galaxyS8, tennisRacket]), delay: 50 },
      'GET /products/categories': categories,
    })
    renderCatalog()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading products…')
    expect(await screen.findByText('Showing 1–3 of 3 products')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('shows an error with a working "Try again" (error state)', async () => {
    let calls = 0
    mockFetch({
      'GET /products': () => (++calls === 1 ? { status: 500, body: { message: 'Database offline' } } : { body: productListResponse([iphone13]) }),
      'GET /products/categories': categories,
    })
    const user = userEvent.setup()
    renderCatalog()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database offline')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Showing 1–1 of 1 products')).toBeInTheDocument()
  })

  it('shows an empty state for a search with no results', async () => {
    mockFetch({ 'GET /products/search': { body: productListResponse([]) }, 'GET /products/categories': categories })
    renderCatalog('/products?q=zzz')
    expect(await screen.findByRole('heading', { name: 'No results for "zzz"' })).toBeInTheDocument()
  })

  it('filters by brand and availability, and chips remove filters (product filters)', async () => {
    mockFetch({
      'GET /products': { body: productListResponse([iphone13, galaxyS8, tennisRacket]) },
      'GET /products/categories': categories,
    })
    const user = userEvent.setup()
    renderCatalog()
    await screen.findByText('Showing 1–3 of 3 products')
    const sidebar = screen.getByRole('complementary', { name: 'Product filters' })

    await user.click(within(sidebar).getByRole('checkbox', { name: /Samsung/ }))
    expect(screen.getByText('Showing 1–1 of 1 products')).toBeInTheDocument()
    await user.click(within(sidebar).getByRole('checkbox', { name: 'Available to order' }))
    expect(screen.getByRole('heading', { name: 'No products match your filters' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove filter: Available to order' }))
    expect(screen.getByText('Showing 1–1 of 1 products')).toBeInTheDocument()
  })

  it('sorts on the client by sale price', async () => {
    mockFetch({
      'GET /products': { body: productListResponse([iphone13, tennisRacket]) },
      'GET /products/categories': categories,
    })
    const user = userEvent.setup()
    renderCatalog()
    await screen.findByText('Showing 1–2 of 2 products')
    await user.selectOptions(screen.getByLabelText('Sort by'), 'price-asc')
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Tennis Racket',
      'iPhone 13 Pro',
    ])
  })
})
