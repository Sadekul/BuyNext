import { useCallback, useMemo, useState } from 'react'
import { CartContext } from './cartContext'
import { CART_ACTIONS, EMPTY_CART, cartReducer, sanitizeCart } from '../reducers/cartReducer'
import { usePersistentReducer } from '../hooks/usePersistentReducer'
import { calculateCartTotals } from '../utils/cartTotals'
import { getPurchaseLimits } from '../utils/inventory'

// Versioned key: if the stored shape ever changes, bump to v2 and old data is ignored.
const STORAGE_OPTIONS = {
  storageKey: 'buynest.cart.v1',
  emptyState: EMPTY_CART,
  sanitize: sanitizeCart,
  replaceActionType: CART_ACTIONS.REPLACED,
}

/*
 * Shared cart state for the whole app (Context + useReducer).
 *
 * localStorage keeps the cart across refreshes. It is a convenience only:
 * anyone can edit it in DevTools, so the backend must re-validate prices,
 * stock, discounts, and totals before taking an order.
 */
function CartProvider({ children }) {
  // Reducer + localStorage persistence + cross-tab sync (see usePersistentReducer).
  const [cart, dispatch] = usePersistentReducer(cartReducer, STORAGE_OPTIONS)
  const [isCartOpen, setIsCartOpen] = useState(false)

  // Stable action functions (useCallback) so consumers don't re-render needlessly.
  // `dispatch` never changes, but the linter can't know that when it comes from a custom hook.
  const addItem = useCallback((product, quantity = getPurchaseLimits(product).min) => {
    dispatch({ type: CART_ACTIONS.ADDED, product, quantity })
    setIsCartOpen(true)
  }, [dispatch])
  const updateQuantity = useCallback(
    (productId, quantity) => dispatch({ type: CART_ACTIONS.QUANTITY_CHANGED, productId, quantity }),
    [dispatch],
  )
  const removeItem = useCallback((productId) => dispatch({ type: CART_ACTIONS.REMOVED, productId }), [dispatch])
  const clearCart = useCallback(() => dispatch({ type: CART_ACTIONS.CLEARED }), [dispatch])
  const applyCoupon = useCallback((code) => dispatch({ type: CART_ACTIONS.COUPON_APPLIED, code }), [dispatch])
  const removeCoupon = useCallback(() => dispatch({ type: CART_ACTIONS.COUPON_REMOVED }), [dispatch])
  const refreshProducts = useCallback(
    (products) => dispatch({ type: CART_ACTIONS.PRODUCTS_REFRESHED, products }),
    [dispatch],
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
