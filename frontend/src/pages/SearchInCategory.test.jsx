import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, useLocation } from 'react-router'
import ProductListingPage from './ProductListingPage'
import SearchBar from '../components/common/SearchBar'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { galaxyS8, iphone13, productListResponse, tennisRacket } from '../test/fixtures'

// Phase 17 §3.3: the header search's "Search in" select, and a search within one category (demo: DummyJSON's
// search can't do it, so its results are narrowed in the browser).
const categories = { body: [{ slug: 'smartphones', name: 'Smartphones', url: '' }, { slug: 'sports-accessories', name: 'Sports Accessories', url: '' }] }

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

describe('search within a category', () => {
  it('"Search in" adds the category to the search address; "All categories" doesn’t', async () => {
    mockFetch({ 'GET /products/search': { body: productListResponse([]) } })
    const user = userEvent.setup()
    const options = [{ slug: 'smartphones', name: 'Smartphones' }]
    const view = renderWithProviders(<SearchBar categories={options} />, { path: '/', extraRoutes: <Route path="*" element={<LocationProbe />} /> })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Search in' }), 'smartphones')
    await user.type(screen.getByRole('combobox', { name: 'Search products' }), 'red phone{Enter}')
    expect(await screen.findByTestId('location')).toHaveTextContent('/products?q=red%20phone&category=smartphones')
    view.unmount()

    renderWithProviders(<SearchBar categories={options} />, { path: '/', extraRoutes: <Route path="*" element={<LocationProbe />} /> })
    expect(screen.getByRole('combobox', { name: 'Search in' })).toHaveDisplayValue('All categories')
    await user.type(screen.getByRole('combobox', { name: 'Search products' }), 'red{Enter}')
    expect(await screen.findByTestId('location')).toHaveTextContent(/^\/products\?q=red$/)
  })

  it('without categories there is no select (the phone search box)', () => {
    renderWithProviders(<SearchBar />)
    expect(screen.queryByRole('combobox', { name: 'Search in' })).not.toBeInTheDocument()
  })

  it('the results page: only that category, a heading naming it, and a chip that searches everywhere', async () => {
    mockFetch({ 'GET /products/search': { body: productListResponse([iphone13, galaxyS8, tennisRacket]) }, 'GET /products/categories': categories })
    const user = userEvent.setup()
    renderWithProviders(<ProductListingPage />, { route: '/products?q=a&category=smartphones', path: '/products' })
    expect(await screen.findByRole('heading', { name: 'Results for "a" in Smartphones', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Showing 1–2 of 2 products')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Remove filter: Category: Smartphones/ }))
    expect(await screen.findByRole('heading', { name: 'Results for "a"', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Showing 1–3 of 3 products')).toBeInTheDocument()
  })
})
