import { z } from 'zod'
import { COUNTRIES, PAYMENT_METHODS, SHIPPING_METHODS } from '../constants/store'
import { translate } from '../i18n'

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
export const createAddressSchema = (countries) => z.object({
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

export const addressSchema = createAddressSchema(COUNTRIES)

const PHONE = /^\+?[0-9 ()-]{7,20}$/

/** Phase 12: what a shopper paying through SSLCommerz is told without a phone number (English; validation:checkout.sslcommerzPhone). */
export const SSLCOMMERZ_PHONE_MESSAGE = 'Enter a phone number: SSLCommerz needs one for bKash, Nagad, and card payments.'

/**
 * The phone number is needed for delivery updates; with SSLCommerz (phase 12)
 * the payment page needs it as well, and an empty field says so.
 */
function checkPhone(data, ctx) {
  const phone = typeof data.phone === 'string' ? data.phone : ''
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
} = {}) {
  const storeAddressSchema = createAddressSchema(countries)
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
      .superRefine(checkPhone)
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
      checkPhone(data, ctx)
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
export function createSavedAddressSchema(countries = COUNTRIES) {
  return createAddressSchema(countries).extend({
    phone: z
      .string(message('savedAddress.phoneRequired'))
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, message('savedAddress.phone')),
    company: z.string().trim().max(100, message('savedAddress.company', { max: 100 })),
    isDefaultShipping: z.boolean(),
    isDefaultBilling: z.boolean(),
  })
}
