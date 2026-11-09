import { describe, expect, it } from 'vitest'
import { readCatalogParams, withFilters, withParam } from './catalogParams'
import { EMPTY_FILTERS } from './catalog'

describe('URL-based catalog state', () => {
  it('reads valid filters, page, and view from the query string', () => {
    const params = new URLSearchParams('brand=Apple&brand=Samsung&minPrice=100&rating=4&available=1&page=2&view=list')
    expect(readCatalogParams(params)).toEqual({
      filters: { minPrice: '100', maxPrice: '', minRating: 4, brands: ['Apple', 'Samsung'], inStockOnly: true },
      page: 2,
      layout: 'list',
    })
  })

  it('ignores invalid values typed into the URL', () => {
    const { filters, page, layout } = readCatalogParams(new URLSearchParams('rating=9&page=-3&minPrice=abc&view=table'))
    expect(filters).toEqual(EMPTY_FILTERS)
    expect(page).toBe(1)
    expect(layout).toBe('grid')
  })

  it('writes filters, keeps unrelated params, and resets the page', () => {
    const next = withFilters(new URLSearchParams('q=phone&sort=price-asc&page=4'), { ...EMPTY_FILTERS, brands: ['Apple'], minRating: 3 })
    expect(next.toString()).toBe('q=phone&sort=price-asc&rating=3&brand=Apple')
  })

  it('removes a param when it equals its default', () => {
    expect(withParam(new URLSearchParams('sort=price-asc'), 'sort', 'featured', 'featured').toString()).toBe('')
  })
})
