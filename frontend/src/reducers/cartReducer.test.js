import { describe, expect, it } from 'vitest'
import { CART_ACTIONS, EMPTY_CART, cartReducer, sanitizeCart } from './cartReducer'
import { iphone13, galaxyS8, tennisRacket } from '../test/fixtures'

const add = (state, product, quantity) => cartReducer(state, { type: CART_ACTIONS.ADDED, product, quantity })
// Freezing proves the reducer never mutates its input (mutation would throw in strict mode).
const frozen = (value) => Object.freeze(structuredClone(value))

describe('cartReducer', () => {
  it('removes only the ordered lines and the used coupon after an order', () => {
    const state = { items: add(add(EMPTY_CART, iphone13, 1), tennisRacket, 1).items, couponCode: 'NEST10' }
    const next = cartReducer(frozen(state), { type: CART_ACTIONS.ORDER_PLACED, productIds: [iphone13.id] })
    expect(next.items.map((item) => item.productId)).toEqual([tennisRacket.id])
    expect(next.couponCode).toBeNull()
  })

  it('adds a new product as a cart line', () => {
    const state = add(frozen(EMPTY_CART), iphone13, 2)
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ productId: 123, title: 'iPhone 13 Pro', quantity: 2, notice: null })
  })

  it('merges repeated adds into one line', () => {
    const state = add(add(EMPTY_CART, iphone13, 1), iphone13, 2)
    expect(state.items).toHaveLength(1)
    expect(state.items[0].quantity).toBe(3)
  })

  it('caps quantity at the stock and explains why', () => {
    const lowStock = { ...iphone13, stock: 5 }
    const state = add(add(EMPTY_CART, lowStock, 3), lowStock, 4)
    expect(state.items[0].quantity).toBe(5)
    expect(state.items[0].notice).toBe('Only 5 available, so the quantity was set to 5.')
  })

  it('raises a quantity below the minimum order and explains why', () => {
    const state = add(EMPTY_CART, { ...iphone13, minimumOrderQuantity: 3 }, 1)
    expect(state.items[0].quantity).toBe(3)
    expect(state.items[0].notice).toMatch(/Minimum order is 3/)
  })

  it('ignores products that cannot be bought', () => {
    expect(add(EMPTY_CART, galaxyS8, 1)).toBe(EMPTY_CART)
    expect(add(EMPTY_CART, { ...iphone13, stock: 2, minimumOrderQuantity: 5 }, 5)).toBe(EMPTY_CART)
  })

  it('does not mutate the previous state', () => {
    const before = frozen(add(EMPTY_CART, iphone13, 1))
    const after = cartReducer(before, { type: CART_ACTIONS.QUANTITY_CHANGED, productId: 123, quantity: 4 })
    expect(before.items[0].quantity).toBe(1)
    expect(after.items[0].quantity).toBe(4)
    expect(after).not.toBe(before)
  })

  describe('quantity updates', () => {
    const start = add(EMPTY_CART, { ...iphone13, stock: 10, minimumOrderQuantity: 2 }, 2)
    const change = (quantity) =>
      cartReducer(start, { type: CART_ACTIONS.QUANTITY_CHANGED, productId: 123, quantity }).items[0].quantity

    it.each([
      [4, 4],
      [99, 10], // above stock → stock
      [1, 2], // below minimum order → minimum
      [0, 2],
    ])('setting %i stores %i', (requested, expected) => {
      expect(change(requested)).toBe(expected)
    })
  })

  it('removes a line and clears the cart', () => {
    const state = add(add(EMPTY_CART, iphone13, 1), { ...iphone13, id: 7, title: 'Other' }, 1)
    const removed = cartReducer(state, { type: CART_ACTIONS.REMOVED, productId: 123 })
    expect(removed.items.map((item) => item.productId)).toEqual([7])
    expect(cartReducer(removed, { type: CART_ACTIONS.CLEARED })).toEqual(EMPTY_CART)
  })

  it('normalizes coupon codes', () => {
    const state = cartReducer(EMPTY_CART, { type: CART_ACTIONS.COUPON_APPLIED, code: ' nest10 ' })
    expect(state.couponCode).toBe('NEST10')
  })

  describe('refreshing with fresh API data', () => {
    const cart = add(add(EMPTY_CART, iphone13, 1), { ...iphone13, id: 7, title: 'Gone' }, 1)
    const refresh = (products, state = cart) => cartReducer(state, { type: CART_ACTIONS.PRODUCTS_REFRESHED, products })

    it('reports a price change with old and new sale prices', () => {
      const line = refresh([{ ...iphone13, price: 999.99 }]).items[0]
      expect(line.notice).toBe('Price changed from $996.92 to $906.29.')
    })

    it('flags products missing from the API and out-of-stock products', () => {
      const result = refresh([{ ...iphone13, stock: 0 }])
      expect(result.items[0]).toMatchObject({ isUnavailable: true, notice: 'This product is out of stock.' })
      expect(result.items[1]).toMatchObject({ isUnavailable: true, notice: 'This product is no longer available.' })
    })

    it('clears a stale notice when nothing is wrong any more', () => {
      const restocked = refresh([iphone13], { ...cart, items: [{ ...cart.items[0], isUnavailable: true, notice: 'This product is out of stock.' }] })
      expect(restocked.items[0]).toMatchObject({ isUnavailable: false, notice: null })
    })
  })

  describe('sanitizeCart (data from localStorage)', () => {
    it('drops malformed and duplicate lines', () => {
      const valid = { productId: 1, quantity: 1, price: 5, title: 'A' }
      const result = sanitizeCart({ items: [valid, { ...valid }, { productId: 'x', quantity: 1 }, null], couponCode: 7 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ ...valid, notice: null, isUnavailable: false })
      expect(result.couponCode).toBeNull()
    })

    // Tampered storage must not crash rendering or bend the price math.
    it('replaces wrongly typed or out-of-range fields with null', () => {
      const tampered = {
        productId: 1,
        quantity: 1,
        price: 5,
        title: 'A',
        notice: { evil: true }, // an object would crash React when rendered
        brand: 42,
        thumbnail: ['x'],
        discountPercentage: 150,
        stock: -3,
        isUnavailable: 'yes',
        extra: 'dropped',
      }
      const [item] = sanitizeCart({ items: [tampered] }).items
      expect(item).toMatchObject({ notice: null, brand: null, thumbnail: null, discountPercentage: null, stock: null, isUnavailable: false })
      expect(item).not.toHaveProperty('extra')
    })

    it('drops lines with a negative or non-finite price', () => {
      const line = { productId: 1, quantity: 1, title: 'A' }
      expect(sanitizeCart({ items: [{ ...line, price: -1 }, { ...line, productId: 2, price: Infinity }] }).items).toEqual([])
    })

    it('falls back to an empty cart for garbage', () => {
      expect(sanitizeCart('nonsense')).toEqual(EMPTY_CART)
    })
  })
})
