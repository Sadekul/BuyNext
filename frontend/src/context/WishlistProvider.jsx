import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { WishlistContext } from './wishlistContext'
import { EMPTY_WISHLIST, WISHLIST_ACTIONS, mergeWishlists, sanitizeWishlist, wishlistReducer } from '../reducers/wishlistReducer'
import { usePersistentReducer } from '../hooks/usePersistentReducer'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { REAL_SHOP } from '../constants/shop'
import { useAuth } from '../hooks/useAuth'
import { useCart } from '../hooks/useCart'
import { getPurchaseLimits } from '../utils/inventory'
import { ownerStorageKey, readJson, removeKey, writeJson } from '../utils/storage'
import { addWishlistItem, getWishlist, mergeWishlist, removeWishlistItem, updateWishlistNote } from '../services/wishlistService'
import { translate } from '../i18n'

/*
 * Phase 11 (REAL_SHOP): guest items that still have to be sent to the
 * account's server wishlist after signing in ("<key>.user-<id>"). Written
 * when the guest list moves into the account (takeGuest below), removed once
 * the server merged them, so a failed merge is tried again on the next page load.
 */
const pendingKey = (userId) => ownerStorageKey(STORAGE_KEYS.wishlistPending, userId)
function readPending(userId) {
  const stored = readJson(pendingKey(userId), [])
  return Array.isArray(stored) ? stored.filter((productId) => Number.isInteger(productId) && productId > 0) : []
}

function rememberGuestItems(guest, ownerId) {
  const pending = new Set([...readPending(ownerId), ...guest.items.map((item) => item.productId)])
  writeJson(pendingKey(ownerId), [...pending].slice(0, 100))
  return { moved: guest, remaining: null }
}

const STORAGE_OPTIONS = {
  storageKey: STORAGE_KEYS.wishlist,
  emptyState: EMPTY_WISHLIST,
  sanitize: sanitizeWishlist,
  replaceActionType: WISHLIST_ACTIONS.REPLACED,
  mergeGuest: mergeWishlists,
  ...(REAL_SHOP && { takeGuest: rememberGuestItems }),
}

/** The shopper-facing reason a wishlist change didn't stick. */
function failureMessage(error, fallback) {
  if (error?.data?.code === 'wishlist_full') return error.message || translate('catalog:wishlistSync.full', { max: 100 })
  if (error?.status === 0) return translate('catalog:wishlistSync.offline', { reason: fallback })
  return translate('catalog:wishlistSync.retry', { reason: fallback })
}

/*
 * Shared wishlist state, saved in this browser. Each signed-in customer has
 * their own saved list; signing out shows the (empty) guest list, and guest
 * items move into the account on sign-in (see usePersistentReducer).
 *
 * Phase 11, with BuyNest's API (REAL_SHOP) and a signed-in customer: the
 * account's list lives on the SERVER, so it follows them to every device.
 * The browser copy is then a cache: it is replaced by the server's list once
 * per sign-in or page load (after sending the guest's items, once), and every
 * change is shown at once and sent to the server (an optimistic update),
 * then rolled back with a message if the server refuses it. Guests (and the
 * DummyJSON demo) keep the browser-only list.
 *
 * Must be rendered inside <CartProvider>, because "move to cart" uses the cart.
 */
function WishlistProvider({ children }) {
  const { user, status, authorizedRequest } = useAuth()
  const userId = user?.id ?? null
  const [wishlist, dispatch] = usePersistentReducer(wishlistReducer, STORAGE_OPTIONS, userId)
  const { addItem: addToCart } = useCart()
  const onServer = REAL_SHOP && status === 'authenticated' && userId !== null

  // ---- phase 11: the server's list (REAL_SHOP, signed in) ----
  const [serverState, setServerState] = useState({ userId: null, shared: false, loaded: false })
  const [syncError, setSyncError] = useState('')
  const startedForRef = useRef(null)
  const currentUserRef = useRef(null)
  // productId → a promise of the item's server id, while its POST is on its way.
  const pendingAdds = useRef(new Map())

  useEffect(() => {
    currentUserRef.current = onServer ? userId : null
  }, [onServer, userId])

  const loadFromServer = useEffectEvent(async (id) => {
    const pending = readPending(id)
    const result = await authorizedRequest(() => (pending.length > 0 ? mergeWishlist(pending.map((productId) => ({ productId }))) : getWishlist()))
    if (currentUserRef.current !== id) return
    if (pending.length > 0) removeKey(pendingKey(id))
    dispatch({ type: WISHLIST_ACTIONS.SERVER_LOADED, entries: result.items })
    setServerState({ userId: id, shared: result.shared, loaded: true })
  })

  // Once per account and page load (not cancelled by Strict Mode's second run: the ref decides).
  // Runs after usePersistentReducer's guest move, which fills the pending list.
  useEffect(() => {
    if (status === 'anonymous') startedForRef.current = null
    if (!REAL_SHOP || status !== 'authenticated' || userId === null || startedForRef.current === userId) return
    startedForRef.current = userId
    currentUserRef.current = userId
    loadFromServer(userId).catch(() => {
      // Offline or a server problem: the browser copy stays; the next page load tries again.
    })
  }, [status, userId])

  const items = wishlist.items
  // A Set makes "is this product saved?" checks fast for every card on the page.
  const savedIds = useMemo(() => new Set(items.map((item) => item.productId)), [items])
  const isInWishlist = useCallback((productId) => savedIds.has(productId), [savedIds])

  const addItem = useCallback(
    // Date.now() runs here, in an event handler, keeping the reducer pure.
    (product) => {
      dispatch({ type: WISHLIST_ACTIONS.ADDED, product, addedAt: Date.now() })
      if (!onServer) return
      setSyncError('')
      const saving = authorizedRequest(() => addWishlistItem(product.id))
        .then((entry) => {
          dispatch({ type: WISHLIST_ACTIONS.SERVER_ID_SET, productId: product.id, serverId: entry.id })
          return entry.id
        })
        .catch((error) => {
          dispatch({ type: WISHLIST_ACTIONS.REMOVED, productId: product.id })
          setSyncError(failureMessage(error, translate('catalog:wishlistSync.save', { title: product.title })))
          return null
        })
        .finally(() => pendingAdds.current.delete(product.id))
      pendingAdds.current.set(product.id, saving)
    },
    [dispatch, onServer, authorizedRequest],
  )

  const removeItem = useCallback(
    (productId) => {
      const index = items.findIndex((candidate) => candidate.productId === productId)
      const item = items[index]
      dispatch({ type: WISHLIST_ACTIONS.REMOVED, productId })
      if (!onServer || !item) return
      setSyncError('')
      const run = async () => {
        // Still being added: wait for its server id first.
        const serverId = item.serverId ?? (await pendingAdds.current.get(productId))
        if (!serverId) return
        try {
          await authorizedRequest(() => removeWishlistItem(serverId))
        } catch (error) {
          if (error?.status === 404) return // already gone (removed on another device)
          dispatch({ type: WISHLIST_ACTIONS.RESTORED, item: { ...item, serverId }, index })
          setSyncError(failureMessage(error, translate('catalog:wishlistSync.remove', { title: item.title })))
        }
      }
      run()
    },
    [items, dispatch, onServer, authorizedRequest],
  )

  const toggleItem = useCallback((product) => (savedIds.has(product.id) ? removeItem(product.id) : addItem(product)), [savedIds, addItem, removeItem])

  const clearWishlist = useCallback(() => {
    if (onServer) {
      for (const item of items) removeItem(item.productId)
      return
    }
    dispatch({ type: WISHLIST_ACTIONS.CLEARED })
  }, [onServer, items, removeItem, dispatch])

  const refreshProducts = useCallback((products) => dispatch({ type: WISHLIST_ACTIONS.PRODUCTS_REFRESHED, products }), [dispatch])

  /** Phase 11 (server list only): the shopper's note on an item. Resolves to true when it was saved. */
  const setNote = useCallback(
    async (productId, note) => {
      const item = items.find((candidate) => candidate.productId === productId)
      if (!onServer || !item) return false
      const serverId = item.serverId ?? (await pendingAdds.current.get(productId))
      if (!serverId) return false
      const previous = item.note ?? null
      const next = note.trim() || null
      dispatch({ type: WISHLIST_ACTIONS.NOTE_SET, productId, note: next })
      setSyncError('')
      try {
        await authorizedRequest(() => updateWishlistNote(serverId, next))
        return true
      } catch (error) {
        dispatch({ type: WISHLIST_ACTIONS.NOTE_SET, productId, note: previous })
        setSyncError(failureMessage(error, translate('catalog:wishlistSync.note', { title: item.title })))
        return false
      }
    },
    [items, onServer, dispatch, authorizedRequest],
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

  const shared = onServer && serverState.userId === userId && serverState.shared
  const setShared = useCallback((value) => setServerState((current) => ({ ...current, shared: value })), [])
  const dismissError = useCallback(() => setSyncError(''), [])

  const value = useMemo(
    () => ({
      items,
      count: items.length,
      isInWishlist,
      addItem,
      removeItem,
      toggleItem,
      clearWishlist,
      refreshProducts,
      moveToCart,
      // Phase 11: whether the list is the account's server list, its sharing state, notes, and failures.
      onServer,
      shared,
      setShared,
      setNote,
      syncError: onServer ? syncError : '',
      dismissError,
    }),
    [items, isInWishlist, addItem, removeItem, toggleItem, clearWishlist, refreshProducts, moveToCart, onServer, shared, setShared, setNote, syncError, dismissError],
  )

  return <WishlistContext value={value}>{children}</WishlistContext>
}

export default WishlistProvider
