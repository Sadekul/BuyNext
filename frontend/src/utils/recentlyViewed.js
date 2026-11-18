import { useSyncExternalStore } from 'react'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { readJson, removeKey, writeJson } from './storage'
import { storedInteger, storedNumber, storedProductSnapshot } from './storedValues'

/*
 * Phase 11 §6: the last 12 products opened in this browser, newest first,
 * each once. Browser only (localStorage, never sent to the server, so not
 * part of the data export); works in the demo too. Each entry is the
 * product-card snapshot, so the "Recently viewed" rows need no request.
 */

export const MAX_RECENTLY_VIEWED = 12
const KEY = STORAGE_KEYS.recentlyViewed

function sanitize(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const products = []
  for (const stored of value) {
    if (!stored || !Number.isInteger(stored.id) || stored.id <= 0 || seen.has(stored.id)) continue
    const snapshot = storedProductSnapshot(stored)
    if (snapshot.title === null || snapshot.price === null) continue
    seen.add(stored.id)
    products.push({
      id: stored.id,
      ...snapshot,
      discountPercentage: snapshot.discountPercentage ?? 0,
      rating: storedNumber(stored.rating, 0, 5),
      stock: storedInteger(stored.stock, 0),
      minimumOrderQuantity: snapshot.minimumOrderQuantity ?? 1,
      ...(stored.hasVariants === true && { hasVariants: true }),
      ...(stored.type === 'gift_card' && { type: 'gift_card' }),
    })
    if (products.length === MAX_RECENTLY_VIEWED) break
  }
  return products
}

// The list is re-read only when the stored text changes, so the snapshot stays the same
// object between renders (useSyncExternalStore needs that) and follows other tabs.
let cachedRaw
let cache = []
const listeners = new Set()
function rawValue() {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}
function read() {
  const raw = rawValue()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cache = sanitize(readJson(KEY, []))
  }
  return cache
}
function emit() {
  for (const listener of listeners) listener()
}
function subscribe(listener) {
  listeners.add(listener)
  // Another tab opened a product: re-read.
  const onStorage = (event) => {
    if (event.key === KEY || event.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Remembers a product the shopper opened (moved to the front if it was there already). */
export function recordRecentlyViewed(product) {
  if (!product || !Number.isInteger(product.id)) return
  const entry = {
    id: product.id,
    title: product.title,
    brand: product.brand ?? null,
    category: product.category ?? null,
    thumbnail: product.thumbnail ?? null,
    price: product.price,
    discountPercentage: product.discountPercentage ?? 0,
    rating: product.rating ?? null,
    stock: product.stock ?? null,
    minimumOrderQuantity: product.minimumOrderQuantity ?? 1,
    availabilityStatus: product.availabilityStatus ?? null,
    ...(product.hasVariants === true && { hasVariants: true }),
    ...(product.type === 'gift_card' && { type: 'gift_card' }),
  }
  const next = sanitize([entry, ...read().filter((item) => item.id !== product.id)])
  writeJson(KEY, next)
  emit()
}

export function clearRecentlyViewed() {
  removeKey(KEY)
  emit()
}

/** The recently viewed products (newest first), re-rendering when they change. */
export function useRecentlyViewed() {
  return useSyncExternalStore(subscribe, read, read)
}
