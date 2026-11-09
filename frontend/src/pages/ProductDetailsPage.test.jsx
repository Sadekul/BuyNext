import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import ProductDetailsPage from './ProductDetailsPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { productDetailResponse, productListResponse } from '../test/fixtures'

const renderAt = (route) => renderWithProviders(<ProductDetailsPage />, { route, path: '/products/:productId' })

describe('ProductDetailsPage', () => {
  it('renders the product, its reviews, and no reviewer emails', async () => {
    mockFetch({
      'GET /products/123': { body: productDetailResponse() },
      'GET /products/category/smartphones': { body: productListResponse([]) },
    })
    renderAt('/products/123')
    expect(await screen.findByRole('heading', { level: 1, name: 'iPhone 13 Pro' })).toBeInTheDocument()
    expect(screen.getByText('Great!')).toBeInTheDocument()
    expect(screen.queryByText(/ada@x\.test/)).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('HomeSmartphonesiPhone 13 Pro')
  })

  it('shows "Product not found" for a 404 and for invalid ids (no request)', async () => {
    const fetchMock = mockFetch({ 'GET /products/999': { status: 404, body: { message: 'not found' } } })
    renderAt('/products/999')
    expect(await screen.findByRole('heading', { name: 'Product not found' })).toBeInTheDocument()

    fetchMock.mockClear()
    renderAt('/products/abc')
    expect((await screen.findAllByRole('heading', { name: 'Product not found' })).length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a retryable error for server failures', async () => {
    mockFetch({ 'GET /products/5': { status: 503, body: { message: 'Down for maintenance' } } })
    renderAt('/products/5')
    expect(await screen.findByRole('alert')).toHaveTextContent('Down for maintenance')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
