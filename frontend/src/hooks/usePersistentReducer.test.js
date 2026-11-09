import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePersistentReducer } from './usePersistentReducer'
import { CART_ACTIONS, EMPTY_CART, cartReducer, mergeCarts, sanitizeCart } from '../reducers/cartReducer'

const OPTIONS = {
  storageKey: 'test.cart',
  emptyState: EMPTY_CART,
  sanitize: sanitizeCart,
  replaceActionType: CART_ACTIONS.REPLACED,
  mergeGuest: mergeCarts,
}
const line = (productId, quantity = 1) => ({ productId, title: `P${productId}`, price: 10, quantity, stock: 50 })
const stored = (key) => JSON.parse(window.localStorage.getItem(key))
const ids = (state) => state.items.map((item) => item.productId)

// The hook as a provider uses it: the owner is the signed-in customer's id (or null).
const renderCart = (ownerId) =>
  renderHook(({ owner }) => usePersistentReducer(cartReducer, OPTIONS, owner), { initialProps: { owner: ownerId } })

describe('usePersistentReducer ownership', () => {
  it("never shows one account's items to the next person after sign-out", () => {
    window.localStorage.setItem('test.cart.user-1', JSON.stringify({ items: [line(1)], couponCode: null }))
    const { result, rerender } = renderCart(1)
    expect(ids(result.current[0])).toEqual([1])

    rerender({ owner: null }) // signed out
    expect(ids(result.current[0])).toEqual([])
    expect(ids(stored('test.cart.user-1'))).toEqual([1]) // kept for when they sign back in

    rerender({ owner: 2 }) // someone else signs in
    expect(ids(result.current[0])).toEqual([])
    expect(stored('test.cart.user-2').items).toEqual([]) // nothing copied across accounts
  })

  it('moves guest items into the account on sign-in and empties the guest copy', () => {
    window.localStorage.setItem('test.cart', JSON.stringify({ items: [line(1, 3), line(2)], couponCode: 'NEST10' }))
    window.localStorage.setItem('test.cart.user-1', JSON.stringify({ items: [line(1, 1)], couponCode: null }))
    const { result, rerender } = renderCart(null)
    rerender({ owner: 1 })

    const [cart] = result.current
    expect(cart.items.map((item) => [item.productId, item.quantity])).toEqual([[1, 3], [2, 1]]) // larger quantity kept
    expect(cart.couponCode).toBe('NEST10')
    expect(window.localStorage.getItem('test.cart')).toBeNull()
  })

  it('saves changes under the current owner only', () => {
    const { result } = renderCart(7)
    act(() => result.current[1]({ type: CART_ACTIONS.ADDED, product: { id: 5, title: 'P5', price: 1, stock: 9 }, quantity: 1 }))
    expect(ids(stored('test.cart.user-7'))).toEqual([5])
    expect(window.localStorage.getItem('test.cart')).toBeNull()
  })
})
