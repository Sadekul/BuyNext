import { describe, expect, it } from 'vitest'
import { normalizeEstimate } from './deliveryService'
import { normalizeHome, normalizeStoreSettings, normalizeTopBar } from './adapters/contentAdapter'

// Phase 17: the "Deliver to" estimate, the home page's top bar and the store's address, as the storefront reads them.
describe('normalizeEstimate', () => {
  it('maps the API’s estimate to numbers and camelCase', () => {
    const estimate = normalizeEstimate({
      data: {
        area: { id: 1001, name: 'Banani', district: 'Dhaka', district_id: 47, division: 'Dhaka', division_id: 3 },
        zone: { code: 'inside_dhaka', name: 'Inside Dhaka' },
        methods: [{ id: 'standard', label: 'Standard', price: '60.00', eta: 'Delivery in 1–2 days', eta_days_min: 1, eta_days_max: 2, free_over_threshold: true }, { label: 'no id' }],
        free_shipping_threshold: '5000.00',
        cod: { available: false, reason: 'zone', message: 'Not here.', fee: '20.00' },
      },
    })
    expect(estimate).toEqual({
      area: { id: 1001, name: 'Banani', district: 'Dhaka', division: 'Dhaka' },
      zone: { code: 'inside_dhaka', name: 'Inside Dhaka' },
      methods: [{ id: 'standard', label: 'Standard', price: 60, eta: 'Delivery in 1–2 days', etaDaysMin: 1, etaDaysMax: 2, freeOverThreshold: true }],
      freeShippingThreshold: 5000,
      cod: { available: false, reason: 'zone', message: 'Not here.', fee: 20 },
    })
  })

  it('tolerates a sparse answer', () => {
    expect(normalizeEstimate({ data: { zone: null } })).toMatchObject({ zone: null, methods: [], freeShippingThreshold: null, cod: { available: false, fee: 0 } })
  })
})

describe('top bar and store address', () => {
  it('top_bar → { message, couponCode } or null', () => {
    expect(normalizeTopBar({ message: ' Eid sale ', coupon_code: 'EID10' })).toEqual({ message: 'Eid sale', couponCode: 'EID10' })
    expect(normalizeTopBar({ message: 'Eid sale', coupon_code: null })).toEqual({ message: 'Eid sale', couponCode: null })
    expect(normalizeTopBar({ message: 'Eid sale', coupon_code: '<b>x</b>' })).toEqual({ message: 'Eid sale', couponCode: null })
    expect(normalizeTopBar({ message: '', coupon_code: 'EID10' })).toBeNull()
    expect(normalizeTopBar(null)).toBeNull()
    expect(normalizeHome({ data: { top_bar: { message: 'Hi', coupon_code: null } } }).topBar).toEqual({ message: 'Hi', couponCode: null })
    expect(normalizeHome({ data: {} }).topBar).toBeNull()
  })

  it('the store’s address when the API sends one', () => {
    expect(normalizeStoreSettings({ data: { address: ' 12 Lake Road\nDhaka 1212 ' } }).storeAddress).toBe('12 Lake Road\nDhaka 1212')
    expect(normalizeStoreSettings({ data: {} }).storeAddress).toBeNull()
  })
})
