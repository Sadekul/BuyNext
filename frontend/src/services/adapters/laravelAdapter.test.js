import { describe, expect, it } from 'vitest'
import { normalizeCategories, normalizeProductDetail, normalizeProductPage } from './laravelAdapter'

const resource = {
  id: 123,
  name: 'iPhone 13 Pro',
  description: 'Phone',
  brand: { name: 'Apple' },
  category: { slug: 'smartphones', name: 'Smartphones' },
  price: '1099.99',
  discount_percent: 9.37,
  rating_average: '4.12',
  stock_quantity: 56,
  availability: 'low_stock',
  min_order_quantity: 2,
  thumbnail_url: 'https://img.test/t.webp',
  images: [{ url: 'https://img.test/1.webp', alt: '' }],
  reviews: [{ rating: 5, comment: 'Great', created_at: '2026-01-01T00:00:00Z', author_name: 'Ada' }],
}

describe('Laravel adapter (API contract → BuyNest shapes)', () => {
  it('converts a ProductResource', () => {
    expect(normalizeProductDetail({ data: resource })).toMatchObject({
      id: 123,
      title: 'iPhone 13 Pro',
      brand: 'Apple',
      category: 'smartphones',
      price: 1099.99, // decimal string → number
      rating: 4.12,
      availabilityStatus: 'Low Stock',
      minimumOrderQuantity: 2,
      images: ['https://img.test/1.webp'],
      reviews: [{ rating: 5, comment: 'Great', date: '2026-01-01T00:00:00Z', reviewerName: 'Ada' }],
    })
  })

  it('keeps missing optional data as null instead of inventing it', () => {
    const product = normalizeProductDetail({ data: { ...resource, brand: null, rating_average: null, availability: 'unknown' } })
    expect(product).toMatchObject({ brand: null, rating: null, availabilityStatus: null })
  })

  it('converts paginated collections and categories', () => {
    const page = normalizeProductPage({ data: [resource], meta: { current_page: 3, per_page: 12, total: 30 } })
    expect(page).toMatchObject({ total: 30, skip: 24, limit: 12 })
    expect(normalizeCategories({ data: [{ slug: 'a', name: 'A', image_url: null }] })).toEqual([{ slug: 'a', name: 'A', parentSlug: null, depth: 0 }])
  })
})
