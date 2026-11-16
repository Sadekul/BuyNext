import { useEffect, useEffectEvent, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { REAL_SHOP } from '../constants/shop'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { CART_ACTIONS, EMPTY_CART, cartLineKey, sanitizeCart } from '../reducers/cartReducer'
import { getSavedCart, mergeSavedCart, validateCart } from '../services/shopService'
import { ownerStorageKey, readJson, removeKey, writeJson } from '../utils/storage'

/*
 * A signed-in customer's cart follows them to another device (REAL_SHOP,
 * backend phase 7 §6). The server saves the account's cart each time the
 * cart or checkout page has it priced; this hook brings that cart back.
 *
 * THE PROBLEM: "merge the local cart into the server's, adding quantities"
 * would count twice whatever this device already sent. So each account
 * remembers here which lines the server last saved from this device (the
 * "baseline", STORAGE_KEYS.cartSync), and only the DIFFERENCE moves:
 *   - right after signing in: lines added on this device since the baseline
 *     (a guest cart, items added without opening the cart) are added to the
 *     server's cart (POST /api/shop/me/cart/merge, once), and the answer
 *     becomes this cart;
 *   - a session that continues (a reload, a new tab), once per browser
 *     session: what the server gained since the baseline (another device) is
 *     added here (GET /api/shop/me/cart).
 * Quantities are capped by stock on both sides.
 */

const SESSION_FLAG = 'buynest.cartRestored'
// Set (in localStorage, shared by tabs) while a sign-in merge is running, so
// another tab that sees the new session doesn't fetch the half-merged cart and
// add it again; that tab gets the merged cart through the storage event instead.
const MERGE_LOCK = 'buynest.cartMerging'
const LOCK_MS = 30_000
const lockKey = (userId) => `${MERGE_LOCK}.user-${userId}`
const isMergeRunning = (userId) => {
  const startedAt = readJson(lockKey(userId), 0)
  return Number.isFinite(startedAt) && Date.now() - startedAt < LOCK_MS
}
const baselineKey = (userId) => ownerStorageKey(STORAGE_KEYS.cartSync, userId)

/** { "12": 2, "15:7": 1 } (cartLineKey → quantity) from cart lines. */
const quantitiesOf = (lines) => Object.fromEntries(lines.map((line) => [cartLineKey(line), line.quantity]))

function readBaseline(userId) {
  const stored = readJson(baselineKey(userId), {})
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  return Object.fromEntries(Object.entries(stored).filter(([key, quantity]) => /^\d+(:\d+)?$/.test(key) && Number.isInteger(quantity) && quantity > 0))
}

export function writeSavedCartBaseline(userId, quantities) {
  writeJson(baselineKey(userId), quantities)
}

/** The cart-pricing query key's lines ("12x2", "15v7x1") → baseline quantities. */
export function quantitiesFromPricingKey(lines) {
  const quantities = {}
  for (const line of Array.isArray(lines) ? lines : []) {
    const match = /^(\d+)(?:v(\d+))?x(\d+)$/.exec(line)
    if (match) quantities[match[2] ? `${match[1]}:${match[2]}` : match[1]] = Number(match[3])
  }
  return quantities
}

function sessionFlag(userId) {
  try {
    return window.sessionStorage.getItem(`${SESSION_FLAG}.${userId}`) === '1'
  } catch {
    return false
  }
}
function setSessionFlag(userId) {
  try {
    window.sessionStorage.setItem(`${SESSION_FLAG}.${userId}`, '1')
  } catch {
    // Private mode: the restore may run again in another tab; the baseline still prevents doubling.
  }
}

/** Lines whose quantity is above the baseline, with just the extra quantity. */
function linesAbove(lines, baseline) {
  return lines
    .map((line) => ({ ...line, quantity: line.quantity - (baseline[cartLineKey(line)] ?? 0) }))
    .filter((line) => line.quantity > 0)
}

export function useSavedCartSync({ status, userId, itemCount, dispatch, authorizedRequest }) {
  const queryClient = useQueryClient()
  const previousStatusRef = useRef(status)
  const startedForRef = useRef(null) // the account this page already synced (or is syncing)
  const currentUserRef = useRef(userId)

  useEffect(() => {
    currentUserRef.current = status === 'authenticated' ? userId : null
  }, [status, userId])

  const sync = useEffectEvent(async (id, freshSignIn) => {
    // The account's cart as storage has it now: the guest cart was already
    // moved into it by usePersistentReducer (its effect runs first).
    const local = sanitizeCart(readJson(ownerStorageKey(STORAGE_KEYS.cart, id), EMPTY_CART))
    const baseline = readBaseline(id)
    const stillSignedIn = () => currentUserRef.current === id
    if (freshSignIn) {
      const toAdd = linesAbove(local.items.filter((item) => !item.isUnavailable), baseline)
      writeJson(lockKey(id), Date.now())
      let saved
      try {
        saved = await authorizedRequest(() => (toAdd.length > 0 ? mergeSavedCart(toAdd) : getSavedCart()))
      } finally {
        removeKey(lockKey(id))
      }
      if (!stillSignedIn()) return
      // The merge is done on the server: record it before anything else can fail.
      writeSavedCartBaseline(id, quantitiesOf(saved.items))
      // An empty answer while nothing was sent: keep what's here (the server has nothing yet).
      if (saved.items.length > 0 || toAdd.length > 0) dispatch({ type: CART_ACTIONS.SAVED_CART_LOADED, lines: saved.items, mode: 'replace' })
    } else {
      // Another tab is merging right now: its result reaches this tab through storage.
      if (isMergeRunning(id)) return
      const saved = await authorizedRequest(() => getSavedCart())
      if (!stillSignedIn()) return
      writeSavedCartBaseline(id, quantitiesOf(saved.items))
      const gained = linesAbove(saved.items, baseline)
      if (gained.length > 0) dispatch({ type: CART_ACTIONS.SAVED_CART_LOADED, lines: gained, mode: 'add' })
    }
    setSessionFlag(id)
  })

  /*
   * Once per account and page load. Not cancelled when the effect re-runs
   * (React's Strict Mode runs effects twice in development): a merge that
   * reached the server must not be sent again, so the ref, not the effect's
   * lifetime, decides. A result for an account that has signed out since is ignored.
   */
  useEffect(() => {
    const previous = previousStatusRef.current
    previousStatusRef.current = status
    if (status === 'anonymous') startedForRef.current = null
    if (!REAL_SHOP || status !== 'authenticated' || !userId || startedForRef.current === userId) return
    startedForRef.current = userId
    const freshSignIn = previous === 'anonymous'
    if (!freshSignIn && sessionFlag(userId)) return
    sync(userId, freshSignIn).catch(() => {
      // Offline or a server problem: the local cart stays as it is. A failed
      // GET is tried again on the next page load; a failed merge isn't retried
      // here (it may have reached the server), the baseline keeps what was sent before.
    })
  }, [status, userId])

  // Emptied without the cart page (the drawer's remove button, for example):
  // the server only saves a cart when it prices one, so tell it the cart is
  // now empty. Otherwise the old lines would come back at the next sign-in.
  const clearSaved = useEffectEvent(async (id) => {
    if (Object.keys(readBaseline(id)).length === 0) return
    await authorizedRequest(() => validateCart({ items: [] }))
    if (currentUserRef.current === id) writeSavedCartBaseline(id, {})
  })
  useEffect(() => {
    if (!REAL_SHOP || status !== 'authenticated' || !userId || itemCount !== 0) return
    // While the sign-in restore is running, an empty cart is just "not loaded yet".
    if (isMergeRunning(userId) || startedForRef.current !== userId || !sessionFlag(userId)) return
    clearSaved(userId).catch(() => {
      // Offline: the next priced cart (or the next empty one) corrects the server.
    })
  }, [status, userId, itemCount])

  // Each time the server prices the cart for the signed-in customer, it saves
  // it: what was sent becomes the new baseline.
  useEffect(() => {
    if (!REAL_SHOP || status !== 'authenticated' || !userId) return undefined
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action?.type !== 'success') return
      const [name, lines] = event.query.queryKey
      if (name === 'cart-pricing') writeSavedCartBaseline(userId, quantitiesFromPricingKey(lines))
    })
  }, [queryClient, status, userId])
}
