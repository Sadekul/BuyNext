import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { chargedCurrencyCode, formatBasePrice, formatPrice, moneyFormatter } from './formatters'
import { chooseDisplayCurrency, getStoreCurrency, resetDisplayCurrencyForTests, sanitizeStoreCurrency, setAvailableCurrencies, setStoreCurrency, useDisplayCurrency } from './displayCurrency'
import { canPayOrder, sslcommerzMethodName } from './payment'
import { paymentNote } from '../constants/orders'
import { normalizeStoreSettings } from '../services/adapters/contentAdapter'
import { SSLCOMMERZ_PHONE_MESSAGE, createCheckoutSchema } from '../schemas/checkoutSchema'
import { DEFAULT_STORE_SETTINGS } from '../hooks/useStoreSettings'
import { storeAnnouncements } from '../constants/site'
import { resetAnalyticsForTests, startAnalytics, trackPurchase } from './analytics'

// Phase 12 helpers (docs/backend/PHASE12_CONTRACT.md): the store currency in every formatter, SSLCommerz
// in the store settings, payment notes, Pay now, and the phone rule at checkout.

const TAKA = { code: 'BDT', symbol: '৳', decimals: 2 }
afterEach(() => resetDisplayCurrencyForTests())

describe('the store currency (§1)', () => {
  it('formats in USD until the settings load, then in the store currency (৳ before the amount, no space)', () => {
    expect(getStoreCurrency()).toEqual({ code: 'USD', symbol: '$', decimals: 2 })
    expect(formatBasePrice(1099.99)).toBe('$1,099.99')
    expect(formatPrice(1099.99)).toBe('$1,099.99')
    setStoreCurrency(TAKA)
    expect(formatBasePrice(1250)).toBe('৳1,250.00')
    expect(formatPrice(1250)).toBe('৳1,250.00')
    expect(formatBasePrice(-5)).toBe('-৳5.00')
    expect(chargedCurrencyCode()).toBe('BDT')
    // Anything unusable keeps USD.
    setStoreCurrency({ code: 'taka!' })
    expect(formatBasePrice(1)).toBe('$1.00')
  })

  it('an order’s money is written in the order’s own currency, whatever the store charges now', () => {
    setStoreCurrency(TAKA)
    expect(formatBasePrice(24.97, 'USD')).toBe('$24.97')
    expect(moneyFormatter('USD')(5)).toBe('$5.00')
    expect(moneyFormatter('BDT')(5)).toBe('৳5.00')
    expect(moneyFormatter(null)(5)).toBe('৳5.00') // no currency: the store's
    expect(formatBasePrice(5, 'EUR')).toBe('€5.00')
    expect(formatBasePrice(1250, 'XYZ')).toBe('XYZ 1,250.00') // unknown code: the code and a space, like the API
    expect(sanitizeStoreCurrency('bdt')).toEqual(TAKA)
    expect(sanitizeStoreCurrency({ code: 'BDT', symbol: 'Tk', decimals: 0 })).toEqual({ code: 'BDT', symbol: 'Tk', decimals: 0 })
    expect(sanitizeStoreCurrency('12')).toBeNull()
  })

  it('display currencies stay relative to the store currency; components re-render on a change', () => {
    const { result } = renderHook(() => useDisplayCurrency())
    act(() => setStoreCurrency(TAKA))
    expect(result.current.store.code).toBe('BDT')
    // With taka as the base, staff can offer US dollars for display (the taka entry itself is never "another" currency).
    act(() => setAvailableCurrencies([{ code: 'USD', symbol: '$', rate: '0.0091', decimals: 2 }, { code: 'BDT', symbol: '৳', rate: 1, decimals: 2 }]))
    expect(result.current.available.map((currency) => currency.code)).toEqual(['USD'])
    act(() => chooseDisplayCurrency('USD'))
    expect(formatPrice(1100)).toBe('$10.01')
    expect(formatBasePrice(1100)).toBe('৳1,100.00') // what is charged
  })

  it('the store settings carry the currency; PayPal and SSLCommerz are hidden when unavailable in it', () => {
    const settings = normalizeStoreSettings({
      data: {
        payment_methods: ['card', 'paypal', 'sslcommerz', 'cod'],
        currency: { code: 'BDT', symbol: '৳', decimals: 2 },
        currencies: { base: 'BDT', display: [] },
        paypal_payments: 'unavailable',
        sslcommerz_payments: 'sslcommerz',
      },
    })
    expect(settings.currency).toEqual(TAKA)
    expect(settings.currencies.base).toBe('BDT')
    expect(settings.paypalPayments).toBe('unavailable')
    expect(settings.sslcommerzPayments).toBe('sslcommerz')
    expect(settings.paymentMethods.map((method) => method.id)).toEqual(['card', 'sslcommerz', 'cod'])
    expect(settings.paymentMethods[1]).toMatchObject({ label: 'bKash, Nagad or card (SSLCommerz)', description: "You'll finish paying on SSLCommerz's secure page.", badges: ['bKash', 'Nagad', 'Card'] })

    const usd = normalizeStoreSettings({ data: { payment_methods: ['paypal', 'sslcommerz'], paypal_payments: 'paypal', sslcommerz_payments: 'unavailable' } })
    expect(usd.currency).toEqual({ code: 'USD', symbol: '$', decimals: 2 })
    expect(usd.paymentMethods.map((method) => method.id)).toEqual(['paypal'])
    expect(normalizeStoreSettings({ data: { sslcommerz_payments: 'bogus' } }).sslcommerzPayments).toBe('manual')
    // An older API with only phase 11's base currency.
    expect(normalizeStoreSettings({ data: { currencies: { base: 'BDT' } } }).currency).toEqual(TAKA)
  })

  it('the announcement strip writes the free-shipping threshold in the store currency', () => {
    expect(storeAnnouncements(50, formatBasePrice)[0]).toBe('Free standard shipping on orders over $50')
    setStoreCurrency(TAKA)
    expect(storeAnnouncements(5000, formatBasePrice)[0]).toBe('Free standard shipping on orders over ৳5,000')
    expect(storeAnnouncements(49.5, formatBasePrice)[0]).toBe('Free standard shipping on orders over ৳49.50')
    // No threshold (free shipping off): no free-shipping line.
    expect(storeAnnouncements(null, formatBasePrice).some((line) => /Free standard shipping/.test(line))).toBe(false)
  })

  it('the demo charges in USD and never offers SSLCommerz', () => {
    expect(DEFAULT_STORE_SETTINGS.currency.code).toBe('USD')
    expect(DEFAULT_STORE_SETTINGS.sslcommerzPayments).toBe('manual')
    expect(DEFAULT_STORE_SETTINGS.paymentMethods.map((method) => method.id)).not.toContain('sslcommerz')
  })

  it('statistics name the store currency, and an order’s own', () => {
    vi.stubEnv('VITE_ANALYTICS', 'ga4')
    expect(startAnalytics('G-TEST12345')).toBe(true)
    setStoreCurrency(TAKA)
    trackPurchase({ number: 'BN-100009', currency: 'USD', totals: { total: 10, tax: 0, shipping: 0 }, items: [] })
    trackPurchase({ number: 'BN-100010', totals: { total: 1100, tax: 0, shipping: 0 }, items: [] })
    const purchases = (window.dataLayer ?? []).map((entry) => Array.from(entry)).filter(([kind, name]) => kind === 'event' && name === 'purchase').map(([, , params]) => params.currency)
    expect(purchases).toEqual(['USD', 'BDT'])
    resetAnalyticsForTests()
    vi.unstubAllEnvs()
  })
})

describe('SSLCommerz payments (§3)', () => {
  const UNPAID = { number: 'BN-100001', status: 'pending_payment', paymentStatus: 'unpaid', paymentMethod: 'sslcommerz' }

  it('Pay now works for an unpaid SSLCommerz order in a store connected to SSLCommerz; the API’s canPay wins', () => {
    expect(canPayOrder(UNPAID, 'manual', 'manual', 'sslcommerz')).toBe(true)
    expect(canPayOrder({ ...UNPAID, paymentProvider: 'sslcommerz' }, 'manual')).toBe(true)
    expect(canPayOrder(UNPAID, 'manual', 'manual', 'manual')).toBe(false)
    expect(canPayOrder({ ...UNPAID, canPay: false }, 'manual', 'manual', 'sslcommerz')).toBe(false)
  })

  it('names how it was paid: the API’s label, else from card_type', () => {
    expect(sslcommerzMethodName({ methodLabel: 'bKash', cardType: 'NAGAD-Nagad' })).toBe('bKash')
    expect(sslcommerzMethodName({ cardType: 'BKASH-BKash' })).toBe('bKash')
    expect(sslcommerzMethodName({ cardType: 'NAGAD-Nagad' })).toBe('Nagad')
    expect(sslcommerzMethodName({ cardType: 'VISA-Dutch Bangla' })).toBe('Visa card')
    expect(sslcommerzMethodName({ cardType: 'CITYTOUCHIB-City Bank' })).toBe('internet banking')
    expect(sslcommerzMethodName({ cardType: 'ODD-Something' })).toBe('card or bank')
    expect(sslcommerzMethodName({})).toBeNull()
  })

  it('payment notes: awaiting (Pay now), paid with bKash, held for a check', () => {
    expect(paymentNote(UNPAID, { sslcommerz: true })).toMatch(/^Awaiting payment: nothing has been charged yet\. Pay with bKash, Nagad, Rocket, or a card on SSLCommerz's secure page/)
    const paid = { ...UNPAID, status: 'processing', paymentStatus: 'paid', paymentProvider: 'sslcommerz', paidAt: '2026-11-19T10:00:00Z', payment: { methodLabel: 'bKash' } }
    expect(paymentNote(paid)).toBe('Paid with bKash (SSLCommerz) on Nov 19, 2026. Thank you.')
    expect(paymentNote({ ...paid, paidAt: null, payment: {} })).toBe('Paid through SSLCommerz. Thank you.')
    expect(paymentNote({ ...UNPAID, paymentStatus: 'review' })).toMatch(/^We've received your payment and are checking it/)
    // Without a connection, the order waits for staff like any manual method.
    expect(paymentNote(UNPAID)).toMatch(/^Nothing has been charged. Online payments happen/)
  })
})

describe('the phone number at checkout (§4)', () => {
  const ADDRESS = { firstName: 'Rahim', lastName: 'Uddin', line1: 'House 12, Road 5', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1207', country: 'Bangladesh' }
  const values = { email: 'rahim@example.com', phone: '', shipping: ADDRESS, billingSameAsShipping: true, billing: {}, shippingMethod: 'standard', paymentMethod: 'sslcommerz' }
  const schema = createCheckoutSchema({ countries: ['Bangladesh'], shippingMethodIds: ['standard'], paymentMethodIds: ['cod', 'sslcommerz'] })
  const phoneError = (input, use = schema) => use.safeParse(input).error?.issues.find((issue) => issue.path.join('.') === 'phone')?.message ?? null

  it('an empty phone with SSLCommerz says why it’s needed; other methods keep the usual message', () => {
    expect(phoneError(values)).toBe(SSLCOMMERZ_PHONE_MESSAGE)
    expect(phoneError({ ...values, paymentMethod: 'cod' })).toBe('Enter a valid phone number.')
    expect(phoneError({ ...values, phone: '12' })).toBe('Enter a valid phone number.')
    expect(schema.safeParse({ ...values, phone: ' +880 1711 000000 ' }).data.phone).toBe('+880 1711 000000')
  })

  it('gift cards only (billing address only) follow the same rule', () => {
    const giftOnly = createCheckoutSchema({ countries: ['Bangladesh'], paymentMethodIds: ['sslcommerz'], requiresShipping: false })
    expect(phoneError({ ...values, billing: ADDRESS }, giftOnly)).toBe(SSLCOMMERZ_PHONE_MESSAGE)
    expect(giftOnly.safeParse({ ...values, billing: ADDRESS, phone: '01711000000' }).success).toBe(true)
  })
})
