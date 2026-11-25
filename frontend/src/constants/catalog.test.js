import { describe, expect, it } from 'vitest'
import { SORT_OPTIONS, availableSortOptions, getSortOption } from './catalog'

// Phase 17: "Best selling" and "Newest" sorts, only where the API can sort by them.
const API = { bestSelling: true, newest: true }
const DEMO = { bestSelling: false, newest: false }

describe('catalog sort options', () => {
  it('adds Best selling and Newest at the end, sorted by the API', () => {
    expect(SORT_OPTIONS.map((option) => option.value)).toEqual(['featured', 'price-asc', 'price-desc', 'rating-desc', 'discount-desc', 'title-asc', 'best-selling', 'newest'])
    expect(getSortOption('best-selling', 'featured', API)).toMatchObject({ labelKey: 'sort.bestSelling', serverSort: 'bestSelling' })
    expect(getSortOption('newest', 'featured', API)).toMatchObject({ labelKey: 'sort.newest', serverSort: 'createdAt' })
  })

  it('offers them only with the capability, and falls back to the default for their URL values otherwise', () => {
    expect(availableSortOptions(API)).toHaveLength(8)
    expect(availableSortOptions(DEMO).map((option) => option.value)).not.toContain('best-selling')
    expect(availableSortOptions({ bestSelling: false, newest: true }).map((option) => option.value)).toEqual(expect.arrayContaining(['newest']))
    expect(getSortOption('best-selling', 'featured', DEMO).value).toBe('featured')
    expect(getSortOption('newest', 'discount-desc', DEMO).value).toBe('discount-desc')
    expect(getSortOption('rating-desc', 'featured', DEMO).value).toBe('rating-desc')
    expect(getSortOption('nonsense', 'featured', API).value).toBe('featured')
  })

  it('uses the current API’s capabilities by default (the unit tests run against DummyJSON)', () => {
    expect(availableSortOptions().map((option) => option.value)).not.toEqual(expect.arrayContaining(['best-selling']))
    expect(getSortOption('best-selling').value).toBe('featured')
  })
})
