import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filterProducts,
  getBrandOptions,
  hasInvalidPriceRange,
  paginate,
  sortProducts,
} from './catalog'
import { galaxyS8, iphone13, tennisRacket } from '../test/fixtures'

const products = [iphone13, galaxyS8, tennisRacket] // $996.92 Apple · sold out Samsung · $40.19 no brand
const filter = (changes) => filterProducts(products, { ...EMPTY_FILTERS, ...changes }).map((product) => product.id)

describe('product filters', () => {
  it('filters by the sale price customers pay', () => {
    expect(filter({ maxPrice: '50' })).toEqual([152])
    expect(filter({ minPrice: '400' })).toEqual([123, 132])
  })

  it('filters by minimum rating', () => {
    expect(filter({ minRating: 4 })).toEqual([123, 132, 152])
    expect(filter({ minRating: 4.2 })).toEqual([132])
  })

  it('filters by brand and hides brandless products only while filtering by brand', () => {
    expect(filter({ brands: ['Apple'] })).toEqual([123])
    expect(filter({})).toContain(152)
  })

  it('"available to order" removes sold-out products', () => {
    expect(filter({ inStockOnly: true })).toEqual([123, 152])
  })

  it('combines several filters', () => {
    expect(filter({ brands: ['Apple', 'Samsung'], inStockOnly: true, minPrice: '100' })).toEqual([123])
  })

  it('detects an impossible price range and counts active filters', () => {
    expect(hasInvalidPriceRange({ ...EMPTY_FILTERS, minPrice: '500', maxPrice: '100' })).toBe(true)
    expect(countActiveFilters({ ...EMPTY_FILTERS, minPrice: '1', brands: ['A', 'B'], inStockOnly: true })).toBe(4)
  })
})

describe('sortProducts', () => {
  it('sorts by sale price without mutating the input', () => {
    const input = [...products]
    expect(sortProducts(input, 'price-asc').map((product) => product.id)).toEqual([152, 132, 123])
    expect(input.map((product) => product.id)).toEqual([123, 132, 152])
  })

  it('keeps API order for "featured"', () => {
    expect(sortProducts(products, 'featured')).toBe(products)
  })
})

describe('getBrandOptions', () => {
  it('lists brands alphabetically with counts, skipping missing brands', () => {
    expect(getBrandOptions([...products, iphone13])).toEqual([
      { name: 'Apple', count: 2 },
      { name: 'Samsung', count: 1 },
    ])
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1)

  it('returns one page with its range', () => {
    expect(paginate(items, 3, 12)).toEqual({ items: [25], currentPage: 3, pageCount: 3, start: 25, end: 25 })
  })

  it('clamps out-of-range pages', () => {
    expect(paginate(items, 99, 12).currentPage).toBe(3)
    expect(paginate(items, -1, 12).currentPage).toBe(1)
    expect(paginate([], 1, 12)).toMatchObject({ pageCount: 1, start: 0, end: 0 })
  })
})
