import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MISSING, compareRows, specificationLabels, valuesDiffer } from './compare'
import { convertPrice, formatBasePrice, formatPrice } from './formatters'
import { chooseDisplayCurrency, getDisplayCurrency, resetDisplayCurrencyForTests, setAvailableCurrencies, useDisplayCurrency } from './displayCurrency'
import { MAX_RECENTLY_VIEWED, clearRecentlyViewed, recordRecentlyViewed, useRecentlyViewed } from './recentlyViewed'
import { earnEstimate, formatPoints } from './rewards'
import { COMPARE_ACTIONS, EMPTY_COMPARE, MAX_COMPARE, compareReducer, sanitizeCompare } from '../reducers/compareReducer'
import { EMPTY_WISHLIST, WISHLIST_ACTIONS, sanitizeWishlist, wishlistReducer } from '../reducers/wishlistReducer'
import { normalizeCompareList, normalizeProduct, normalizeSpecifications } from '../services/adapters/laravelAdapter'
import { normalizeCurrencies, normalizeRewardSettings } from '../services/adapters/contentAdapter'

// Phase 11 helpers: compare rows, display currencies, recently viewed, reward points, and the reducers.

const BDT = { code: 'BDT', symbol: '৳', rate: '110.00000000', decimals: 2 }
afterEach(() => resetDisplayCurrencyForTests())

describe('display currencies (§5)', () => {
  it('formats in the base currency until a shopper chooses another one the store offers', () => {
    expect(formatPrice(1099.99)).toBe('$1,099.99')
    chooseDisplayCurrency('BDT') // not offered yet: still USD
    expect(getDisplayCurrency()).toBeNull()
    setAvailableCurrencies([BDT, { code: 'EUR', symbol: '€', rate: 0.92, decimals: 2 }, { code: 'USD', symbol: '$', rate: 1, decimals: 2 }, { code: 'XX', rate: 2 }, { code: 'JPY', rate: 0 }])
    expect(getDisplayCurrency()).toEqual({ code: 'BDT', symbol: '৳', rate: 110, decimals: 2 })
    expect(formatPrice(10.5)).toBe('৳1,155.00')
    // What is charged never changes.
    expect(formatBasePrice(10.5)).toBe('$10.50')
    chooseDisplayCurrency('EUR')
    expect(formatPrice(10)).toBe('€9.20')
    expect(window.localStorage.getItem('buynest.currency.v1')).toBe('"EUR"')
    chooseDisplayCurrency(null)
    expect(formatPrice(10)).toBe('$10.00')
    expect(window.localStorage.getItem('buynest.currency.v1')).toBeNull()
  })

  it('rounds to the currency’s decimals and uses the store’s symbol', () => {
    expect(convertPrice(9.99, { rate: 110.123, decimals: 0 })).toBe(1100)
    setAvailableCurrencies([{ code: 'JPY', symbol: '¥', rate: 151.5, decimals: 0 }, { code: 'KWD', symbol: 'KD', rate: 0.3075, decimals: 3 }])
    chooseDisplayCurrency('JPY')
    expect(formatPrice(9.99)).toBe('¥1,513')
    chooseDisplayCurrency('KWD')
    expect(formatPrice(100)).toBe('KD30.750')
  })

  it('a currency the store stops offering falls back to the base; components re-render on a change', () => {
    const { result } = renderHook(() => useDisplayCurrency())
    act(() => setAvailableCurrencies([BDT]))
    act(() => chooseDisplayCurrency('BDT'))
    expect(result.current.active.code).toBe('BDT')
    act(() => setAvailableCurrencies([]))
    expect(result.current.active).toBeNull()
    expect(formatPrice(1)).toBe('$1.00')
  })

  it('the store settings keep only usable currencies, and reward settings only when on', () => {
    expect(normalizeCurrencies({ base: 'USD', display: [BDT, { code: 'EUR', symbol: '€', rate: '0', decimals: 2 }, { code: 'usd', rate: '1' }] })).toEqual({
      base: 'USD',
      display: [{ code: 'BDT', symbol: '৳', rate: 110, decimals: 2 }],
    })
    expect(normalizeCurrencies(undefined)).toEqual({ base: 'USD', display: [] })
    expect(normalizeRewardSettings({ enabled: true, earn_rate: '1.50', point_value: '0.0100', min_redeem: 100 })).toEqual({ enabled: true, earnRate: 1.5, pointValue: 0.01, minRedeem: 100 })
    expect(normalizeRewardSettings({ enabled: false, earn_rate: '1.00' })).toBeNull()
    expect(normalizeRewardSettings(undefined)).toBeNull()
  })
})

describe('reward points helpers (§4)', () => {
  it('estimates whole points at the store’s rate; nothing when off', () => {
    expect(earnEstimate(36.99, { enabled: true, earnRate: 1 })).toBe(36)
    expect(earnEstimate(10, { enabled: true, earnRate: 1.5 })).toBe(15)
    expect(earnEstimate(0.29, { enabled: true, earnRate: 10 })).toBe(2) // no floating-point surprise (2.9 → 2)
    expect(earnEstimate(100, null)).toBe(0)
    expect(earnEstimate(100, { enabled: true, earnRate: 0 })).toBe(0)
    expect(formatPoints(1500)).toBe('1,500 pts')
    expect(formatPoints(1)).toBe('1 pt')
  })
})

describe('compare table rows (§2)', () => {
  const lamp = { id: 1, title: 'Lamp', brand: 'Lumo', category: 'home-decoration', categoryName: 'Home', stock: 8, availabilityStatus: 'In Stock', weight: 900, options: [{ name: 'Color', values: [{ value: 'Black' }, { value: 'White' }] }], specifications: [{ label: 'Bulb', value: 'E27' }, { label: 'Power', value: '9 W' }] }
  const desk = { id: 2, title: 'Desk', brand: null, category: 'furniture', stock: 0, availabilityStatus: 'Out of Stock', weight: 25000, specifications: [{ label: 'power', value: '—' }, { label: 'Width', value: '120 cm' }] }

  it('fixed rows, then the specification labels in the order first seen (case-insensitive), "—" when missing', () => {
    expect(specificationLabels([lamp, desk])).toEqual(['Bulb', 'Power', 'Width'])
    const rows = compareRows([lamp, desk])
    expect(rows.map((row) => row.label)).toEqual(['Stock', 'Brand', 'Category', 'Weight', 'Options', 'Bulb', 'Power', 'Width'])
    expect(rows.find((row) => row.key === 'stock').values).toEqual(['In stock', 'Out of stock'])
    expect(rows.find((row) => row.key === 'brand').values).toEqual(['Lumo', MISSING])
    expect(rows.find((row) => row.key === 'category').values).toEqual(['Home', 'Furniture'])
    expect(rows.find((row) => row.key === 'weight').values).toEqual(['900 g', '25 kg'])
    expect(rows.find((row) => row.key === 'options').values).toEqual(['Color: Black, White', MISSING])
    expect(rows.find((row) => row.label === 'Bulb').values).toEqual(['E27', MISSING])
    expect(rows.find((row) => row.label === 'Width').values).toEqual([MISSING, '120 cm'])
  })

  it('tells rows that differ', () => {
    expect(valuesDiffer(['Lumo', 'lumo '])).toBe(false)
    expect(valuesDiffer(['E27', MISSING])).toBe(true)
  })

  it('the Laravel adapter reads the compare answer: specifications, short description, option names', () => {
    const [product] = normalizeCompareList({
      data: [{ id: 7, name: 'Lamp', price: '40.00', discount_percent: 0, category: { slug: 'home', name: 'Home' }, weight: 900, review_count: 3, description_short: ' A lamp. ', options: [{ name: 'Color', values: ['Black'] }], specifications: [{ label: ' Bulb ', value: 'E27' }, { label: '', value: 'x' }] }],
    })
    expect(product).toMatchObject({ id: 7, categoryName: 'Home', weight: 900, reviewCount: 3, shortDescription: 'A lamp.', specifications: [{ label: 'Bulb', value: 'E27' }], options: [{ name: 'Color', values: [{ id: null, value: 'Black' }] }] })
    expect(normalizeSpecifications(null)).toEqual([])
    // Linked products on the detail answer are product cards too.
    const detail = normalizeProduct({ id: 1, name: 'A', price: '1.00', related: [{ id: 2, name: 'B', price: '2.00' }], upsells: [] })
    expect(detail.related.map((item) => item.title)).toEqual(['B'])
    expect(detail.upsells).toEqual([])
  })
})

describe('compare list reducer', () => {
  const product = (id) => ({ id, title: `Product ${id}`, thumbnail: `p${id}.webp`, price: 1 })

  it('one entry per product, at most 4, in the order picked', () => {
    let state = EMPTY_COMPARE
    for (const id of [1, 2, 2, 3, 4, 5]) state = compareReducer(state, { type: COMPARE_ACTIONS.ADDED, product: product(id) })
    expect(state.items.map((item) => item.id)).toEqual([1, 2, 3, 4])
    expect(state.items[0]).toEqual({ id: 1, title: 'Product 1', thumbnail: 'p1.webp' })
    state = compareReducer(state, { type: COMPARE_ACTIONS.REMOVED, id: 2 })
    expect(state.items.map((item) => item.id)).toEqual([1, 3, 4])
    expect(compareReducer(state, { type: COMPARE_ACTIONS.CLEARED })).toBe(EMPTY_COMPARE)
  })

  it('checks stored data', () => {
    const stored = { items: [{ id: 1, title: 'A' }, { id: 1, title: 'A again' }, { id: 'x', title: 'B' }, { id: 2 }, { id: 3, title: 'C', thumbnail: {} }, ...[4, 5, 6].map((id) => ({ id, title: `P${id}` }))] }
    expect(sanitizeCompare(stored).items).toEqual([{ id: 1, title: 'A', thumbnail: null }, { id: 3, title: 'C', thumbnail: null }, { id: 4, title: 'P4', thumbnail: null }, { id: 5, title: 'P5', thumbnail: null }])
    expect(sanitizeCompare(stored).items).toHaveLength(MAX_COMPARE)
    expect(sanitizeCompare('nope')).toEqual(EMPTY_COMPARE)
  })
})

describe('wishlist reducer: the server list (§1)', () => {
  const entry = { id: 31, product: { id: 7, title: 'Lamp', brand: 'Lumo', category: 'home', thumbnail: 'l.webp', price: 40, discountPercentage: 10, rating: 4.4, stock: 8, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', hasVariants: false }, variant: { id: 4, label: 'Color: Black' }, note: 'Office', addedAt: '2026-11-18T09:00:00Z' }

  it('replaces the list with the server’s, keeping each item’s server id and note', () => {
    const local = { items: [{ productId: 99, title: 'Old', price: 1, addedAt: 1 }] }
    const state = wishlistReducer(local, { type: WISHLIST_ACTIONS.SERVER_LOADED, entries: [entry, { id: 32, product: null }] })
    expect(state.items).toEqual([
      expect.objectContaining({ productId: 7, title: 'Lamp', price: 40, serverId: 31, note: 'Office', variantLabel: 'Color: Black', addedAt: Date.parse('2026-11-18T09:00:00Z'), isUnavailable: false }),
    ])
    // …and stores them (sanitize keeps the new fields, checked).
    expect(sanitizeWishlist(JSON.parse(JSON.stringify(state))).items[0]).toMatchObject({ serverId: 31, note: 'Office', variantLabel: 'Color: Black' })
    expect(sanitizeWishlist({ items: [{ productId: 7, title: 'Lamp', price: 40, serverId: 'x', note: 5 }] }).items[0]).not.toHaveProperty('serverId')
  })

  it('sets a server id and a note; a refused removal comes back where it was', () => {
    let state = { items: [{ productId: 1, title: 'A', price: 1 }, { productId: 2, title: 'B', price: 2 }] }
    state = wishlistReducer(state, { type: WISHLIST_ACTIONS.SERVER_ID_SET, productId: 2, serverId: 9 })
    state = wishlistReducer(state, { type: WISHLIST_ACTIONS.NOTE_SET, productId: 2, note: 'Size M' })
    expect(state.items[1]).toMatchObject({ serverId: 9, note: 'Size M' })
    const removed = wishlistReducer(state, { type: WISHLIST_ACTIONS.REMOVED, productId: 1 })
    const restored = wishlistReducer(removed, { type: WISHLIST_ACTIONS.RESTORED, item: state.items[0], index: 0 })
    expect(restored.items.map((item) => item.productId)).toEqual([1, 2])
    expect(wishlistReducer(restored, { type: WISHLIST_ACTIONS.RESTORED, item: state.items[0], index: 0 })).toBe(restored)
    expect(wishlistReducer(EMPTY_WISHLIST, { type: WISHLIST_ACTIONS.SERVER_LOADED, entries: [] })).toEqual(EMPTY_WISHLIST)
  })
})

describe('recently viewed (§6)', () => {
  const product = (id) => ({ id, title: `Product ${id}`, price: id, discountPercentage: 0, rating: 4, stock: 5, thumbnail: `p${id}.webp`, brand: null, category: 'beauty', availabilityStatus: 'In Stock', minimumOrderQuantity: 1 })

  it('keeps the last 12, newest first, each once; Clear empties it', () => {
    const { result } = renderHook(() => useRecentlyViewed())
    expect(result.current).toEqual([])
    act(() => {
      for (let id = 1; id <= 14; id += 1) recordRecentlyViewed(product(id))
      recordRecentlyViewed(product(5))
    })
    expect(result.current).toHaveLength(MAX_RECENTLY_VIEWED)
    expect(result.current.map((item) => item.id).slice(0, 4)).toEqual([5, 14, 13, 12])
    expect(result.current.filter((item) => item.id === 5)).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ id: 5, title: 'Product 5', price: 5, thumbnail: 'p5.webp' })
    act(() => clearRecentlyViewed())
    expect(result.current).toEqual([])
  })

  it('ignores broken stored data and follows other tabs', () => {
    window.localStorage.setItem('buynest.recentlyViewed.v1', JSON.stringify([{ id: 1, title: 'A', price: 2 }, { id: 'x' }, { id: 2, title: {}, price: 1 }, { id: 1, title: 'dupe', price: 3 }]))
    const { result } = renderHook(() => useRecentlyViewed())
    expect(result.current.map((item) => item.title)).toEqual(['A'])
    act(() => {
      window.localStorage.setItem('buynest.recentlyViewed.v1', JSON.stringify([{ id: 3, title: 'From another tab', price: 1 }]))
      window.dispatchEvent(new StorageEvent('storage', { key: 'buynest.recentlyViewed.v1' }))
    })
    expect(result.current.map((item) => item.title)).toEqual(['From another tab'])
  })
})
