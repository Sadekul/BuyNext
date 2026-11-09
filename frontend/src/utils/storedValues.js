/*
 * Type checks for data read back from localStorage. Anyone can edit storage
 * in DevTools (or a script running on the page could), so every stored field
 * is checked before React renders it: a wrong type, such as an object where
 * text is expected, would otherwise crash the page on every load.
 * Each helper returns the value when it is valid, or null.
 */

/** A string, or null. */
export function storedText(value) {
  return typeof value === 'string' ? value : null
}

/** A finite number within [min, max], or null. */
export function storedNumber(value, min = -Infinity, max = Infinity) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

/** A whole number within [min, max], or null. */
export function storedInteger(value, min = -Infinity, max = Infinity) {
  return Number.isInteger(value) ? storedNumber(value, min, max) : null
}

// The largest timestamp a JavaScript Date accepts.
const MAX_TIMESTAMP = 8.64e15

/** A millisecond timestamp that makes a valid Date, or null. */
export function storedTimestamp(value) {
  return storedInteger(value, 0, MAX_TIMESTAMP)
}

/** A plain object whose listed keys all hold strings (or are missing, if optional). */
export function isTextRecord(value, requiredKeys, optionalKeys = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    requiredKeys.every((key) => typeof value[key] === 'string') &&
    optionalKeys.every((key) => value[key] == null || typeof value[key] === 'string')
  )
}

/**
 * The product snapshot fields shared by cart and wishlist lines. Missing or
 * invalid optional fields become null, which the pricing and stock helpers
 * already treat as "unknown".
 */
export function storedProductSnapshot(item) {
  return {
    title: storedText(item.title),
    brand: storedText(item.brand),
    category: storedText(item.category),
    thumbnail: storedText(item.thumbnail),
    price: storedNumber(item.price, 0),
    discountPercentage: storedNumber(item.discountPercentage, 0, 100),
    stock: storedInteger(item.stock, 0),
    minimumOrderQuantity: storedInteger(item.minimumOrderQuantity, 1),
    availabilityStatus: storedText(item.availabilityStatus),
    isUnavailable: item.isUnavailable === true,
  }
}
