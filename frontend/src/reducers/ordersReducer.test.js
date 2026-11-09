import { describe, expect, it } from 'vitest'
import { EMPTY_ORDERS, sanitizeOrders } from './ordersReducer'

const address = { firstName: 'Ada', lastName: 'L', line1: '1 Main St', city: 'X', state: 'Y', postalCode: '12345', country: 'US' }
const validOrder = {
  id: 'BN-1',
  userId: 1,
  placedAt: 1_700_000_000_000,
  status: 'placed',
  paymentMethod: 'card',
  contact: { email: 'a@b.co', phone: '5550100' },
  shippingAddress: address,
  billingAddress: address,
  shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 days' },
  items: [{ productId: 1, title: 'Phone', thumbnail: null, quantity: 1, price: 10, discountPercentage: 0 }],
  totals: { itemCount: 1, subtotal: 10, couponCode: null, discount: 0, shipping: 4.99, total: 14.99 },
  verification: { cartId: 51, serverDiscountedTotal: 10 },
}

describe('sanitizeOrders (data from localStorage)', () => {
  it('keeps well-formed orders', () => {
    expect(sanitizeOrders({ orders: [validOrder] }).orders).toEqual([validOrder])
  })

  // Each of these used to crash the orders pages on every visit.
  it.each([
    ['an impossible date', { placedAt: 1e20 }],
    ['a missing contact', { contact: null }],
    ['an address with a non-text field', { shippingAddress: { ...address, city: {} } }],
    ['a null item', { items: [null] }],
    ['no items', { items: [] }],
    ['a non-numeric total', { totals: { ...validOrder.totals, total: '14.99' } }],
  ])('drops an order with %s', (_, change) => {
    expect(sanitizeOrders({ orders: [{ ...validOrder, ...change }] }).orders).toEqual([])
  })

  it('falls back to no orders for garbage', () => {
    expect(sanitizeOrders('nonsense')).toEqual(EMPTY_ORDERS)
  })
})
