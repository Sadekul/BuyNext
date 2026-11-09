import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductCard from './ProductCard'
import { renderWithProviders } from '../../test/renderWithProviders'
import { galaxyS8, iphone13, tennisRacket } from '../../test/fixtures'

describe('ProductCard', () => {
  it('shows title link, brand, rating, sale and original price, and a sale badge', () => {
    renderWithProviders(<ProductCard product={iphone13} onAddToCart={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'iPhone 13 Pro' })).toHaveAttribute('href', '/products/123')
    expect(screen.getByText('Apple')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Rated 4.1 out of 5' })).toBeInTheDocument()
    expect(screen.getByText('$996.92')).toBeInTheDocument()
    expect(screen.getByText('$1,099.99').tagName).toBe('S') // struck-through original price
    expect(screen.queryByText('-9%')).not.toBeInTheDocument() // below the 10% badge threshold
  })

  it('shows a discount badge from 10% and a low-stock badge', () => {
    renderWithProviders(<ProductCard product={tennisRacket} />)
    expect(screen.getByText('-20%')).toBeInTheDocument()
    expect(screen.getByText('Low stock')).toBeInTheDocument()
  })

  it('does not invent a brand when the API has none', () => {
    renderWithProviders(<ProductCard product={tennisRacket} />)
    expect(screen.queryByText(/apple|samsung/i)).not.toBeInTheDocument()
  })

  it('reports "Add to cart" clicks with the product', async () => {
    const onAddToCart = vi.fn()
    renderWithProviders(<ProductCard product={iphone13} onAddToCart={onAddToCart} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(onAddToCart).toHaveBeenCalledWith(iphone13)
  })

  it('disables buying when sold out', () => {
    renderWithProviders(<ProductCard product={galaxyS8} onAddToCart={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sold out' })).toBeDisabled()
    expect(screen.getByText('Out of stock')).toBeInTheDocument()
  })

  it('only renders optional actions when their handlers are provided', () => {
    renderWithProviders(<ProductCard product={iphone13} />)
    expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /quick view/i })).not.toBeInTheDocument()
  })

  it('toggles the wishlist heart (aria-pressed) through the wishlist context', async () => {
    renderWithProviders(<ProductCard product={iphone13} />)
    const heart = screen.getByRole('button', { name: 'Save iPhone 13 Pro to wishlist' })
    expect(heart).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(heart)
    expect(screen.getByRole('button', { name: 'Remove iPhone 13 Pro from wishlist' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows category and availability in list layout', () => {
    renderWithProviders(<ProductCard product={iphone13} layout="list" />)
    const card = screen.getByRole('article')
    expect(within(card).getByText('Smartphones')).toBeInTheDocument()
    expect(within(card).getByText('In Stock')).toBeInTheDocument()
    expect(within(card).getByText('Save 9%')).toBeInTheDocument()
  })
})
