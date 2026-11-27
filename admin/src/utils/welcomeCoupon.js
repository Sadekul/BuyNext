import { LuBan, LuCircleCheck, LuClock } from 'react-icons/lu'

/*
 * Phase 19 §2: Marketing → Welcome coupon. The form keeps numbers as text (so
 * "empty" can mean "no minimum"); welcomeErrors() checks them with the same
 * words as the server (frontend/server/adminPhase19Api.js, then Laravel), and
 * toWelcomePayload() turns them into what the admin service expects.
 */

export const WELCOME_TRIGGERS = {
  signup: 'When someone creates an account',
  newsletter: 'When someone confirms the newsletter',
}
/** How a code was earned, in the codes table. */
export const EARNED_BY = {
  signup: 'Account sign-up',
  newsletter: 'Newsletter',
}
export const WELCOME_TYPES = { percent: 'Percentage', fixed: 'Fixed amount' }
export const WELCOME_CODE_STATUSES = {
  active: { label: 'Active', tone: 'success', icon: LuCircleCheck },
  used: { label: 'Used', tone: 'info', icon: LuBan },
  expired: { label: 'Expired', tone: 'warning', icon: LuClock },
}
export const welcomeCodeStatus = (status) =>
  WELCOME_CODE_STATUSES[status] ?? {
    label: status ?? 'Unknown',
    tone: 'neutral',
  }

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isBlank = (text) => String(text ?? '').trim() === ''

/** The saved settings → the form's values. */
export function settingsToForm(settings = {}) {
  return {
    enabled: settings.enabled === true,
    triggers: Array.isArray(settings.triggers) ? Object.keys(WELCOME_TRIGGERS).filter((key) => settings.triggers.includes(key)) : Object.keys(WELCOME_TRIGGERS),
    type: settings.type === 'fixed' ? 'fixed' : 'percent',
    value: settings.value === null || settings.value === undefined ? '' : String(settings.value),
    minSubtotal: settings.minSubtotal === null || settings.minSubtotal === undefined ? '' : String(settings.minSubtotal),
    validDays: settings.validDays === null || settings.validDays === undefined ? '30' : String(settings.validDays),
    firstOrderOnly: settings.firstOrderOnly !== false,
  }
}

/** The form's problems, { field: [message] } (empty when it can be saved). */
export function welcomeErrors(form) {
  const errors = {}
  const value = Number(form.value)
  if (form.triggers.length === 0) errors.triggers = ['Choose at least one way to earn the code.']
  if (form.type === 'percent' && (isBlank(form.value) || !Number.isInteger(value) || value < 1 || value > 90)) errors.value = ['A percentage discount is between 1 and 90.']
  if (form.type === 'fixed' && (isBlank(form.value) || !Number.isFinite(value) || value <= 0 || value > 100_000 || !hasCents(value)))
    errors.value = ['A fixed discount is more than 0 and at most 100,000, with at most 2 decimals.']
  const minimum = Number(form.minSubtotal)
  if (!isBlank(form.minSubtotal) && (!Number.isFinite(minimum) || minimum <= 0 || minimum > 1_000_000 || !hasCents(minimum)))
    errors.minSubtotal = ['Enter a minimum order above 0 with at most 2 decimals, or leave it empty.']
  const days = Number(form.validDays)
  if (isBlank(form.validDays) || !Number.isInteger(days) || days < 1 || days > 365) errors.validDays = ['A code is valid for 1 to 365 days.']
  return errors
}

/** Valid form values → the admin service's body (every setting). */
export function toWelcomePayload(form) {
  return {
    enabled: form.enabled,
    triggers: Object.keys(WELCOME_TRIGGERS).filter((key) => form.triggers.includes(key)),
    type: form.type,
    value: Number(form.value),
    minSubtotal: isBlank(form.minSubtotal) ? null : Number(form.minSubtotal),
    validDays: Number(form.validDays),
    firstOrderOnly: form.firstOrderOnly,
  }
}

/**
 * What shoppers will see, in English (the store shows the same in Bangla):
 * { title: "Get 10% off your first order", minimum: "Orders over ৳500." | null,
 *   newsletter: "Confirm your email…" | null, signup: "Create an account…" | null }.
 * null when the discount isn't valid yet.
 */
export function welcomePreview(form, formatMoney) {
  // Whole amounts without ".00", as the store shows them ("৳100 off", "Orders over ৳500.").
  const money = (amount) => (Number.isInteger(amount) ? formatMoney(amount).replace(/[.,]00(?=\D*$)/, '') : formatMoney(amount))
  const value = Number(form.value)
  const ok = form.type === 'percent' ? Number.isInteger(value) && value >= 1 && value <= 90 : Number.isFinite(value) && value > 0 && value <= 100_000
  if (isBlank(form.value) || !ok) return null
  const label = form.type === 'percent' ? `${value}% off` : `${money(value)} off`
  const offer = form.firstOrderOnly ? `${label} your first order` : label
  const minimum = Number(form.minSubtotal)
  return {
    title: `Get ${offer}`,
    minimum: !isBlank(form.minSubtotal) && Number.isFinite(minimum) && minimum > 0 ? `Orders over ${money(minimum)}.` : null,
    newsletter: form.triggers.includes('newsletter') ? "Confirm your email and we'll send your personal code." : null,
    signup: form.triggers.includes('signup') ? `Create an account and get ${offer}.` : null,
  }
}
