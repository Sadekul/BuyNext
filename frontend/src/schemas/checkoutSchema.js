import { z } from 'zod'
import { COUNTRIES, PAYMENT_METHODS, SHIPPING_METHODS } from '../constants/store'

/*
 * Checkout validation rules as a Zod SCHEMA: one declarative description of
 * valid data. React Hook Form runs it (through zodResolver) on blur and on
 * submit. The same rules must be enforced again on the server.
 */

// The same friendly message whether the field is empty OR missing entirely.
const requiredText = (message) => z.string({ error: message }).trim().min(1, message)

export const addressSchema = z.object({
  firstName: requiredText('Enter a first name.'),
  lastName: requiredText('Enter a last name.'),
  line1: requiredText('Enter a street address.'),
  line2: z.string().trim().optional(),
  city: requiredText('Enter a city.'),
  state: requiredText('Enter a state or region.'),
  postalCode: z
    .string({ error: 'Enter a valid postal code.' })
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,8}[A-Za-z0-9]$/, 'Enter a valid postal code.'),
  country: z.enum(COUNTRIES, { error: 'Choose a country.' }),
})

export const checkoutSchema = z
  .object({
    email: z.email('Enter a valid email address.'),
    phone: z
      .string({ error: 'Enter a valid phone number.' })
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number.'),
    shipping: addressSchema,
    billingSameAsShipping: z.boolean(),
    billing: z.any(), // validated below, only when it's a separate address
    shippingMethod: z.enum(SHIPPING_METHODS.map((method) => method.id), { error: 'Choose a delivery option.' }),
    paymentMethod: z.enum(PAYMENT_METHODS.map((method) => method.id), { error: 'Choose a payment method.' }),
  })
  // Conditional rule: the billing address is required only when it differs.
  .superRefine((data, ctx) => {
    if (data.billingSameAsShipping) return
    const result = addressSchema.safeParse(data.billing)
    if (result.success) return
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['billing', ...issue.path] })
    }
  })

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
