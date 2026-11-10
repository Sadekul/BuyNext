const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const count = new Intl.NumberFormat('en-US')
const compactCount = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** $1,284.50 */
export const formatMoney = (value) => money.format(value)
/** Stat tiles: exact below 10,000, then compact ($12.9K, $4.2M). */
export const formatMoneyCompact = (value) => (Math.abs(value) < 10_000 ? money.format(value) : compactMoney.format(value))
export const formatCount = (value) => count.format(value)
export const formatCountCompact = (value) => (Math.abs(value) < 10_000 ? count.format(value) : compactCount.format(value))
/** "home-decoration" → "Home decoration" */
export const formatSlug = (slug = '') => slug.charAt(0).toUpperCase() + slug.slice(1).replaceAll('-', ' ')
export const fullName = (person) => [person?.firstName, person?.lastName].filter(Boolean).join(' ')

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
/** ISO date → "Nov 10, 2026"; empty → the fallback. */
export const formatDate = (iso, fallback = '—') => (iso ? dateFormat.format(new Date(iso)) : fallback)
