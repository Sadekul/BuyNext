import { useSyncExternalStore } from 'react'
import { readJson, removeKey, writeJson } from './storage'
import { STORAGE_KEYS } from '../constants/storageKeys'

/*
 * Phase 11 display currencies (docs/backend/PHASE11_CONTRACT.md §5). The
 * store always CHARGES in its base currency (USD); a shopper may choose to
 * SEE prices in another one (e.g. BDT), at the rate the staff typed in.
 *
 * One small store outside React, because formatPrice() (utils/formatters.js)
 * is a plain function called from components, reducers, and strings alike:
 *   - `available`: the store's display currencies (GET /store `currencies`,
 *     set by useCurrencySync once the settings load). Empty in the demo.
 *   - `chosenCode`: the shopper's choice, kept in localStorage.
 *   - `active`: the chosen currency when it is available, else null (= base).
 * Components re-render on a change through useDisplayCurrency(); App
 * subscribes, so the whole page shows the new currency at once.
 */

let available = []
let chosenCode = readChoice()
let snapshot = buildSnapshot()
const listeners = new Set()

function readChoice() {
  const value = readJson(STORAGE_KEYS.currency, null)
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null
}

function buildSnapshot() {
  const active = available.find((currency) => currency.code === chosenCode) ?? null
  return { available, chosenCode, active }
}

function emit() {
  snapshot = buildSnapshot()
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => snapshot

/** A display currency from the store settings, checked (a bad rate would show nonsense prices). */
export function sanitizeCurrency(raw) {
  if (!raw || typeof raw !== 'object') return null
  const code = typeof raw.code === 'string' ? raw.code.trim().toUpperCase() : ''
  const rate = Number(raw.rate)
  const decimals = Number.isInteger(Number(raw.decimals)) ? Number(raw.decimals) : 2
  if (!/^[A-Z]{3}$/.test(code) || !Number.isFinite(rate) || rate <= 0) return null
  const symbol = typeof raw.symbol === 'string' && raw.symbol.trim() ? raw.symbol.trim().slice(0, 5) : code
  return { code, symbol, rate, decimals: Math.min(Math.max(decimals, 0), 3) }
}

/** The store's display currencies changed (settings loaded). The base currency is never one of them. */
export function setAvailableCurrencies(list, baseCode = 'USD') {
  const next = (Array.isArray(list) ? list : []).map(sanitizeCurrency).filter((currency) => currency && currency.code !== baseCode)
  const same = next.length === available.length && next.every((currency, index) => JSON.stringify(currency) === JSON.stringify(available[index]))
  if (same) return
  available = next
  emit()
}

/** The shopper picked a currency; null (or the base code) goes back to the base currency. */
export function chooseDisplayCurrency(code) {
  chosenCode = typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : null
  if (chosenCode) writeJson(STORAGE_KEYS.currency, chosenCode)
  else removeKey(STORAGE_KEYS.currency)
  emit()
}

/** The currency prices are shown in now, or null for the base currency. */
export function getDisplayCurrency() {
  return snapshot.active
}

/** { available, chosenCode, active }: re-renders the caller when any of them changes. */
export function useDisplayCurrency() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Tests: back to the base currency with nothing available. */
export function resetDisplayCurrencyForTests() {
  available = []
  chosenCode = null
  emit()
}
