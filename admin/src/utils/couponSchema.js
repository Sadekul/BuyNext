import { z } from 'zod'

z.config({ jitless: true }) // the production CSP forbids eval (see productSchema.js)

/*
 * Coupon form rules (Marketing → Coupons; phase 7: cart price rules). The server checks them again
 * (validateCoupon in frontend/server/adminApi.js, then Laravel); its 422
 * messages are shown on the same fields. Number and date inputs are kept as
 * text, so "empty" can mean "no limit"; toCouponPayload() converts them.
 */
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isBlank = (text) => text.trim() === ''
const isWhole = (text) => /^\d+$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= 1_000_000
const isMoney = (text) => !Number.isNaN(Number(text)) && Number(text) >= 0 && Number(text) <= 1_000_000 && hasCents(Number(text))

/** Phase 7: coupons are Magento-style cart price rules (the type list replaces utils/orders.js COUPON_TYPES here). */
export const CART_RULE_TYPES = { percent: 'Percent off', fixed: 'Fixed amount off', free_shipping: 'Free shipping only', buy_x_get_y: 'Buy X, get Y free' }
export const APPLIES_TO = { all: 'Every product in the cart', categories: 'Products in chosen categories', products: 'Chosen products' }
const isUnits = (text) => /^\d{1,3}$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= 100
const ids = z.array(z.number().int().positive())

export const couponSchema = z
  .object({
    autoApply: z.boolean(),
    code: z.string(),
    description: z.string().trim().max(255, 'Keep the description under 255 characters (shoppers see it).'),
    type: z.enum(['percent', 'fixed', 'free_shipping', 'buy_x_get_y'], { error: 'Choose a type.' }),
    value: z.string(),
    buyQuantity: z.string(),
    getQuantity: z.string(),
    freeShipping: z.boolean(),
    appliesTo: z.enum(['all', 'categories', 'products']),
    categoryIds: ids,
    productIds: ids,
    customerGroupIds: ids,
    minSubtotal: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    usageLimit: z.string(),
    usageLimitPerCustomer: z.string(),
    isActive: z.boolean(),
    // Phase 19: only for a shopper's first order (no earlier order that wasn't cancelled).
    firstOrderOnly: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const problem = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message })
    const value = Number(values.value)
    if (!values.autoApply && !/^[A-Za-z0-9_-]{3,40}$/.test(values.code.trim())) problem('code', 'Use 3 to 40 letters, digits, dashes, or underscores.')
    if (values.type === 'percent' && (isBlank(values.value) || !Number.isInteger(value) || value < 1 || value > 100)) problem('value', 'Enter a whole percentage from 1 to 100.')
    if (values.type === 'fixed' && (isBlank(values.value) || !isMoney(values.value) || value <= 0)) problem('value', 'Enter an amount above 0 with at most 2 decimals.')
    if (values.type === 'buy_x_get_y') {
      if (!isUnits(values.buyQuantity)) problem('buyQuantity', 'Enter how many to buy, from 1 to 100.')
      if (!isUnits(values.getQuantity)) problem('getQuantity', 'Enter how many are free, from 1 to 100.')
    }
    if (values.appliesTo === 'categories' && values.categoryIds.length === 0) problem('categoryIds', 'Choose at least one category.')
    if (values.appliesTo === 'products' && values.productIds.length === 0) problem('productIds', 'Choose at least one product.')
    if (!isBlank(values.minSubtotal) && !isMoney(values.minSubtotal)) problem('minSubtotal', 'Enter an amount of 0 or more with at most 2 decimals, or leave it empty.')
    if (!isBlank(values.usageLimit) && !isWhole(values.usageLimit)) problem('usageLimit', 'Enter a whole number from 1, or leave it empty for no limit.')
    if (!isBlank(values.usageLimitPerCustomer) && !isWhole(values.usageLimitPerCustomer)) problem('usageLimitPerCustomer', 'Enter a whole number from 1, or leave it empty for no limit.')
    if (!isBlank(values.startsAt) && !isBlank(values.endsAt) && new Date(values.endsAt) <= new Date(values.startsAt)) problem('endsAt', 'The end must be after the start.')
  })

export const EMPTY_COUPON = {
  autoApply: false,
  code: '',
  description: '',
  type: 'percent',
  value: '',
  buyQuantity: '',
  getQuantity: '',
  freeShipping: false,
  appliesTo: 'all',
  categoryIds: [],
  productIds: [],
  customerGroupIds: [],
  minSubtotal: '',
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  usageLimitPerCustomer: '',
  isActive: true,
  firstOrderOnly: false,
}

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
  const noValue = coupon.type === 'free_shipping' || coupon.type === 'buy_x_get_y'
  return {
    autoApply: coupon.autoApply === true,
    code: coupon.code ?? '',
    description: coupon.description ?? '',
    type: coupon.type,
    value: noValue ? '' : String(coupon.value ?? ''),
    buyQuantity: coupon.buyQuantity ? String(coupon.buyQuantity) : '',
    getQuantity: coupon.getQuantity ? String(coupon.getQuantity) : '',
    freeShipping: coupon.type !== 'free_shipping' && coupon.freeShipping === true,
    appliesTo: coupon.appliesTo ?? 'all',
    categoryIds: coupon.categoryIds ?? [],
    productIds: coupon.productIds ?? [],
    customerGroupIds: coupon.customerGroupIds ?? [],
    minSubtotal: coupon.minSubtotal === null || coupon.minSubtotal === undefined ? '' : String(coupon.minSubtotal),
    startsAt: toLocalInput(coupon.startsAt),
    endsAt: toLocalInput(coupon.endsAt),
    usageLimit: coupon.usageLimit ? String(coupon.usageLimit) : '',
    usageLimitPerCustomer: coupon.usageLimitPerCustomer ? String(coupon.usageLimitPerCustomer) : '',
    isActive: coupon.isActive,
    firstOrderOnly: coupon.firstOrderOnly === true,
  }
}

/** Valid form values → what the admin service expects (numbers, ISO dates, null for "none"). */
export function toCouponPayload(values) {
  const buyGet = values.type === 'buy_x_get_y'
  return {
    // An automatic rule has no code: the cart applies the best one by itself.
    code: values.autoApply ? null : values.code.trim().toUpperCase(),
    autoApply: values.autoApply,
    description: values.description.trim() || null, // empty: the server writes one from the rules
    type: values.type,
    value: values.type === 'free_shipping' || buyGet ? 0 : Number(values.value),
    buyQuantity: buyGet ? Number(values.buyQuantity) : null,
    getQuantity: buyGet ? Number(values.getQuantity) : null,
    freeShipping: values.type === 'free_shipping' || values.freeShipping,
    appliesTo: values.appliesTo,
    categoryIds: values.appliesTo === 'categories' ? values.categoryIds : [],
    productIds: values.appliesTo === 'products' ? values.productIds : [],
    customerGroupIds: values.customerGroupIds,
    minSubtotal: numberOrNull(values.minSubtotal),
    startsAt: toIso(values.startsAt),
    endsAt: toIso(values.endsAt),
    usageLimit: numberOrNull(values.usageLimit),
    usageLimitPerCustomer: numberOrNull(values.usageLimitPerCustomer),
    isActive: values.isActive,
    firstOrderOnly: values.firstOrderOnly,
  }
}

/** "10% off", "$20.00 off", "Free shipping", "Buy 2, get 1 free" (+ " + free shipping"). */
export function describeCouponValue(coupon, formatMoney) {
  const extra = coupon.freeShipping && coupon.type !== 'free_shipping' ? ' + free shipping' : ''
  if (coupon.type === 'percent') return `${coupon.value}% off${extra}`
  if (coupon.type === 'fixed') return `${formatMoney(coupon.value)} off${extra}`
  if (coupon.type === 'buy_x_get_y') return `Buy ${coupon.buyQuantity}, get ${coupon.getQuantity} free${extra}`
  return 'Free shipping'
}

/** Phase 19: a code the store emailed to one new customer (read-only, except switching it off). */
export const isWelcomeCode = (coupon) => coupon?.source === 'welcome'

/** The list's name for a rule: its code, or (automatic rules) its description. */
export const couponName = (coupon) => coupon.code || coupon.description || `Automatic rule #${coupon.id}`
