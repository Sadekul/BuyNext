import { describe, expect, it } from 'vitest'
import { CART_ACTIONS, EMPTY_CART, cartLineKey, cartReducer, sanitizeCart } from './cartReducer'
import { calculateCartTotals } from '../utils/cartTotals'
import { customAmountError, isGiftCardOnly, withGiftCard } from '../utils/giftCards'

// Phase 10 §5: gift card lines (an amount, for a recipient).
const GIFT_CARD = { id: 30, title: 'BuyNest Gift Card', type: 'gift_card', price: 25, discountPercentage: 0, stock: 0, minimumOrderQuantity: 1, thumbnail: 'gc.webp' }
const SAM = { amount: 50, recipientName: 'Sam Lee', recipientEmail: 'sam@example.com', message: 'Happy birthday' }
const ALEX = { amount: 50, recipientName: 'Alex Kim', recipientEmail: 'alex@example.com', message: '' }
const MASCARA = { id: 1, title: 'Mascara', price: 10, discountPercentage: 0, stock: 20, minimumOrderQuantity: 1 }
const add = (state, product, quantity = 1) => cartReducer(state, { type: CART_ACTIONS.ADDED, product, quantity })

describe('gift card lines', () => {
  it('a gift card needs its amount and recipient', () => {
    expect(add(EMPTY_CART, GIFT_CARD)).toBe(EMPTY_CART)
  })

  it('one line per recipient, priced at the chosen amount; the same card again adds to its line', () => {
    let cart = add(EMPTY_CART, withGiftCard(GIFT_CARD, SAM))
    cart = add(cart, withGiftCard(GIFT_CARD, ALEX))
    cart = add(cart, withGiftCard(GIFT_CARD, { ...SAM, recipientEmail: 'SAM@example.com ' }))
    expect(cart.items).toHaveLength(2)
    expect(cart.items[0]).toMatchObject({ productId: 30, productType: 'gift_card', price: 50, discountPercentage: 0, quantity: 2, giftCard: { recipientName: 'Sam Lee', message: 'Happy birthday' } })
    expect(cart.items[1].giftCard).toMatchObject({ recipientName: 'Alex Kim', message: null })
    expect(cartLineKey(cart.items[0])).not.toBe(cartLineKey(cart.items[1]))
    expect(cartLineKey(cart.items[0])).toMatch(/^30:gc-/)
  })

  it('the server’s priced line (no id) has the same key as the cart line', () => {
    const cart = add(EMPTY_CART, withGiftCard(GIFT_CARD, SAM))
    const serverLine = { productId: 30, giftCard: { amount: 50, recipientName: 'Sam Lee', recipientEmail: 'sam@example.com', message: 'Happy birthday' } }
    expect(cartLineKey(serverLine)).toBe(cartLineKey(cart.items[0]))
  })

  it('keeps its amount when products are refreshed, and survives storage only with valid details', () => {
    let cart = add(EMPTY_CART, withGiftCard(GIFT_CARD, SAM))
    cart = cartReducer(cart, { type: CART_ACTIONS.PRODUCTS_REFRESHED, products: [{ ...GIFT_CARD, title: 'Gift Card', price: 25, stock: 0 }] })
    expect(cart.items[0]).toMatchObject({ title: 'Gift Card', price: 50, isUnavailable: false })

    const stored = JSON.parse(JSON.stringify(cart))
    expect(sanitizeCart(stored).items[0]).toMatchObject({ productType: 'gift_card', giftCard: { amount: 50, recipientEmail: 'sam@example.com' } })
    stored.items[0].giftCard.recipientEmail = 42
    expect(sanitizeCart(stored).items).toEqual([])
  })

  it('a saved cart from the server replaces product lines but keeps gift card lines', () => {
    let cart = add(add(EMPTY_CART, MASCARA), withGiftCard(GIFT_CARD, SAM))
    cart = cartReducer(cart, { type: CART_ACTIONS.SAVED_CART_LOADED, mode: 'replace', lines: [{ productId: 2, title: 'Lipstick', price: 5, quantity: 1, stock: 9 }] })
    expect(cart.items.map((item) => item.productId)).toEqual([2, 30])
  })
})

describe('gift cards and shipping', () => {
  it('a cart of gift cards only needs no shipping; with a product it does', () => {
    const giftOnly = add(EMPTY_CART, withGiftCard(GIFT_CARD, SAM))
    expect(isGiftCardOnly(giftOnly.items)).toBe(true)
    expect(calculateCartTotals(giftOnly.items)).toMatchObject({ requiresShipping: false, shipping: 0, total: 50, freeShippingThreshold: null })
    const mixed = add(giftOnly, MASCARA)
    expect(isGiftCardOnly(mixed.items)).toBe(false)
    expect(calculateCartTotals(mixed.items)).toMatchObject({ requiresShipping: true, shipping: 4.99 })
  })

  it('checks a custom amount against the store’s limits', () => {
    const custom = { min: 10, max: 500 }
    expect(customAmountError('', custom)).toBe('Enter an amount.')
    expect(customAmountError('5', custom)).toBe('Choose an amount from $10.00 to $500.00.')
    expect(customAmountError('10.555', custom)).toBe('Use whole cents, like 40 or 42.50.')
    expect(customAmountError('42.50', custom)).toBeNull()
  })
})
