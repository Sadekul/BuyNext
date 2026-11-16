import { describe, expect, it } from 'vitest'
import { CART_ACTIONS, EMPTY_CART, cartLineKey, cartReducer, mergeCarts, sanitizeCart } from './cartReducer'
import { withVariant } from '../utils/variants'
import { configurableTee as TEE } from '../test/fixtures'

const add = (state, product, quantity = 1) => cartReducer(state, { type: CART_ACTIONS.ADDED, product, quantity })
const small = withVariant(TEE, TEE.variants[0]) // S / Red
const medium = withVariant(TEE, TEE.variants[2]) // M / Blue

describe('cart lines for variants', () => {
  it('keeps each variant of a product on its own line, with its id and label', () => {
    const state = add(add(add(EMPTY_CART, small), medium, 2), small)
    expect(state.items).toHaveLength(2)
    expect(state.items[0]).toMatchObject({ productId: 5, variantId: 51, variantLabel: 'Size: S / Color: Red', price: 20, stock: 4, quantity: 2 })
    expect(state.items[1]).toMatchObject({ productId: 5, variantId: 53, variantLabel: 'Size: M / Color: Blue', price: 22, quantity: 2 })
    expect(state.items.map(cartLineKey)).toEqual(['5:51', '5:53'])
  })

  it('refuses a configurable product without a chosen variant', () => {
    expect(add(EMPTY_CART, TEE)).toBe(EMPTY_CART)
  })

  it('changes, removes, and clears ordered lines by line key', () => {
    let state = add(add(add(EMPTY_CART, small), medium), { ...TEE, id: 9, hasVariants: false, options: [], variants: [] })
    state = cartReducer(state, { type: CART_ACTIONS.QUANTITY_CHANGED, lineKey: '5:53', quantity: 3 })
    expect(state.items.map((item) => item.quantity)).toEqual([1, 3, 1])
    state = cartReducer(state, { type: CART_ACTIONS.REMOVED, lineKey: '5:51' })
    expect(state.items.map(cartLineKey)).toEqual(['5:53', '9'])
    state = cartReducer(state, { type: CART_ACTIONS.ORDER_PLACED, lineKeys: ['5:53'] })
    expect(state.items.map(cartLineKey)).toEqual(['9'])
  })

  it("keeps a variant's own price and stock when the product list is refreshed", () => {
    const state = add(EMPTY_CART, medium)
    const fresh = { ...TEE, title: 'Tee (new name)', price: 18, stock: 99, hasVariants: true }
    const [line] = cartReducer(state, { type: CART_ACTIONS.PRODUCTS_REFRESHED, products: [fresh] }).items
    expect(line).toMatchObject({ title: 'Tee (new name)', price: 22, stock: 3, variantId: 53, notice: null, isUnavailable: false })
    const [gone] = cartReducer(state, { type: CART_ACTIONS.PRODUCTS_REFRESHED, products: [{ ...fresh, hasVariants: false }] }).items
    expect(gone).toMatchObject({ isUnavailable: true, notice: 'This option is no longer available.' })
  })

  it('merges guest and account carts per variant', () => {
    const merged = mergeCarts(add(EMPTY_CART, small), add(add(EMPTY_CART, small, 3), medium))
    expect(merged.items.map((item) => [cartLineKey(item), item.quantity])).toEqual([['5:51', 3], ['5:53', 1]])
  })
})

describe('saved carts', () => {
  it('still loads carts saved before variants, unchanged', () => {
    const old = { items: [{ productId: 1, title: 'Mascara', price: 9.99, quantity: 2 }], couponCode: null }
    const [line] = sanitizeCart(old).items
    expect(line).toMatchObject({ productId: 1, quantity: 2 })
    expect(line).not.toHaveProperty('variantId')
    expect(cartLineKey(line)).toBe('1')
  })

  it('keeps variant lines apart and checks their fields', () => {
    const line = { productId: 5, title: 'Tee', price: 20, quantity: 1 }
    const { items } = sanitizeCart({
      items: [
        { ...line, variantId: 51, variantLabel: 'Size: S' },
        { ...line, variantId: 53, variantLabel: { evil: true } },
        { ...line, variantId: 51, variantLabel: 'duplicate' },
        { ...line, productId: 6, variantId: -1, variantLabel: 'bad id' },
      ],
    })
    expect(items.map((item) => [cartLineKey(item), item.variantLabel])).toEqual([['5:51', 'Size: S'], ['5:53', null], ['6', undefined]])
  })
})
