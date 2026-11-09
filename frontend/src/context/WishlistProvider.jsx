import { useCallback, useMemo } from 'react'
import { WishlistContext } from './wishlistContext'
import { EMPTY_WISHLIST, WISHLIST_ACTIONS, mergeWishlists, sanitizeWishlist, wishlistReducer } from '../reducers/wishlistReducer'
import { usePersistentReducer } from '../hooks/usePersistentReducer'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { useAuth } from '../hooks/useAuth'
import { useCart } from '../hooks/useCart'
import { getPurchaseLimits } from '../utils/inventory'

const STORAGE_OPTIONS = {
  storageKey: STORAGE_KEYS.wishlist,
  emptyState: EMPTY_WISHLIST,
  sanitize: sanitizeWishlist,
  replaceActionType: WISHLIST_ACTIONS.REPLACED,
  mergeGuest: mergeWishlists,
}

/*
 * Shared wishlist state, saved in this browser. Each signed-in customer has
 * their own saved list; signing out shows the (empty) guest list, and guest
 * items move into the account on sign-in (see usePersistentReducer). With a
 * real backend the account list is stored on the server instead.
 *
 * Must be rendered inside <CartProvider>, because "move to cart" uses the cart.
 */
function WishlistProvider({ children }) {
  const { user } = useAuth()
  const [wishlist, dispatch] = usePersistentReducer(wishlistReducer, STORAGE_OPTIONS, user?.id)
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
