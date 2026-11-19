/*
 * Phase 11 §5: display currencies. Staff type the rates in (units of the
 * currency per 1 of the store currency); a rate older than 30 days gets a
 * warning. The store keeps charging in its own currency (phase 12: USD or
 * BDT, a deployment setting) and the admin always shows that. The server
 * checks everything again; its 422 messages appear on the fields.
 */

export const STALE_DAYS = 30
const DAY_MS = 86_400_000

/** Whole days since `updatedAt` (null when unknown). */
export function rateAgeDays(updatedAt, now = Date.now()) {
  const time = Date.parse(updatedAt ?? '')
  return Number.isNaN(time) ? null : Math.max(Math.floor((now - time) / DAY_MS), 0)
}
/**
 * A rate that is set (above 0) and not updated for more than 30 days: the
 * API's `stale`, or worked out here from `updatedAt` when it doesn't say.
 * A rate of 0 (never set) is "no rate yet", not old.
 */
export const isStale = (currency, now = Date.now()) => currency.rate > 0 && (typeof currency.stale === 'boolean' ? currency.stale : (rateAgeDays(currency.updatedAt, now) ?? 0) > STALE_DAYS)

/** "today", "1 day ago", "45 days ago". */
export function ageLabel(days) {
  if (days === null) return 'never'
  if (days === 0) return 'today'
  return days === 1 ? '1 day ago' : `${days} days ago`
}

export const MAX_RATE = 1_000_000_000

export const EMPTY_CURRENCY = { code: '', symbol: '', rate: '', decimals: '2', enabled: false }

/** A currency → the form's text values. */
export const currencyFormValues = (currency) => (currency ? { code: currency.code, symbol: currency.symbol, rate: String(currency.rate), decimals: String(currency.decimals), enabled: currency.enabled } : EMPTY_CURRENCY)

const hasPlaces = (value, places) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6

/** The form's problems by field ({} when it can be sent). `codes` = the codes already used (new currencies only); `base` = the store currency. */
export function currencyErrors(values, { isNew, codes = [], base = 'USD' }) {
  const errors = {}
  const code = values.code.trim().toUpperCase()
  if (isNew) {
    if (!/^[A-Z]{3}$/.test(code)) errors.code = ['Enter the 3-letter ISO 4217 code, like BDT or EUR.']
    else if (code === base) errors.code = [`${base} is the store currency: prices are already shown in it.`]
    else if (codes.includes(code)) errors.code = [`${code} is already in the list.`]
  }
  const symbol = values.symbol.trim()
  if (!symbol || [...symbol].length > 5) errors.symbol = ['Enter a symbol of up to 5 characters, like ৳ or €.']
  const rate = Number(values.rate)
  if (values.rate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > MAX_RATE || !hasPlaces(rate, 8)) errors.rate = [`Enter how many units make 1 ${base} (0 to 1,000,000,000, at most 8 decimals).`]
  else if (values.enabled && rate === 0) errors.rate = ['Enter a rate before turning this currency on.']
  const decimals = Number(values.decimals)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) errors.decimals = ['Choose 0 to 3 decimals.']
  return errors
}

/** The form → what the admin service takes (only the changed fields when editing). */
export function toCurrencyValues(values, before) {
  const next = { symbol: values.symbol.trim(), rate: Number(values.rate), decimals: Number(values.decimals), enabled: values.enabled }
  if (!before) return { code: values.code.trim().toUpperCase(), ...next }
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== before[key]))
}

/** 1 USD = ৳ 110.50 (with the currency's decimals, at least 2 so small rates stay readable); `base` = the store currency. */
export function rateExample(currency, base = 'USD') {
  const places = Math.min(Math.max(currency.decimals ?? 2, 2), 8)
  const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: places, maximumFractionDigits: Math.max(places, 4) }).format(currency.rate)
  return `1 ${base} = ${currency.symbol} ${amount}`
}
