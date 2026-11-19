/*
 * Phase 12 §1 and §5: money is shown in the store currency (BUYNEST_CURRENCY
 * on the server, read from the store's public settings when the admin
 * starts: see useStoreCurrency), or in an order's own currency on order,
 * invoice and credit memo screens. Until the store currency is known, USD
 * (the default, and every store's currency before phase 12).
 */
const DEFAULT_CURRENCY = { code: 'USD', symbol: '$', decimals: 2 }
let storeCurrency = DEFAULT_CURRENCY
const formatters = new Map()

const isCode = (code) => typeof code === 'string' && /^[A-Z]{3}$/.test(code)

/** The store currency ({ code, symbol, decimals }) money is shown in when nothing else is said. */
export const getStoreCurrency = () => storeCurrency
/** The store currency's code, for labels such as "Price (BDT)". */
export const storeCode = () => storeCurrency.code
/** Sets the store currency (from GET /api/catalog/store); anything not a 3-letter code puts USD back. */
export function setStoreCurrency(currency) {
  const code = typeof currency === 'string' ? currency : currency?.code
  if (!isCode(code)) {
    storeCurrency = DEFAULT_CURRENCY
    return storeCurrency
  }
  const decimals = Number.isInteger(currency?.decimals) && currency.decimals >= 0 && currency.decimals <= 3 ? currency.decimals : undefined
  storeCurrency = { code, symbol: typeof currency?.symbol === 'string' && currency.symbol ? currency.symbol : code, decimals: decimals ?? 2 }
  formatters.clear()
  return storeCurrency
}

function formatter(code, compact) {
  const currency = isCode(code) ? code : storeCurrency.code
  const key = `${currency}:${compact ? 'c' : ''}`
  if (!formatters.has(key)) {
    // narrowSymbol: ৳1,250.00 (not "BDT 1,250.00"), $1,250.00 as before.
    const options = { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }
    if (compact) Object.assign(options, { notation: 'compact', maximumFractionDigits: 1 })
    else if (currency === storeCurrency.code && storeCurrency.decimals !== undefined) Object.assign(options, { minimumFractionDigits: storeCurrency.decimals, maximumFractionDigits: storeCurrency.decimals })
    let made
    try {
      made = new Intl.NumberFormat('en-US', options)
    } catch {
      // A code this browser doesn't know: the amount with the code in front.
      made = { format: (value) => `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, ...(compact && { notation: 'compact', maximumFractionDigits: 1 }) }).format(value)}` }
    }
    formatters.set(key, made)
  }
  return formatters.get(key)
}

/** $1,284.50 / ৳1,284.50: in `currency` (an order's own) when given, else the store currency. */
export const formatMoney = (value, currency) => formatter(currency, false).format(value)
/** Stat tiles: exact below 10,000, then compact ($12.9K, ৳4.2M). */
export const formatMoneyCompact = (value, currency) => (Math.abs(value) < 10_000 ? formatMoney(value, currency) : formatter(currency, true).format(value))

/**
 * Phase 12 §5: amounts in more than one currency are never added up across
 * currencies. rows → [{ currency, total }] (store currency first, then by code);
 * a row without a currency counts as the store currency.
 */
export function totalsByCurrency(rows, amount = (row) => row.total, currencyOf = (row) => row.currency) {
  const totals = new Map()
  for (const row of rows ?? []) {
    const value = Number(amount(row))
    if (!Number.isFinite(value)) continue
    const code = isCode(currencyOf(row)) ? currencyOf(row) : storeCurrency.code
    totals.set(code, Math.round(((totals.get(code) ?? 0) + value) * 100) / 100)
  }
  return [...totals].map(([currency, total]) => ({ currency, total })).sort((a, b) => (a.currency === storeCurrency.code ? -1 : b.currency === storeCurrency.code ? 1 : a.currency.localeCompare(b.currency)))
}
/** [{ currency, total }] → "৳12,500.00 + $310.00" (none: 0 in the store currency). */
export const formatTotals = (totals, { compact = false } = {}) =>
  totals.length === 0 ? formatMoney(0) : totals.map(({ currency, total }) => (compact ? formatMoneyCompact(total, currency) : formatMoney(total, currency))).join(' + ')

const count = new Intl.NumberFormat('en-US')
const compactCount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export const formatCount = (value) => count.format(value)
export const formatCountCompact = (value) => (Math.abs(value) < 10_000 ? count.format(value) : compactCount.format(value))
/** "home-decoration" → "Home decoration" */
export const formatSlug = (slug = '') => slug.charAt(0).toUpperCase() + slug.slice(1).replaceAll('-', ' ')
export const fullName = (person) => [person?.firstName, person?.lastName].filter(Boolean).join(' ')

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
/** ISO date → "Nov 10, 2026"; empty → the fallback. */
export const formatDate = (iso, fallback = '—') => (iso ? dateFormat.format(new Date(iso)) : fallback)

const dateTimeFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
/** ISO date → "Nov 10, 2026, 9:41 AM". */
export const formatDateTime = (iso, fallback = '—') => (iso ? dateTimeFormat.format(new Date(iso)) : fallback)

/** Phase 9 (backups): 1536 → "1.5 KB"; 3_400_000 → "3.2 MB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}
