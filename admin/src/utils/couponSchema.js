import { z } from 'zod'

z.config({ jitless: true }) // the production CSP forbids eval (see productSchema.js)

/*
 * Coupon form rules (Marketing → Coupons). The server checks them again
 * (validateCoupon in frontend/server/adminApi.js, then Laravel); its 422
 * messages are shown on the same fields. Number and date inputs are kept as
 * text, so "empty" can mean "no limit"; toCouponPayload() converts them.
 */
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isBlank = (text) => text.trim() === ''
const isWhole = (text) => /^\d+$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= 1_000_000
const isMoney = (text) => !Number.isNaN(Number(text)) && Number(text) >= 0 && Number(text) <= 1_000_000 && hasCents(Number(text))

export const couponSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/, 'Use 3 to 40 letters, digits, dashes, or underscores.'),
    description: z.string().trim().max(255, 'Keep the description under 255 characters (shoppers see it).'),
    type: z.enum(['percent', 'fixed', 'free_shipping'], { error: 'Choose a type.' }),
    value: z.string(),
    minSubtotal: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    usageLimit: z.string(),
    usageLimitPerCustomer: z.string(),
    isActive: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const problem = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message })
    const value = Number(values.value)
    if (values.type === 'percent' && (isBlank(values.value) || !Number.isInteger(value) || value < 1 || value > 100)) problem('value', 'Enter a whole percentage from 1 to 100.')
    if (values.type === 'fixed' && (isBlank(values.value) || !isMoney(values.value) || value <= 0)) problem('value', 'Enter an amount above 0 with at most 2 decimals.')
    if (!isBlank(values.minSubtotal) && !isMoney(values.minSubtotal)) problem('minSubtotal', 'Enter an amount of 0 or more with at most 2 decimals, or leave it empty.')
    if (!isBlank(values.usageLimit) && !isWhole(values.usageLimit)) problem('usageLimit', 'Enter a whole number from 1, or leave it empty for no limit.')
    if (!isBlank(values.usageLimitPerCustomer) && !isWhole(values.usageLimitPerCustomer)) problem('usageLimitPerCustomer', 'Enter a whole number from 1, or leave it empty for no limit.')
    if (!isBlank(values.startsAt) && !isBlank(values.endsAt) && new Date(values.endsAt) <= new Date(values.startsAt)) problem('endsAt', 'The end must be after the start.')
  })

export const EMPTY_COUPON = { code: '', description: '', type: 'percent', value: '', minSubtotal: '', startsAt: '', endsAt: '', usageLimit: '', usageLimitPerCustomer: '', isActive: true }

// <input type="datetime-local"> works in the admin's own time zone; the API stores UTC.
const pad = (number) => String(number).padStart(2, '0')
export function toLocalInput(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const toIso = (local) => (isBlank(local) ? null : new Date(local).toISOString())
const numberOrNull = (text) => (isBlank(text) ? null : Number(text))

/** A coupon from the API → form values. */
export function couponToForm(coupon) {
  return {
    code: coupon.code,
    description: coupon.description ?? '',
    type: coupon.type,
    value: coupon.type === 'free_shipping' ? '' : String(coupon.value ?? ''),
    minSubtotal: coupon.minSubtotal === null || coupon.minSubtotal === undefined ? '' : String(coupon.minSubtotal),
    startsAt: toLocalInput(coupon.startsAt),
    endsAt: toLocalInput(coupon.endsAt),
    usageLimit: coupon.usageLimit ? String(coupon.usageLimit) : '',
    usageLimitPerCustomer: coupon.usageLimitPerCustomer ? String(coupon.usageLimitPerCustomer) : '',
    isActive: coupon.isActive,
  }
}

/** Valid form values → what the admin service expects (numbers, ISO dates, null for "none"). */
export function toCouponPayload(values) {
  return {
    code: values.code.trim().toUpperCase(),
    description: values.description.trim() || null, // empty: the server writes one from the rules
    type: values.type,
    value: values.type === 'free_shipping' ? 0 : Number(values.value),
    minSubtotal: numberOrNull(values.minSubtotal),
    startsAt: toIso(values.startsAt),
    endsAt: toIso(values.endsAt),
    usageLimit: numberOrNull(values.usageLimit),
    usageLimitPerCustomer: numberOrNull(values.usageLimitPerCustomer),
    isActive: values.isActive,
  }
}

/** "10% off", "$20.00 off", "Free shipping". */
export function describeCouponValue(coupon, formatMoney) {
  if (coupon.type === 'percent') return `${coupon.value}% off`
  if (coupon.type === 'fixed') return `${formatMoney(coupon.value)} off`
  return 'Free shipping'
}
