import { useEffect, useReducer } from 'react'
import { readJson, writeJson } from '../utils/storage'

/**
 * useReducer whose state is saved to localStorage and kept in sync between
 * browser tabs. Used by the cart and the wishlist.
 *
 *   const [state, dispatch] = usePersistentReducer(reducer, {
 *     storageKey: 'buynest.cart.v1',
 *     emptyState: EMPTY_CART,
 *     sanitize: sanitizeCart,        // validates data read from storage
 *     replaceActionType: 'cart/replaced',
 *   })
 *
 * Pass module-level constants for the options so the effects stay stable.
 */
export function usePersistentReducer(reducer, { storageKey, emptyState, sanitize, replaceActionType }) {
  // Lazy initializer: read storage once, on the first render only.
  const [state, dispatch] = useReducer(reducer, undefined, () => sanitize(readJson(storageKey, emptyState)))

  // Save after every change. The effect only writes to storage (no setState).
  useEffect(() => {
    writeJson(storageKey, state)
  }, [storageKey, state])

  // The `storage` event fires in OTHER tabs when this key changes.
  useEffect(() => {
    function handleStorage(event) {
      if (event.key !== storageKey) return
      dispatch({ type: replaceActionType, state: sanitize(readJson(storageKey, emptyState)) })
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [storageKey, emptyState, sanitize, replaceActionType])

  return [state, dispatch]
}
