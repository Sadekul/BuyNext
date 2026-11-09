import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, useLocation } from 'react-router'
import SearchBar from './SearchBar'
import { renderWithProviders } from '../../test/renderWithProviders'
import { mockFetch } from '../../test/mockFetch'
import { iphone13, productListResponse } from '../../test/fixtures'

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

const renderSearch = () =>
  renderWithProviders(<SearchBar />, {
    path: '/',
    extraRoutes: <Route path="*" element={<LocationProbe />} />,
  })

describe('SearchBar (search functionality)', () => {
  it('debounces suggestions: one request for a burst of typing', async () => {
    const fetchMock = mockFetch({ 'GET /products/search': { body: productListResponse([iphone13]) } })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('combobox', { name: 'Search products' }), 'iphone')
    const option = await screen.findByRole('option', { name: /iPhone 13 Pro/ })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0].toString()).toContain('q=iphone')
    expect(option.querySelector('mark')).toHaveTextContent('iPhone')
  })

  it('does not request suggestions for a single character', async () => {
    const fetchMock = mockFetch({})
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('combobox'), 'a')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens the highlighted suggestion with ArrowDown + Enter', async () => {
    mockFetch({ 'GET /products/search': { body: productListResponse([iphone13]) } })
    const user = userEvent.setup()
    renderSearch()
    const input = screen.getByRole('combobox')
    await user.type(input, 'iph')
    await screen.findByRole('option')
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('location')).toHaveTextContent('/products/123')
  })

  it('submits a full search to /products?q=', async () => {
    mockFetch({ 'GET /products/search': { body: productListResponse([]) } })
    const user = userEvent.setup()
    renderSearch()
    await user.type(screen.getByRole('combobox'), 'red shoes{Enter}')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/products?q=red%20shoes'))
  })
})
