/*
 * Phase 10 §4: shipping table rates. The form's text values, the checks
 * done here before saving (the server checks again: its 422 messages appear
 * on the same fields), and words for the table.
 */

export const SHIPPING_METHODS = [
  { id: 'standard', label: 'Standard' },
  { id: 'express', label: 'Express' },
  { id: 'nextDay', label: 'Next day' },
]
export const methodLabel = (id) => SHIPPING_METHODS.find((method) => method.id === id)?.label ?? id

const text = (value) => (value === null || value === undefined ? '' : String(value))
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

/** A saved rate (or { method } for a new one) → the form's text values. */
export function rateFormValues(rate) {
  return {
    method: rate.method ?? 'standard',
    country: rate.country ?? '*',
    minWeightGrams: text(rate.minWeightGrams ?? 0),
    maxWeightGrams: text(rate.maxWeightGrams),
    minSubtotal: text(rate.minSubtotal ?? 0),
    maxSubtotal: text(rate.maxSubtotal),
    price: text(rate.price),
  }
}

/** The form's problems by field ({} when it can be saved). */
export function rateErrors(values) {
  const errors = {}
  const country = values.country.trim()
  if (!SHIPPING_METHODS.some((method) => method.id === values.method)) errors.method = ['Choose a method.']
  // A country name as in Settings → Checkout (the shopper's address country), or "*".
  if (!country || country.length > 60) errors.country = ['Enter a country name (as in Settings → Checkout), or * for any country.']
  const grams = (key, optional) => {
    const raw = values[key].trim()
    if (raw === '') return optional ? null : (errors[key] = ['Enter a whole number of grams.'], undefined)
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
      errors[key] = ['Enter a whole number of grams from 0 to 1,000,000.']
      return undefined
    }
    return value
  }
  const money = (key, optional) => {
    const raw = values[key].trim()
    if (raw === '') return optional ? null : (errors[key] = ['Enter an amount.'], undefined)
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000 || !hasCents(value)) {
      errors[key] = ['Enter an amount of 0 or more, with at most 2 decimals.']
      return undefined
    }
    return value
  }
  const minWeight = grams('minWeightGrams', false)
  const maxWeight = grams('maxWeightGrams', true)
  const minSubtotal = money('minSubtotal', false)
  const maxSubtotal = money('maxSubtotal', true)
  money('price', false)
  if (Number.isInteger(minWeight) && Number.isInteger(maxWeight) && maxWeight <= minWeight) errors.maxWeightGrams = ['The maximum weight must be more than the minimum.']
  if (typeof minSubtotal === 'number' && typeof maxSubtotal === 'number' && maxSubtotal <= minSubtotal) errors.maxSubtotal = ['The maximum order value must be more than the minimum.']
  return errors
}

/** Checked form values → what the admin service takes (numbers; null = no maximum). */
export function toRateValues(values) {
  const optional = (raw) => (raw.trim() === '' ? null : Number(raw))
  return {
    method: values.method,
    country: values.country.trim(),
    minWeightGrams: Number(values.minWeightGrams),
    maxWeightGrams: optional(values.maxWeightGrams),
    minSubtotal: Number(values.minSubtotal),
    maxSubtotal: optional(values.maxSubtotal),
    price: Number(values.price),
  }
}

/**
 * A range as the server applies it (min ≤ x < max): "Any", "From 2,000 g",
 * "Under 1,000 g", "500 g to under 1,000 g".
 */
export function describeRange(min, max, format) {
  const hasMin = typeof min === 'number' && min > 0
  const hasMax = typeof max === 'number'
  if (!hasMin && !hasMax) return 'Any'
  if (hasMin && !hasMax) return `From ${format(min)}`
  if (!hasMin) return `Under ${format(max)}`
  return `${format(min)} to under ${format(max)}`
}

const CSV_COLUMNS = { method: 'method', country: 'country', minWeightGrams: 'min_weight_grams', maxWeightGrams: 'max_weight_grams', minSubtotal: 'min_subtotal', maxSubtotal: 'max_subtotal', price: 'price', position: 'position' }

/**
 * A refused CSV import's errors ({ "rows.3.price": [msg] }) → [{ key, row, column, message }],
 * by row. The API counts rows as the file's line numbers (the header is line 1).
 */
export function csvRowProblems(fieldErrors) {
  return Object.entries(fieldErrors ?? {})
    .map(([field, messages]) => {
      const match = /^rows\.(\d+)(?:\.(\w+))?$/.exec(field)
      if (!match) return null
      return { key: field, row: Number(match[1]) + ROW_OFFSET, column: match[2] ? (CSV_COLUMNS[match[2]] ?? match[2]) : null, message: messages?.[0] ?? '' }
    })
    .filter(Boolean)
    .sort((a, b) => a.row - b.row)
}
// rows.N → line N + ROW_OFFSET of the file.
const ROW_OFFSET = 0

/** "Standard rate for US" / "Express rate for any country", for messages. */
// Phase 14: "Standard rate for Inside Dhaka" when the row is for a delivery zone.
export const rateName = (rate, zoneName) =>
  `${methodLabel(rate.method)} rate for ${rate.zoneCode ? (zoneName ?? rate.zoneCode) : rate.country === '*' ? 'any country' : rate.country}`

/*
 * Phase 14 §3: a rate row can be for one delivery zone of Bangladesh
 * (zoneCode; empty = any address of its country) and say how long delivery
 * takes (etaDaysMin–etaDaysMax days). Only used when the store has zones.
 */

/** The zone fields' text values. */
export const zoneRateFormValues = (rate) => ({ zoneCode: rate.zoneCode ?? '', etaDaysMin: text(rate.etaDaysMin), etaDaysMax: text(rate.etaDaysMax) })

/** Their problems by field. */
export function zoneRateErrors(values) {
  const errors = {}
  const days = (key) => {
    const raw = values[key].trim()
    if (raw === '') return null
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0 || value > 60) {
      errors[key] = ['Enter a whole number of days from 0 to 60, or leave it empty.']
      return undefined
    }
    return value
  }
  const min = days('etaDaysMin')
  const max = days('etaDaysMax')
  if (Number.isInteger(min) && Number.isInteger(max) && max < min) errors.etaDaysMax = ['The longest time can’t be shorter than the shortest.']
  if (values.zoneCode && values.country.trim() !== '*' && !/^(bd|bangladesh)$/i.test(values.country.trim())) errors.country = ['A zone rate is for Bangladesh: enter Bangladesh, or * for any country.']
  return errors
}

/** → { zoneCode (null = any zone), etaDaysMin, etaDaysMax } (null = not said). */
export const toZoneRateValues = (values) => ({
  zoneCode: values.zoneCode || null,
  etaDaysMin: values.etaDaysMin.trim() === '' ? null : Number(values.etaDaysMin),
  etaDaysMax: values.etaDaysMax.trim() === '' ? null : Number(values.etaDaysMax),
})
