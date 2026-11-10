import { useEffect, useReducer, useState } from 'react'
import { ownerStorageKey, readJson, removeKey, writeJson } from '../utils/storage'

const hasNoItems = (state) => state.items.length === 0
const takeAllGuest = (guest) => ({ moved: guest, remaining: null })

/**
 * useReducer whose state is saved to localStorage and kept in sync between
 * browser tabs. Used by the cart, the wishlist, and demo orders.
 *
 *   const [state, dispatch] = usePersistentReducer(reducer, {
 *     storageKey: 'buynest.cart.v1',
 *     emptyState: EMPTY_CART,
 *     sanitize: sanitizeCart,        // validates data read from storage
 *     replaceActionType: 'cart/replaced',
 *     mergeGuest: mergeCarts,        // (accountState, guestState) => state
 *     takeGuest, isEmpty,            // optional, see the merge effect below
 *   }, user?.id)
 *
 * OWNERSHIP: each signed-in customer gets their own saved copy
 * ("buynest.cart.v1.user-1"); guests use the base key. When the owner changes
 * (sign-in, sign-out, an expired session, sign-out in another tab), the
 * state switches to that owner's copy, so the next person on this device
 * never sees the previous customer's items. When a customer is signed in and
 * guest items exist (added before signing in), they are merged into the
 * account and the guest copy is emptied.
 *
 * Pass module-level constants for the options so the effects stay stable.
 */
export function usePersistentReducer(reducer, options, ownerId = null) {
  const {
    storageKey,
    emptyState,
    sanitize,
    replaceActionType,
    mergeGuest,
    takeGuest = takeAllGuest,
    isEmpty = hasNoItems,
  } = options
  const activeKey = ownerStorageKey(storageKey, ownerId)
  const load = (key) => sanitize(readJson(key, emptyState))

  // Lazy initializer: read storage on the first render only.
  const [state, dispatch] = useReducer(reducer, undefined, () => load(activeKey))

  // The owner changed: show their saved copy. Adjusting state DURING render
  // (not in an effect) means React never commits a frame, or saves to
  // storage, with one customer's items under another customer's key.
  const [loadedKey, setLoadedKey] = useState(activeKey)
  if (loadedKey !== activeKey) {
    setLoadedKey(activeKey)
    dispatch({ type: replaceActionType, state: load(activeKey) })
  }

  // Save after every change. The effect only writes to storage (no setState).
  useEffect(() => {
    writeJson(activeKey, state)
  }, [activeKey, state])

  // Signed in with guest items waiting: move them into the account.
  // `takeGuest` picks what belongs to this account (default: everything);
  // whatever it leaves stays in the guest copy.
  // Storage is updated HERE, in order: the merged account copy is written
  // first, the guest copy removed second. There is never a moment when the
  // items exist in neither (a reload right after signing in used to lose
  // them, because the merged state was only saved after the next render).
  // The account copy in storage equals `state` here: the save effect above
  // runs first in the same commit.
  useEffect(() => {
    if (activeKey === storageKey || !mergeGuest) return
    const guest = sanitize(readJson(storageKey, emptyState))
    if (isEmpty(guest)) return
    const { moved, remaining } = takeGuest(guest, ownerId)
    if (!isEmpty(moved)) {
      const merged = mergeGuest(sanitize(readJson(activeKey, emptyState)), moved)
      writeJson(activeKey, merged)
      dispatch({ type: replaceActionType, state: merged })
    }
    if (remaining && !isEmpty(remaining)) writeJson(storageKey, remaining)
    else removeKey(storageKey)
  }, [activeKey, storageKey, ownerId, emptyState, sanitize, replaceActionType, mergeGuest, takeGuest, isEmpty])

  // The `storage` event fires in OTHER tabs when this key changes.
  useEffect(() => {
    function handleStorage(event) {
      if (event.key !== activeKey) return
      dispatch({ type: replaceActionType, state: sanitize(readJson(activeKey, emptyState)) })
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [activeKey, emptyState, sanitize, replaceActionType])

  return [state, dispatch]
}
