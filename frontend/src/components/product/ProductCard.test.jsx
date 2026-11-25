import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
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

  it('says before the click when a product has a minimum order (it adds that many at once)', () => {
    const { unmount } = renderWithProviders(<ProductCard product={{ ...iphone13, stock: 50, minimumOrderQuantity: 4 }} onAddToCart={vi.fn()} />)
    expect(screen.getByText('Minimum order: 4 (adds 4 at once)')).toBeInTheDocument()
    unmount()
    renderWithProviders(<ProductCard product={{ ...iphone13, stock: 50, minimumOrderQuantity: 1 }} onAddToCart={vi.fn()} />)
    expect(screen.queryByText(/Minimum order/)).not.toBeInTheDocument()
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

  // 2026 redesign
  it('grid: a round quick-add button keeps the name "Add to cart"; list: the text button', () => {
    const { unmount } = renderWithProviders(<ProductCard product={iphone13} onAddToCart={vi.fn()} />)
    const quick = screen.getByRole('button', { name: 'Add to cart' })
    expect(quick).toHaveClass('product-card__quick-add', 'btn--icon')
    expect(quick.closest('.product-card__buy')).not.toBeNull()
    unmount()
    renderWithProviders(<ProductCard product={iphone13} layout="list" onAddToCart={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Add to cart' })
    expect(button).not.toHaveClass('product-card__quick-add')
    expect(button).toHaveTextContent('Add to cart')
  })

  it('configurable products keep "Choose options" (no quick add)', () => {
    renderWithProviders(<ProductCard product={{ ...iphone13, hasVariants: true }} onAddToCart={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Choose options for iPhone 13 Pro' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument()
  })

  it('shows a "New" badge only when asked', () => {
    const { unmount } = renderWithProviders(<ProductCard product={iphone13} />)
    expect(screen.queryByText('New')).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<ProductCard product={iphone13} isNew />)
    expect(screen.getByText('New')).toHaveClass('product-badge--info')
  })

  it('a mouse hover brings in the second photo (not touch), without another <img>', () => {
    const product = { ...iphone13, thumbnail: 'https://img.test/1.webp', images: ['https://img.test/1.webp', 'https://img.test/2.webp'] }
    const { container } = renderWithProviders(<ProductCard product={product} />)
    const card = container.querySelector('.product-card')
    fireEvent.pointerEnter(card, { pointerType: 'touch' })
    expect(container.querySelector('.product-card__alt-photo')).toBeNull()
    fireEvent.pointerEnter(card, { pointerType: 'mouse' })
    const alt = container.querySelector('.product-card__alt-photo')
    expect(alt).toHaveAttribute('aria-hidden', 'true')
    expect(alt.style.backgroundImage).toContain('https://img.test/2.webp')
    expect(container.querySelectorAll('.product-card__media img')).toHaveLength(1)
  })

  it('no second photo when the product has only one', () => {
    const { container } = renderWithProviders(<ProductCard product={{ ...iphone13, images: [iphone13.thumbnail] }} />)
    fireEvent.pointerEnter(container.querySelector('.product-card'), { pointerType: 'mouse' })
    expect(container.querySelector('.product-card__alt-photo')).toBeNull()
  })
})
