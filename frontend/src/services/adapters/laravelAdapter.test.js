import { describe, expect, it } from 'vitest'
import { normalizeCategories, normalizeProduct, normalizeProductDetail, normalizeProductPage } from './laravelAdapter'

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

describe('phase 16 fields', () => {
  it('maps option types, swatches, per-value images, price ranges and card swatches', () => {
    const product = normalizeProduct({
      id: 1, name: 'Shirt', price: '20.00',
      images: [{ url: '/a.webp', option_value_id: null }, { url: '/b.webp', option_value_id: '22' }],
      options: [
        { id: 2, name: 'Color', code: 'color', type: 'color', values: [{ id: 21, value: 'Red', swatch: '#cc0000', code: 'red' }, { id: 22, value: 'Blue', swatch: 'blue', code: '' }] },
        { id: 1, name: 'Size', values: [{ id: 11, value: 'S' }] },
      ],
      price_range: { min: '20.00', max: '24.50' },
      swatches: [{ value_id: 21, value: 'Red', swatch: '#CC0000', image_url: '/b.webp' }, { value_id: 22, value: 'Blue', swatch: null }, { nope: true }],
    })
    expect(product.options).toEqual([
      { id: 2, name: 'Color', code: 'color', type: 'color', values: [{ id: 21, value: 'Red', swatch: '#cc0000', code: 'red' }, { id: 22, value: 'Blue', swatch: null, code: null }] },
      { id: 1, name: 'Size', code: null, type: 'text', values: [{ id: 11, value: 'S', swatch: null, code: null }] },
    ])
    expect(product.imageOptionValueIds).toEqual([null, 22])
    expect(product.priceRange).toEqual({ min: 20, max: 24.5 })
    expect(product.swatches).toEqual([
      { valueId: 21, value: 'Red', swatch: '#CC0000', imageUrl: '/b.webp' },
      { valueId: 22, value: 'Blue', swatch: null, imageUrl: null },
    ])
    expect(normalizeProduct({ id: 2, name: 'Mug', price: '5.00', price_range: null })).toMatchObject({ priceRange: null })
    expect(normalizeProduct({ id: 2, name: 'Mug', price: '5.00' })).not.toHaveProperty('swatches')
  })
})

describe('phase 17 best-selling fields', () => {
  it('maps units_sold on list items and meta.has_sales on the page', () => {
    const page = normalizeProductPage({ data: [{ ...resource, units_sold: 7 }, { ...resource, id: 2, units_sold: 0 }], meta: { current_page: 1, per_page: 12, total: 2, has_sales: true } })
    expect(page.hasSales).toBe(true)
    expect(page.items.map((item) => item.unitsSold)).toEqual([7, 0])
  })

  it('leaves both out when the API doesn’t send them (treated as no sales)', () => {
    const page = normalizeProductPage({ data: [resource], meta: { current_page: 1, per_page: 12, total: 1 } })
    expect(page).not.toHaveProperty('hasSales')
    expect(page.items[0]).not.toHaveProperty('unitsSold')
    expect(normalizeProduct({ ...resource, units_sold: null })).not.toHaveProperty('unitsSold')
    expect(normalizeProduct({ ...resource, units_sold: 'x' }).unitsSold).toBe(0)
  })
})
