import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import ProductGrid from './ProductGrid'
import { renderWithProviders } from '../../test/renderWithProviders'
import { galaxyS8, iphone13, tennisRacket } from '../../test/fixtures'

describe('ProductGrid', () => {
  it('renders one list item per product, in order', () => {
    renderWithProviders(<ProductGrid products={[iphone13, galaxyS8, tennisRacket]} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'iPhone 13 Pro',
      'Samsung Galaxy S8',
      'Tennis Racket',
    ])
  })

  it('shows an empty state instead of an empty list', () => {
    renderWithProviders(<ProductGrid products={[]} emptyTitle="Nothing here" />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument()
  })

  it('switches to the list layout', () => {
    renderWithProviders(<ProductGrid products={[iphone13]} layout="list" />)
    expect(screen.getByRole('list')).toHaveClass('product-grid--list')
  })
})
