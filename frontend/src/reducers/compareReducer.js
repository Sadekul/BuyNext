import { storedText } from '../utils/storedValues'

/*
 * Phase 11 §2: the products picked for comparison, in this browser (guests
 * and the demo too). One entry per product, at most MAX_COMPARE, in the order
 * they were picked. Only what the sticky bar shows is kept; the compare page
 * loads the products themselves.
 */

export const MAX_COMPARE = 4

export const COMPARE_ACTIONS = {
  ADDED: 'compare/added',
  REMOVED: 'compare/removed',
  CLEARED: 'compare/cleared',
  REPLACED: 'compare/replaced',
}

export const EMPTY_COMPARE = { items: [] }

export function compareReducer(state, action) {
  switch (action.type) {
    case COMPARE_ACTIONS.ADDED: {
      const { product } = action
      if (state.items.length >= MAX_COMPARE || state.items.some((item) => item.id === product.id)) return state
      return { items: [...state.items, { id: product.id, title: product.title, thumbnail: product.thumbnail ?? null }] }
    }
    case COMPARE_ACTIONS.REMOVED:
      return { items: state.items.filter((item) => item.id !== action.id) }
    case COMPARE_ACTIONS.CLEARED:
      return EMPTY_COMPARE
    case COMPARE_ACTIONS.REPLACED:
      return action.state
    default:
      return state
  }
}

/** Stored data is checked: whole-number ids, a title, no duplicates, at most MAX_COMPARE. */
export function sanitizeCompare(value) {
  if (!value || !Array.isArray(value.items)) return EMPTY_COMPARE
  const items = []
  for (const stored of value.items) {
    if (!stored || !Number.isInteger(stored.id) || stored.id <= 0 || typeof stored.title !== 'string') continue
    if (items.some((item) => item.id === stored.id)) continue
    items.push({ id: stored.id, title: stored.title, thumbnail: storedText(stored.thumbnail) })
    if (items.length === MAX_COMPARE) break
  }
  return { items }
}
