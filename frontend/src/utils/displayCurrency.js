import { useSyncExternalStore } from 'react'
import { readJson, removeKey, writeJson } from './storage'
import { STORAGE_KEYS } from '../constants/storageKeys'

/*
 * Phase 11 display currencies (docs/backend/PHASE11_CONTRACT.md §5). The
 * store always CHARGES in its base currency (phase 12: the store currency,
 * USD or BDT, from GET /store `currency`); a shopper may choose to
 * SEE prices in another one (e.g. BDT), at the rate the staff typed in.
 *
 * One small store outside React, because formatPrice() (utils/formatters.js)
 * is a plain function called from components, reducers, and strings alike:
 *   - `available`: the store's display currencies (GET /store `currencies`,
 *     set by useCurrencySync once the settings load). Empty in the demo.
 *   - `chosenCode`: the shopper's choice, kept in localStorage.
 *   - `active`: the chosen currency when it is available, else null (= base).
 *   - `store` (phase 12): the store currency { code, symbol, decimals }, what
 *     every order is charged in. USD (today's behaviour) until the settings load.
 * Components re-render on a change through useDisplayCurrency(); App
 * subscribes, so the whole page shows the new currency at once.
 */

/**
 * Phase 12: the currencies BuyNest knows how to write (the API's
 * config('buynest.currencies')); any other ISO code is written as its code and
 * a space ("XYZ 1,250.00").
 */
export const KNOWN_CURRENCIES = {
  USD: { code: 'USD', symbol: '$', decimals: 2 },
  BDT: { code: 'BDT', symbol: '৳', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', decimals: 2 },
  INR: { code: 'INR', symbol: '₹', decimals: 2 },
  CAD: { code: 'CAD', symbol: 'CA$', decimals: 2 },
  AUD: { code: 'AUD', symbol: 'A$', decimals: 2 },
}
export const DEFAULT_STORE_CURRENCY = KNOWN_CURRENCIES.USD

let available = []
let chosenCode = readChoice()
let store = DEFAULT_STORE_CURRENCY
let snapshot = buildSnapshot()
const listeners = new Set()

function readChoice() {
  const value = readJson(STORAGE_KEYS.currency, null)
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null
}

function buildSnapshot() {
  const active = available.find((currency) => currency.code === chosenCode) ?? null
  return { available, chosenCode, active, store }
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

/**
 * Phase 12: a currency as { code, symbol, decimals } (no rate: it IS the
 * money's own currency). A code alone (an order's `currency`) gets the
 * known symbol, or the code itself. Anything unusable → null.
 */
export function sanitizeStoreCurrency(raw) {
  const value = typeof raw === 'string' ? { code: raw } : raw
  if (!value || typeof value !== 'object') return null
  const code = typeof value.code === 'string' ? value.code.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(code)) return null
  const known = KNOWN_CURRENCIES[code]
  const symbol = typeof value.symbol === 'string' && value.symbol.trim() ? value.symbol.trim().slice(0, 5) : (known?.symbol ?? `${code} `)
  const decimals = Number.isInteger(Number(value.decimals)) && value.decimals !== null && value.decimals !== '' ? Number(value.decimals) : (known?.decimals ?? 2)
  return { code, symbol, decimals: Math.min(Math.max(decimals, 0), 3) }
}

/** Phase 12: the store currency from the settings (GET /store `currency`); anything unusable keeps USD. */
export function setStoreCurrency(raw) {
  const next = sanitizeStoreCurrency(raw) ?? DEFAULT_STORE_CURRENCY
  if (next.code === store.code && next.symbol === store.symbol && next.decimals === store.decimals) return
  store = next
  // A display currency equal to the new store currency is no longer "another" currency.
  available = available.filter((currency) => currency.code !== store.code)
  emit()
}

/** Phase 12: the currency the store charges in now ({ code, symbol, decimals }). */
export function getStoreCurrency() {
  return snapshot.store
}

/** The store's display currencies changed (settings loaded). The base currency is never one of them. */
export function setAvailableCurrencies(list, baseCode = store.code) {
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

/** Tests: back to the base currency (USD) with nothing available. */
export function resetDisplayCurrencyForTests() {
  available = []
  chosenCode = null
  store = DEFAULT_STORE_CURRENCY
  emit()
}
