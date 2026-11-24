import { z } from 'zod'
import { COUNTRIES, PAYMENT_METHODS, SHIPPING_METHODS } from '../constants/store'
import { translate } from '../i18n'
import { bdMobileMessage, isBangladesh, toLatinDigits } from '../utils/bangladesh'

// The production Content-Security-Policy forbids eval. Zod otherwise probes
// `new Function` to speed up parsing, which the browser reports as a violation.
z.config({ jitless: true })

/*
 * Checkout validation rules as a Zod SCHEMA: one declarative description of
 * valid data. React Hook Form runs it (through zodResolver) on submit, then
 * again as the user corrects a field. The same rules must be enforced again on the server.
 */

/*
 * Phase 13: every message is looked up when the form is checked (a function,
 * not a fixed string), so it is in the shopper's current language
 * (locales/<lang>/validation.json).
 */
const message = (key, values) => ({ error: () => translate(`validation:${key}`, values) })

// The same friendly message whether the field is empty OR missing entirely.
const requiredText = (key) => z.string(message(key)).trim().min(1, message(key))

/** One address; `countries` are the ones the store ships to (the demo list, or the server's settings). */
const createStandardAddressSchema = (countries) => z.object({
  firstName: requiredText('address.firstName'),
  lastName: requiredText('address.lastName'),
  line1: requiredText('address.line1'),
  line2: z.string().trim().optional(),
  city: requiredText('address.city'),
  state: requiredText('address.state'),
  postalCode: z
    .string(message('address.postalCode'))
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,8}[A-Za-z0-9]$/, message('address.postalCode')),
  country: z.enum(countries, message('address.country')),
})

/*
 * Phase 14: a Bangladesh address (docs/backend/PHASE14_CONTRACT.md §2):
 * division, district and area (ids from the places lists), house/road/village,
 * and an optional 4-digit postcode. City and state follow the district and
 * division (the API fills them from the ids).
 */
const placeId = (key) => z.union([z.string(), z.number()], message(key)).transform(String).pipe(z.string().regex(/^\d{1,9}$/, message(key)))
const createBangladeshAddressSchema = (countries) => z.object({
  firstName: requiredText('address.firstName'),
  lastName: requiredText('address.lastName'),
  divisionId: placeId('bd.division'),
  districtId: placeId('bd.district'),
  areaId: placeId('bd.area'),
  line1: requiredText('bd.line1'),
  line2: z.string().trim().optional(),
  city: z.string().trim().optional().default(''),
  state: z.string().trim().optional().default(''),
  postalCode: z
    .string()
    .optional()
    .default('')
    .transform((value) => toLatinDigits(value).trim())
    .pipe(z.string().regex(/^(\d{4})?$/, message('bd.postcode'))),
  country: z.enum(countries, message('address.country')),
})

/**
 * One address. With `bangladesh` (the store's API knows Bangladesh's places),
 * an address in Bangladesh is checked as one (Division → District → Area);
 * otherwise, and for every other country, exactly as before.
 */
export function createAddressSchema(countries, { bangladesh = false } = {}) {
  const standard = createStandardAddressSchema(countries)
  if (!bangladesh) return standard
  const bangladeshSchema = createBangladeshAddressSchema(countries)
  return z.any().transform((value, ctx) => {
    const schema = value && typeof value === 'object' && isBangladesh(value.country) ? bangladeshSchema : standard
    const result = schema.safeParse(value)
    if (result.success) return result.data
    // `continue`: the checkout's own rules (the mobile number) still run; the address stays readable for them.
    for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path, continue: true })
    return value
  })
}

export const addressSchema = createAddressSchema(COUNTRIES)

const PHONE = /^\+?[0-9 ()-]{7,20}$/

/** Phase 12: what a shopper paying through SSLCommerz is told without a phone number (English; validation:checkout.sslcommerzPhone). */
export const SSLCOMMERZ_PHONE_MESSAGE = 'Enter a phone number: SSLCommerz needs one for bKash, Nagad, and card payments.'

/**
 * The phone number is needed for delivery updates; with SSLCommerz (phase 12)
 * the payment page needs it as well, and an empty field says so.
 */
function checkPhone(data, ctx, { bangladeshMobile = false } = {}) {
  const phone = typeof data.phone === 'string' ? data.phone : ''
  // Phase 14: delivery in Bangladesh needs a Bangladeshi mobile the courier can call.
  if (bangladeshMobile) {
    const problem = bdMobileMessage(phone)
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path: ['phone'] })
    return
  }
  if (PHONE.test(phone)) return
  const key = phone === '' && data.paymentMethod === 'sslcommerz' ? 'checkout.sslcommerzPhone' : 'checkout.phone'
  ctx.addIssue({ code: 'custom', message: translate(`validation:${key}`), path: ['phone'] })
}

/**
 * The checkout rules for one store's settings: only its countries, delivery
 * options, and payment methods are accepted (REAL_SHOP: the server's
 * settings, which the server enforces again). The demo uses `checkoutSchema`.
 */
export function createCheckoutSchema({
  countries = COUNTRIES,
  shippingMethodIds = SHIPPING_METHODS.map((method) => method.id),
  paymentMethodIds = PAYMENT_METHODS.map((method) => method.id),
  // Phase 10: a cart of gift cards only has no delivery: no shipping address or method, the billing address instead.
  requiresShipping = true,
  // Phase 14: the store's API knows Bangladesh's places (the Bangladesh address form and mobile numbers).
  bangladesh = false,
} = {}) {
  const storeAddressSchema = createAddressSchema(countries, { bangladesh })
  // The mobile number is checked as a Bangladeshi one when the address it goes with is in Bangladesh.
  const phoneRules = (address) => ({ bangladeshMobile: bangladesh && isBangladesh(address?.country) })
  if (!requiresShipping) {
    return z
      .object({
        email: z.email(message('checkout.email')),
        // Checked with the payment method below (phase 12: SSLCommerz says why it needs one).
        phone: z.string(message('checkout.phone')).trim(),
        shipping: z.any(),
        billingSameAsShipping: z.any(),
        billing: storeAddressSchema,
        shippingMethod: z.any(),
        paymentMethod: z.enum(paymentMethodIds, message('checkout.paymentMethod')),
        saveAddress: z.boolean().optional(),
      })
      .superRefine((data, ctx) => checkPhone(data, ctx, phoneRules(data.billing)))
  }
  return z
    .object({
      email: z.email(message('checkout.email')),
      // Checked with the payment method below (phase 12: SSLCommerz says why it needs one).
      phone: z.string(message('checkout.phone')).trim(),
      shipping: storeAddressSchema,
      billingSameAsShipping: z.boolean(),
      billing: z.any(), // validated below, only when it's a separate address
      shippingMethod: z.enum(shippingMethodIds, message('checkout.shippingMethod')),
      paymentMethod: z.enum(paymentMethodIds, message('checkout.paymentMethod')),
      // Signed-in customers (REAL_SHOP): keep the shipping address in the address book.
      saveAddress: z.boolean().optional(),
    })
    // Conditional rule: the billing address is required only when it differs.
    .superRefine((data, ctx) => {
      checkPhone(data, ctx, phoneRules(data.shipping))
      if (data.billingSameAsShipping) return
      const result = storeAddressSchema.safeParse(data.billing)
      if (result.success) return
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: ['billing', ...issue.path] })
      }
    })
}

export const checkoutSchema = createCheckoutSchema()

export const EMPTY_ADDRESS = {
  firstName: '',
  lastName: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: COUNTRIES[0],
}

/**
 * An address-book entry (REAL_SHOP): an order address plus a phone number
 * (for the courier) and an optional company, and whether it is the default for shipping and for billing.
 */
export function createSavedAddressSchema(countries = COUNTRIES, { bangladesh = false } = {}) {
  const extras = z.object({
    phone: z.string().trim(),
    company: z.string().trim().max(100, message('savedAddress.company', { max: 100 })),
    isDefaultShipping: z.boolean(),
    isDefaultBilling: z.boolean(),
  })
  // Phase 14: an address in Bangladesh (with the store's places) has the Bangladesh fields and a Bangladeshi mobile.
  if (bangladesh) {
    const address = createAddressSchema(countries, { bangladesh: true })
    const standard = createStandardSavedAddressSchema(countries)
    return z.any().transform((value, ctx) => {
      if (!(value && typeof value === 'object' && isBangladesh(value.country))) {
        const result = standard.safeParse(value)
        if (result.success) return result.data
        for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path, continue: true })
        return value
      }
      const place = address.safeParse(value)
      const rest = extras.safeParse(value)
      const issues = [...(place.success ? [] : place.error.issues), ...(rest.success ? [] : rest.error.issues)]
      const mobile = bdMobileMessage(value.phone)
      if (mobile) issues.push({ message: mobile, path: ['phone'] })
      if (issues.length === 0) return { ...place.data, ...rest.data }
      for (const issue of issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path, continue: true })
      return value
    })
  }
  return createStandardSavedAddressSchema(countries)
}

function createStandardSavedAddressSchema(countries) {
  return createStandardAddressSchema(countries).extend({
    phone: z
      .string(message('savedAddress.phoneRequired'))
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, message('savedAddress.phone')),
    company: z.string().trim().max(100, message('savedAddress.company', { max: 100 })),
    isDefaultShipping: z.boolean(),
    isDefaultBilling: z.boolean(),
  })
}
