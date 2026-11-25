import { describe, expect, it } from 'vitest'
import { brandLink, pickBrands, pickCategoryTiles, pickDeals } from './homeSections'

const product = (id, changes = {}) => ({ id, title: `P${id}`, category: 'phones', brand: 'Apple', thumbnail: `p${id}.webp`, price: 10, discountPercentage: 0, stock: 5, minimumOrderQuantity: 1, ...changes })

describe('pickCategoryTiles', () => {
  it('puts the configured categories first and picks a photo for each, skipping subcategories and photo-less ones', () => {
    const categories = [
      { slug: 'beauty', name: 'Beauty', image: 'beauty.webp' },
      { slug: 'phones', name: 'Phones' },
      { slug: 'cases', name: 'Cases', parentSlug: 'phones', image: 'cases.webp' },
      { slug: 'books', name: 'Books' },
      { slug: 'laptops', name: 'Laptops' },
    ]
    const tiles = pickCategoryTiles({
      categories,
      products: [product(1), product(2, { category: 'phones', thumbnail: 'second.webp' })],
      configured: [{ slug: 'laptops', image: 'laptop.webp' }, { slug: 'phones' }],
    })
    expect(tiles).toEqual([
      { slug: 'laptops', name: 'Laptops', image: 'laptop.webp' }, // configured image
      { slug: 'phones', name: 'Phones', image: 'p1.webp' }, // its first product's photo
      { slug: 'beauty', name: 'Beauty', image: 'beauty.webp' }, // the category's own image
    ])
  })

  it('stops at the limit and copes with nothing loaded yet', () => {
    const categories = Array.from({ length: 12 }, (_, index) => ({ slug: `c${index}`, name: `C${index}`, image: 'x.webp' }))
    expect(pickCategoryTiles({ categories, limit: 8 })).toHaveLength(8)
    expect(pickCategoryTiles({ categories: undefined })).toEqual([])
  })
})

describe('pickDeals', () => {
  it('keeps real discounts on products that can be bought, biggest first', () => {
    const { deals, maxDiscount } = pickDeals([
      product(1, { discountPercentage: 5 }),
      product(2, { discountPercentage: 19.6 }),
      product(3, { discountPercentage: 30, stock: 0 }), // sold out
      product(4, { discountPercentage: 0.4 }), // not a real deal
      product(5, { discountPercentage: 12 }),
    ])
    expect(deals.map((deal) => deal.id)).toEqual([2, 5, 1])
    expect(maxDiscount).toBe(20) // rounded like the cards' "-20%" badge
  })

  it('has nothing (and no badge) without discounts', () => {
    expect(pickDeals([product(1)])).toEqual({ deals: [], maxDiscount: 0 })
  })
})

describe('pickBrands', () => {
  it('lists brands by product count (ties A–Z) with a link to the brand filter', () => {
    const brands = pickBrands([product(1), product(2), product(3, { brand: 'Samsung' }), product(4, { brand: 'Nest Co' }), product(5, { brand: null }), product(6, { brand: '  ' })])
    expect(brands).toEqual([
      { name: 'Apple', count: 2, to: '/products?brand=Apple' },
      { name: 'Nest Co', count: 1, to: '/products?brand=Nest+Co' },
      { name: 'Samsung', count: 1, to: '/products?brand=Samsung' },
    ])
    expect(new URLSearchParams(brandLink('Nest Co').split('?')[1]).get('brand')).toBe('Nest Co')
  })
})
