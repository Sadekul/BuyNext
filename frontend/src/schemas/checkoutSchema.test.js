import { describe, expect, it } from 'vitest'
import { checkoutSchema, createCheckoutSchema } from './checkoutSchema'

const address = {
  firstName: 'Emily',
  lastName: 'Johnson',
  line1: '626 Main Street',
  line2: '',
  city: 'Phoenix',
  state: 'Mississippi',
  postalCode: '29112',
  country: 'United States',
}
const valid = {
  email: 'emily@example.com',
  phone: '+1 555 010 2030',
  shipping: address,
  billingSameAsShipping: true,
  billing: {},
  shippingMethod: 'standard',
  paymentMethod: 'card',
}
const errorsOf = (values) =>
  Object.fromEntries((checkoutSchema.safeParse(values).error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]))

describe('checkoutSchema', () => {
  it('accepts a complete checkout', () => {
    expect(checkoutSchema.safeParse(valid).success).toBe(true)
  })

  it('reports nested field errors', () => {
    expect(errorsOf({ ...valid, email: 'nope', shipping: { ...address, city: ' ', postalCode: '#' } })).toEqual({
      email: 'Enter a valid email address.',
      'shipping.city': 'Enter a city.',
      'shipping.postalCode': 'Enter a valid postal code.',
    })
  })

  it('only requires a billing address when it differs from shipping', () => {
    expect(errorsOf({ ...valid, billingSameAsShipping: false, billing: {} })).toHaveProperty('billing.city', 'Enter a city.')
    expect(checkoutSchema.safeParse({ ...valid, billingSameAsShipping: false, billing: address }).success).toBe(true)
  })

  it('only allows known delivery and payment options', () => {
    expect(errorsOf({ ...valid, shippingMethod: 'teleport', paymentMethod: 'crypto' })).toEqual({
      shippingMethod: 'Choose a delivery option.',
      paymentMethod: 'Choose a payment method.',
    })
  })
})

describe('createCheckoutSchema (the store\'s settings)', () => {
  const storeSchema = createCheckoutSchema({ countries: ['Canada'], shippingMethodIds: ['express'], paymentMethodIds: ['cod'] })

  it('accepts only the store\'s countries, delivery options, and payment methods', () => {
    expect(storeSchema.safeParse({ ...valid, shipping: { ...address, country: 'Canada' }, shippingMethod: 'express', paymentMethod: 'cod' }).success).toBe(true)
    const issues = storeSchema.safeParse(valid).error.issues.map((issue) => issue.path.join('.'))
    expect(issues).toEqual(['shipping.country', 'shippingMethod', 'paymentMethod'])
  })
})
