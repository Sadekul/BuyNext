import { useCallback, useMemo } from 'react'
import { WishlistContext } from './wishlistContext'
import { EMPTY_WISHLIST, WISHLIST_ACTIONS, sanitizeWishlist, wishlistReducer } from '../reducers/wishlistReducer'
import { usePersistentReducer } from '../hooks/usePersistentReducer'
import { useCart } from '../hooks/useCart'
import { getPurchaseLimits } from '../utils/inventory'

const STORAGE_OPTIONS = {
  storageKey: 'buynest.wishlist.v1',
  emptyState: EMPTY_WISHLIST,
  sanitize: sanitizeWishlist,
  replaceActionType: WISHLIST_ACTIONS.REPLACED,
}

/*
 * Shared wishlist state, saved in this browser only. Once customers can sign
 * in (Phase 9) and a real backend exists, the wishlist should be stored on
 * the server per account and merged with this local copy after login.
 *
 * Must be rendered inside <CartProvider>, because "move to cart" uses the cart.
 */
function WishlistProvider({ children }) {
  const [wishlist, dispatch] = usePersistentReducer(wishlistReducer, STORAGE_OPTIONS)
  const { addItem: addToCart } = useCart()

  // A Set makes "is this product saved?" checks fast for every card on the page.
  const savedIds = useMemo(() => new Set(wishlist.items.map((item) => item.productId)), [wishlist.items])

  const isInWishlist = useCallback((productId) => savedIds.has(productId), [savedIds])

  const addItem = useCallback(
    // Date.now() runs here, in an event handler, keeping the reducer pure.
    (product) => dispatch({ type: WISHLIST_ACTIONS.ADDED, product, addedAt: Date.now() }),
    [dispatch],
  )
  const removeItem = useCallback((productId) => dispatch({ type: WISHLIST_ACTIONS.REMOVED, productId }), [dispatch])
  const toggleItem = useCallback(
    (product) => (savedIds.has(product.id) ? removeItem(product.id) : addItem(product)),
    [savedIds, addItem, removeItem],
  )
  const clearWishlist = useCallback(() => dispatch({ type: WISHLIST_ACTIONS.CLEARED }), [dispatch])
  const refreshProducts = useCallback(
    (products) => dispatch({ type: WISHLIST_ACTIONS.PRODUCTS_REFRESHED, products }),
    [dispatch],
  )

  /** Adds the saved product to the cart (at its minimum order quantity) and removes it from the wishlist. */
  const moveToCart = useCallback(
    (item) => {
      const product = { ...item, id: item.productId }
      if (item.isUnavailable || !getPurchaseLimits(product).canBuy) return false
      addToCart(product)
      removeItem(item.productId)
      return true
    },
    [addToCart, removeItem],
  )

  const value = useMemo(
    () => ({
      items: wishlist.items,
      count: wishlist.items.length,
      isInWishlist,
      addItem,
      removeItem,
      toggleItem,
      clearWishlist,
      refreshProducts,
      moveToCart,
    }),
    [wishlist.items, isInWishlist, addItem, removeItem, toggleItem, clearWishlist, refreshProducts, moveToCart],
  )

  return <WishlistContext value={value}>{children}</WishlistContext>
}

export default WishlistProvider
