import { describe, expect, it } from 'vitest'
import { calculateCartTotals, evaluateCoupon } from './cartTotals'

const line = (price, quantity, extra = {}) => ({ price, discountPercentage: 0, quantity, ...extra })

describe('calculateCartTotals', () => {
  it('adds money in cents (no floating-point drift)', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in plain JavaScript
    expect(calculateCartTotals([line(0.1, 1), line(0.2, 1)]).subtotal).toBe(0.3)
  })

  it('charges $4.99 standard shipping under $50 and nothing above', () => {
    expect(calculateCartTotals([line(20, 2)]).shipping).toBe(4.99)
    expect(calculateCartTotals([line(20, 2)]).amountToFreeShipping).toBe(10)
    expect(calculateCartTotals([line(25, 2)]).shipping).toBe(0)
  })

  it('uses flat prices for express and next-day delivery', () => {
    expect(calculateCartTotals([line(100, 1)], null, 'express').shipping).toBe(12.99)
    expect(calculateCartTotals([line(100, 1)], null, 'nextDay').total).toBe(124.99)
  })

  it('applies product discounts and reports the savings', () => {
    const totals = calculateCartTotals([line(1099.99, 1, { discountPercentage: 9.37 })])
    expect(totals.subtotal).toBe(996.92)
    expect(totals.productSavings).toBe(103.07)
  })

  it('applies NEST10 and checks SAVE20 minimum spend', () => {
    expect(calculateCartTotals([line(200, 1)], 'NEST10').discount).toBe(20)
    expect(calculateCartTotals([line(100, 1)], 'SAVE20')).toMatchObject({ discount: 0, couponError: 'Spend at least $150 to use this code.' })
    expect(calculateCartTotals([line(150, 1)], 'SAVE20').total).toBe(130)
  })

  it('never charges unavailable lines but still counts them for the badge', () => {
    const totals = calculateCartTotals([line(10, 2), line(99, 3, { isUnavailable: true })])
    expect(totals).toMatchObject({ itemCount: 2, totalQuantity: 5, subtotal: 20, unavailableCount: 1, canCheckout: false })
  })

  it('counts the coupon when saying how much more reaches free shipping', () => {
    // $52 - 10% = $46.80. $3.20 more of items is only $2.88 after the discount;
    // $3.56 more makes $55.56, which is exactly $50.00 after 10% off.
    const totals = calculateCartTotals([line(52, 1)], 'NEST10')
    expect(totals.amountToFreeShipping).toBe(3.56)
    expect(calculateCartTotals([line(55.56, 1)], 'NEST10').shipping).toBe(0)
  })
})

describe('evaluateCoupon', () => {
  it('rejects unknown codes and caps discounts at the subtotal', () => {
    expect(evaluateCoupon('NOPE', 1000).error).toBe('This code is not valid.')
    expect(evaluateCoupon('save20', 15000).discountCents).toBe(2000)
  })
})

describe('calculateCartTotals with the store\'s rules', () => {
  const rules = {
    shippingMethods: [{ id: 'standard', label: 'Standard', eta: '', price: null }, { id: 'express', label: 'Express', eta: '', price: 14.99 }],
    standardShippingCost: 5.99,
    freeShippingThreshold: 100,
  }

  it('uses the store\'s prices and free-shipping threshold', () => {
    const totals = calculateCartTotals([line(30, 1)], null, 'standard', rules)
    expect(totals).toMatchObject({ shipping: 5.99, freeShippingThreshold: 100, amountToFreeShipping: 70 })
    expect(calculateCartTotals([line(30, 1)], null, 'express', rules).shipping).toBe(14.99)
    expect(calculateCartTotals([line(60, 2)], null, 'standard', rules).shipping).toBe(0)
  })

  it('has no free-shipping goal when the store offers no standard delivery', () => {
    const totals = calculateCartTotals([line(30, 1)], null, 'express', { ...rules, shippingMethods: [rules.shippingMethods[1]] })
    expect(totals).toMatchObject({ shipping: 14.99, freeShippingThreshold: null, amountToFreeShipping: null })
  })
})
