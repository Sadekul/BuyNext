/*
 * Phase 11 §2 and §3 in the product form: specification rows ({ label, value },
 * at most 40, labels unique ignoring case) and linked products (related,
 * up-sells, cross-sells: at most 20 of each, never the product itself). The
 * server checks the same; its messages appear on the sections.
 */

export const MAX_SPECIFICATIONS = 40
export const MAX_LINKS = 20

export const LINK_TYPES = [
  { id: 'related', label: 'Related products', noun: 'related product', hint: 'Shown under the product as "Related products". Without any, the store picks products of the same category.' },
  { id: 'upsell', label: 'Up-sells', noun: 'up-sell', hint: 'Better or pricier choices, shown above the reviews as "You may also like".' },
  { id: 'crosssell', label: 'Cross-sells', noun: 'cross-sell', hint: 'Shown in the cart as "Customers also bought" when this product is in it.' },
]
export const EMPTY_LINKS = { related: [], upsell: [], crosssell: [] }

let rowKey = 0
/** A row with a key of its own, so React keeps focus on it while rows move. */
export const specRow = (row = { label: '', value: '' }) => ({ label: row.label ?? '', value: row.value ?? '', key: `spec-${rowKey++}` })

/** The product's links → the form's lists (every type present). */
export const linkLists = (links) => Object.fromEntries(LINK_TYPES.map(({ id }) => [id, Array.isArray(links?.[id]) ? links[id] : []]))

/** Problems by row: { rows: { 2: { label: '…' } }, list: '…' } ({} when it can be sent). Empty rows are dropped, not errors. */
export function specificationErrors(rows) {
  const filled = rows.map((row, index) => ({ index, label: row.label.trim(), value: row.value.trim() })).filter((row) => row.label || row.value)
  const errors = { rows: {} }
  if (filled.length > MAX_SPECIFICATIONS) errors.list = `Keep up to ${MAX_SPECIFICATIONS} rows.`
  const seen = new Map()
  for (const row of filled) {
    const found = {}
    if (!row.label) found.label = 'Give this row a label.'
    else if (row.label.length > 60) found.label = 'Keep the label under 60 characters.'
    else if (seen.has(row.label.toLowerCase())) found.label = `"${row.label}" is already row ${seen.get(row.label.toLowerCase()) + 1}: each label once.`
    else seen.set(row.label.toLowerCase(), row.index)
    if (!row.value) found.value = 'Give this row a value.'
    else if (row.value.length > 255) found.value = 'Keep the value under 255 characters.'
    if (Object.keys(found).length > 0) errors.rows[row.index] = found
  }
  if (!errors.list && Object.keys(errors.rows).length > 0) errors.list = 'Check the highlighted rows.'
  return errors.list ? errors : {}
}

/** The rows → what is saved (trimmed, empty rows left out). */
export const toSpecifications = (rows) => rows.map((row) => ({ label: row.label.trim(), value: row.value.trim() })).filter((row) => row.label || row.value)

/** The lists → { related: [ids], upsell: [ids], crosssell: [ids] }. */
export const toLinkIds = (lists) => Object.fromEntries(LINK_TYPES.map(({ id }) => [id, (lists[id] ?? []).map((product) => product.id)]))

/** Whether two values differ (the form only sends specifications or links when they changed). */
export const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b)

/** A list with the entry at `index` moved by `step` (−1 up, +1 down). */
export function moved(list, index, step) {
  const next = [...list]
  const [entry] = next.splice(index, 1)
  next.splice(index + step, 0, entry)
  return next
}
