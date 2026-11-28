/*
 * Phase 21 §1–2: report dates are whole days in the store time zone
 * (Settings → General → Time zone; UTC until the owner picks Asia/Dhaka).
 * Every report answer says which zone its dates are in (range.timezone);
 * the last one seen is remembered in this browser, so the default period
 * ("the last 30 days, up to today") starts on the store's today, not UTC's.
 */

export const GROUPS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]
export const MAX_DAYS = 366
export const DAY_MS = 86_400_000
const REMEMBERED = 'buynest.admin.storeTimezone'

/** A time zone this browser knows ("UTC", "Asia/Dhaka"). */
export function isZone(value) {
  if (typeof value !== 'string' || value === '' || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function remembered() {
  try {
    const value = window.localStorage.getItem(REMEMBERED)
    return isZone(value) ? value : null
  } catch {
    return null
  }
}
let storeZone = remembered() ?? 'UTC'

/** The store time zone last seen in a report (UTC until one says otherwise). */
export const knownZone = () => storeZone
/** Remembers the store time zone a report answered with. True when it changed. */
export function rememberZone(value) {
  if (!isZone(value) || value === storeZone) return false
  storeZone = value
  try {
    window.localStorage.setItem(REMEMBERED, value)
  } catch {
    // storage blocked: the next visit starts with UTC until a report answers
  }
  return true
}

/** Today in `zone` as YYYY-MM-DD. */
export function todayIn(zone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: isZone(zone) ? zone : 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** "2026-11-28" minus `days` days. */
export const daysBefore = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)

/** The last 30 days up to today, in the store time zone. */
export function defaultRange(zone = storeZone, now = new Date()) {
  const to = todayIn(zone, now)
  return { from: daysBefore(to, 29), to }
}

/** A chosen period's problem in words, or null. */
export function rangeProblem({ from, to }) {
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS
  if (!from || !to || Number.isNaN(days)) return 'Choose both dates.'
  if (days < 0) return 'The start date must be on or before the end date.'
  if (days >= MAX_DAYS) return `Choose at most ${MAX_DAYS} days.`
  return null
}

/** "Asia/Dhaka" → "Asia/Dhaka time"; "UTC" → "UTC". */
export const zoneWords = (zone) => (zone === 'UTC' || !zone ? 'UTC' : `${zone} time`)

// The period keys are store-local calendar days already: formatted as dates, never shifted.
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const longDayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
/** "2026-11-10" → "Nov 10" (day), "Week of Nov 10" (week), "Nov 2026" (month). */
export function periodLabel(period, groupBy) {
  const date = new Date(period.length === 7 ? `${period}-01T00:00:00Z` : `${period}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return period
  if (groupBy === 'month') return monthFormat.format(date)
  return groupBy === 'week' ? `Week of ${dayFormat.format(date)}` : dayFormat.format(date)
}
/** A store-local day "2026-11-27" → "Nov 27, 2026" (no time zone shift); empty → the fallback. */
export const formatDay = (day, fallback = '—') => {
  if (!day) return fallback
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? day : longDayFormat.format(date)
}
