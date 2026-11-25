import { describe, expect, it } from 'vitest'
import { BEST_SELLING_DAYS, HOME_RANKINGS, availableRankings, rankedItems, brandLink, compactListOrder, pickBrands, pickCategoryIcons, pickDeals, splitBanners } from './homeSections'

const product = (id, changes = {}) => ({ id, title: `P${id}`, category: 'phones', brand: 'Apple', thumbnail: `p${id}.webp`, price: 10, discountPercentage: 0, stock: 5, minimumOrderQuantity: 1, ...changes })

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

// Phase 17 (docs/backend/PHASE17_CONTRACT.md §4).
describe('availableRankings', () => {
  it('keeps every ranking with sales and date sorting (BuyNest API), in the tabs’ order', () => {
    expect(availableRankings({ bestSelling: true, newest: true }).map((ranking) => ranking.id)).toEqual(['best-selling', 'trending', 'new', 'on-sale'])
  })

  it('leaves out "Best selling" and "New arrivals" when the catalog cannot sort by them (the demo) instead of faking them', () => {
    expect(availableRankings().map((ranking) => ranking.id)).toEqual(['trending', 'on-sale'])
    expect(availableRankings({ newest: true }).map((ranking) => ranking.id)).toEqual(['trending', 'new', 'on-sale'])
  })

  it('links "View all" to the catalog sort that matches', () => {
    const links = Object.fromEntries(HOME_RANKINGS.map((ranking) => [ranking.id, ranking.viewAllTo]))
    expect(links).toEqual({ 'best-selling': '/products?sort=best-selling', trending: '/products?sort=rating-desc', new: '/products?sort=newest', 'on-sale': '/products?sort=discount-desc' })
    expect(BEST_SELLING_DAYS).toBe(90)
  })
})

describe('compactListOrder', () => {
  it('orders the compact lists Best selling, Top rated, On sale, New, skipping missing ones', () => {
    expect(compactListOrder(availableRankings({ bestSelling: true, newest: true })).map((ranking) => ranking.id)).toEqual(['best-selling', 'trending', 'on-sale', 'new'])
    expect(compactListOrder(availableRankings()).map((ranking) => ranking.id)).toEqual(['trending', 'on-sale'])
  })
})

describe('splitBanners', () => {
  it('gives the first two banners to the hero column and the rest to the promo row', () => {
    expect(splitBanners([1, 2, 3, 4, 5])).toEqual({ side: [1, 2], rest: [3, 4, 5] })
    expect(splitBanners([1])).toEqual({ side: [1], rest: [] })
    expect(splitBanners()).toEqual({ side: [], rest: [] })
  })
})

describe('pickCategoryIcons', () => {
  it('puts the configured categories first and keeps categories without a photo (they get an icon)', () => {
    const categories = [
      { slug: 'beauty', name: 'Beauty', image: 'beauty.webp' },
      { slug: 'phones', name: 'Phones' },
      { slug: 'cases', name: 'Cases', parentSlug: 'phones', image: 'cases.webp' },
      { slug: 'books', name: 'Books' },
      { slug: 'laptops', name: 'Laptops' },
    ]
    const icons = pickCategoryIcons({
      categories,
      products: [product(1), product(2, { category: 'phones', thumbnail: 'second.webp' })],
      configured: [{ slug: 'laptops', image: 'laptop.webp' }, { slug: 'phones' }],
    })
    expect(icons).toEqual([
      { slug: 'laptops', name: 'Laptops', image: 'laptop.webp' }, // configured image
      { slug: 'phones', name: 'Phones', image: 'p1.webp' }, // its first product's photo
      { slug: 'beauty', name: 'Beauty', image: 'beauty.webp' }, // the category's own image
      { slug: 'books', name: 'Books', image: null }, // no photo: the row shows its icon
    ])
  })

  it('stops at the limit (12 by default) and copes with nothing loaded yet', () => {
    const categories = Array.from({ length: 20 }, (_, index) => ({ slug: `c${index}`, name: `C${index}` }))
    expect(pickCategoryIcons({ categories })).toHaveLength(12)
    expect(pickCategoryIcons({ categories, limit: 5 })).toHaveLength(5)
    expect(pickCategoryIcons({ categories: undefined })).toEqual([])
  })
})

describe('rankedItems', () => {
  const [bestSelling, trending, , onSale] = HOME_RANKINGS
  const sold = (id, unitsSold, changes) => product(id, { unitsSold, ...changes })

  it('best selling: only products that really sold, and only when the API says there were sales', () => {
    expect(rankedItems(bestSelling, { hasSales: true, items: [sold(1, 9), sold(2, 3), sold(3, 0), sold(4)] }).map((item) => item.id)).toEqual([1, 2])
    expect(rankedItems(bestSelling, { hasSales: false, items: [sold(1, 9)] })).toEqual([]) // never the rating fallback
    expect(rankedItems(bestSelling, { items: [sold(1, 9)] })).toEqual([]) // fields absent (older API): no sales
    expect(rankedItems(bestSelling, undefined)).toEqual([])
  })

  it('on sale keeps real discounts; other rankings keep the API order', () => {
    const items = [product(1, { discountPercentage: 12 }), product(2, { discountPercentage: 0.4 }), product(3)]
    expect(rankedItems(onSale, { items }).map((item) => item.id)).toEqual([1])
    expect(rankedItems(trending, { items }).map((item) => item.id)).toEqual([1, 2, 3])
  })
})
