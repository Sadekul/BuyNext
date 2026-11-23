import { useCallback, useMemo, useState } from 'react'
import { CompareContext } from './compareContext'
import { COMPARE_ACTIONS, EMPTY_COMPARE, MAX_COMPARE, compareReducer, sanitizeCompare } from '../reducers/compareReducer'
import { usePersistentReducer } from '../hooks/usePersistentReducer'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { translate } from '../i18n'

const STORAGE_OPTIONS = {
  storageKey: STORAGE_KEYS.compare,
  emptyState: EMPTY_COMPARE,
  sanitize: sanitizeCompare,
  replaceActionType: COMPARE_ACTIONS.REPLACED,
}

export const COMPARE_FULL_MESSAGE = `You can compare up to ${MAX_COMPARE} products. Remove one to add another.`

/*
 * Phase 11 §2: the products picked for comparison. Kept per BROWSER (no
 * owner id: it isn't account data), so it works for guests and in the demo,
 * and stays in sync between tabs (usePersistentReducer).
 * `notice` is the last message for the shopper ("You can compare up to 4…"),
 * shown and announced by the compare bar.
 */
function CompareProvider({ children }) {
  const [state, dispatch] = usePersistentReducer(compareReducer, STORAGE_OPTIONS, null)
  const [notice, setNotice] = useState('')

  const ids = useMemo(() => new Set(state.items.map((item) => item.id)), [state.items])
  const isInCompare = useCallback((id) => ids.has(id), [ids])

  /** Adds the product, or says the list is full. → 'added' | 'full' | 'present'. */
  const addItem = useCallback(
    (product) => {
      if (ids.has(product.id)) return 'present'
      if (ids.size >= MAX_COMPARE) {
        setNotice(translate('catalog:compare.full', { max: MAX_COMPARE }))
        return 'full'
      }
      dispatch({ type: COMPARE_ACTIONS.ADDED, product })
      setNotice(translate('catalog:compare.added', { title: product.title, count: ids.size + 1, max: MAX_COMPARE }))
      return 'added'
    },
    [ids, dispatch],
  )
  const removeItem = useCallback(
    (id) => {
      dispatch({ type: COMPARE_ACTIONS.REMOVED, id })
      setNotice('')
    },
    [dispatch],
  )
  const toggleItem = useCallback((product) => (ids.has(product.id) ? (removeItem(product.id), 'removed') : addItem(product)), [ids, addItem, removeItem])
  const clear = useCallback(() => {
    dispatch({ type: COMPARE_ACTIONS.CLEARED })
    setNotice('')
  }, [dispatch])

  const value = useMemo(
    () => ({ items: state.items, count: state.items.length, max: MAX_COMPARE, isInCompare, addItem, removeItem, toggleItem, clear, notice, dismissNotice: () => setNotice('') }),
    [state.items, isInCompare, addItem, removeItem, toggleItem, clear, notice],
  )

  return <CompareContext value={value}>{children}</CompareContext>
}

export default CompareProvider
