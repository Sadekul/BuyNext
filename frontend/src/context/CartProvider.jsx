import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { CartContext } from './cartContext'
import { CART_ACTIONS, EMPTY_CART, cartReducer, sanitizeCart } from '../reducers/cartReducer'
import { calculateCartTotals } from '../utils/cartTotals'
import { getPurchaseLimits } from '../utils/inventory'
import { readJson, writeJson } from '../utils/storage'

// Versioned key: if the stored shape ever changes, bump to v2 and old data is ignored.
const STORAGE_KEY = 'buynest.cart.v1'

/*
 * Shared cart state for the whole app (Context + useReducer).
 *
 * localStorage keeps the cart across refreshes. It is a convenience only:
 * anyone can edit it in DevTools, so the backend must re-validate prices,
 * stock, discounts, and totals before taking an order.
 */
function CartProvider({ children }) {
  // Lazy initializer: read storage once, on the first render only.
  const [cart, dispatch] = useReducer(cartReducer, undefined, () => sanitizeCart(readJson(STORAGE_KEY, EMPTY_CART)))
  const [isCartOpen, setIsCartOpen] = useState(false)

  // Save after every change. The effect only writes to storage (no setState).
  useEffect(() => {
    writeJson(STORAGE_KEY, cart)
  }, [cart])

  // Keep several open tabs in sync: the `storage` event fires in OTHER tabs.
  useEffect(() => {
    function handleStorage(event) {
      if (event.key !== STORAGE_KEY) return
      dispatch({ type: CART_ACTIONS.REPLACED, state: sanitizeCart(readJson(STORAGE_KEY, EMPTY_CART)) })
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Stable action functions (useCallback) so consumers don't re-render needlessly.
  const addItem = useCallback((product, quantity = getPurchaseLimits(product).min) => {
    dispatch({ type: CART_ACTIONS.ADDED, product, quantity })
    setIsCartOpen(true)
  }, [])
  const updateQuantity = useCallback(
    (productId, quantity) => dispatch({ type: CART_ACTIONS.QUANTITY_CHANGED, productId, quantity }),
    [],
  )
  const removeItem = useCallback((productId) => dispatch({ type: CART_ACTIONS.REMOVED, productId }), [])
  const clearCart = useCallback(() => dispatch({ type: CART_ACTIONS.CLEARED }), [])
  const applyCoupon = useCallback((code) => dispatch({ type: CART_ACTIONS.COUPON_APPLIED, code }), [])
  const removeCoupon = useCallback(() => dispatch({ type: CART_ACTIONS.COUPON_REMOVED }), [])
  const refreshProducts = useCallback(
    (products) => dispatch({ type: CART_ACTIONS.PRODUCTS_REFRESHED, products }),
    [],
  )
  const openCart = useCallback(() => setIsCartOpen(true), [])
  const closeCart = useCallback(() => setIsCartOpen(false), [])

  // useMemo: a new value object only when something actually changed.
  const value = useMemo(
    () => ({
      items: cart.items,
      couponCode: cart.couponCode,
      totals: calculateCartTotals(cart.items, cart.couponCode),
      isCartOpen,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      applyCoupon,
      removeCoupon,
      refreshProducts,
      openCart,
      closeCart,
    }),
    [cart, isCartOpen, addItem, updateQuantity, removeItem, clearCart, applyCoupon, removeCoupon, refreshProducts, openCart, closeCart],
  )

  return <CartContext value={value}>{children}</CartContext>
}

export default CartProvider
