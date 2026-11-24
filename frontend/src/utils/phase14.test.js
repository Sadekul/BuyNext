import { afterEach, describe, expect, it } from 'vitest'
import {
  addressPlaceLines,
  bdMobileMessage,
  bdMobileProblem,
  codRefused,
  codUnavailableText,
  etaText,
  isBangladesh,
  normalizeBdMobile,
  placeName,
  suggestedPostcode,
  usesBangladeshForm,
  zoneDeliveryText,
} from './bangladesh'
import { addressSummary, isSameAddress, toOrderAddress } from './addresses'
import { createCheckoutSchema, createSavedAddressSchema } from '../schemas/checkoutSchema'
import { normalizeStoreSettings } from '../services/adapters/contentAdapter'
import { paymentNote, paymentStatus } from '../constants/orders'
import { normalizePhone } from './validation'
import { formatBasePrice } from './formatters'
import { resetDisplayCurrencyForTests, setStoreCurrency } from './displayCurrency'
import { switchToBangla } from '../test/i18n'

// Phase 14 (docs/backend/PHASE14_CONTRACT.md §2–§4): Bangladesh addresses, mobile numbers, delivery
// zones and cash on delivery, as the storefront's helpers see them.

const TAKA = { code: 'BDT', symbol: '৳', decimals: 2 }
afterEach(() => resetDisplayCurrencyForTests())

describe('Bangladeshi mobile numbers', () => {
  it('accepts 01…, +8801…, 8801… and 008801…, with spaces and dashes, and stores +8801…', () => {
    for (const value of ['01712345678', '01712-345678', '+880 1712 345678', '8801712345678', '00880 1712-345678', '(017) 1234-5678']) {
      expect(bdMobileProblem(value)).toBeNull()
      expect(normalizeBdMobile(value)).toBe('+8801712345678')
    }
  })

  it('accepts Bangla digits typed on a Bangla keyboard', () => {
    expect(normalizeBdMobile('০১৭১২-৩৪৫৬৭৮')).toBe('+8801712345678')
    expect(normalizePhone('০১৭১২ ৩৪৫৬৭৮')).toBe('01712345678')
  })

  it('says what is wrong: empty, not shaped like a mobile, or an operator that does not exist', () => {
    expect(bdMobileProblem('')).toBe('required')
    expect(bdMobileProblem('  ')).toBe('required')
    expect(bdMobileProblem('1712345678')).toBe('format')
    expect(bdMobileProblem('0171234567')).toBe('format')
    expect(bdMobileProblem('+15550100100')).toBe('format')
    expect(bdMobileProblem('01212345678')).toBe('operator')
    expect(bdMobileProblem('+8801112345678')).toBe('operator')
    expect(normalizeBdMobile('01212345678')).toBeNull()
  })

  it('explains it in English and Bangla', async () => {
    expect(bdMobileMessage('')).toBe('Enter your mobile number so the courier can call you.')
    expect(bdMobileMessage('12345')).toBe('Enter a Bangladeshi mobile number: 11 digits starting with 01, like 01712-345678.')
    expect(bdMobileMessage('01212345678')).toBe('Mobile numbers start with 013 to 019. Check the third digit.')
    await switchToBangla()
    expect(bdMobileMessage('12345')).toBe('বাংলাদেশি মোবাইল নম্বর দিন: ০১ দিয়ে শুরু ১১ অঙ্ক, যেমন ০১৭১২-৩৪৫৬৭৮।')
    expect(bdMobileMessage('01212345678')).toBe('মোবাইল নম্বর ০১৩ থেকে ০১৯ দিয়ে শুরু হয়। তৃতীয় অঙ্কটি দেখুন।')
  })
})

describe('the Bangladesh address form switch', () => {
  it('is on only for a Bangladesh address in a store whose default country is Bangladesh', () => {
    const settings = (data) => normalizeStoreSettings({ data: { allowed_countries: ['Bangladesh', 'India'], payment_methods: ['cod'], ...data } })
    expect(settings({ default_country: 'Bangladesh' })).toMatchObject({ defaultCountry: 'Bangladesh', bangladeshAddresses: true })
    expect(settings({ default_country: 'BD' })).toMatchObject({ defaultCountry: 'Bangladesh', bangladeshAddresses: true })
    // Phase 13 answers (no default_country) and other default countries: exactly as before.
    expect(settings({})).toMatchObject({ defaultCountry: null, bangladeshAddresses: false, cod: null })
    expect(settings({ default_country: null })).toMatchObject({ defaultCountry: null, bangladeshAddresses: false })
    expect(settings({ default_country: 'India' })).toMatchObject({ defaultCountry: 'India', bangladeshAddresses: false })
    const on = settings({ default_country: 'Bangladesh' })
    expect(usesBangladeshForm('Bangladesh', on)).toBe(true)
    expect(usesBangladeshForm('India', on)).toBe(false)
    expect(usesBangladeshForm('Bangladesh', settings({}))).toBe(false)
    expect(isBangladesh('bd')).toBe(true)
  })

  it('reads the store’s cash on delivery rules', () => {
    const { cod } = normalizeStoreSettings({ data: { allowed_countries: ['Bangladesh'], default_country: 'Bangladesh', cod: { fee: '20.00', max_order_total: '10000.00', advance: 'delivery_charge', zones: ['inside_dhaka'], require_confirmation: true } } })
    expect(cod).toEqual({ fee: 20, maxOrderTotal: 10000, advance: 'delivery_charge', zones: ['inside_dhaka'], requireConfirmation: true })
  })
})

const PLACES = {
  division: { id: 3, nameEn: 'Dhaka', nameBn: 'ঢাকা' },
  district: { id: 47, nameEn: 'Dhaka', nameBn: 'ঢাকা' },
  area: { id: 1001, nameEn: 'Dhanmondi', nameBn: 'ধানমন্ডি' },
}
const BD_ADDRESS = { firstName: 'Rahim', lastName: 'Uddin', line1: 'House 12, Road 5', line2: '', city: 'Dhaka', state: 'Dhaka', postalCode: '1209', country: 'Bangladesh', divisionId: 3, districtId: 47, areaId: 1001 }

describe('Bangladesh addresses on the page', () => {
  it('shows area, district and division in the reader’s language', async () => {
    expect(addressPlaceLines({ ...BD_ADDRESS, ...PLACES })).toEqual(['Dhanmondi, Dhaka 1209', 'Dhaka Division'])
    await switchToBangla()
    expect(addressPlaceLines({ ...BD_ADDRESS, ...PLACES })).toEqual(['ধানমন্ডি, ঢাকা ১২০৯', 'ঢাকা বিভাগ'])
    // Places not looked up yet: the English names the API stored.
    expect(addressPlaceLines({ ...BD_ADDRESS, area: { id: 1001, nameEn: 'Dhanmondi', nameBn: null } })).toEqual(['Dhanmondi, Dhaka ১২০৯', 'Dhaka বিভাগ'])
  })

  it('leaves other addresses exactly as before', () => {
    const us = { firstName: 'Ava', lastName: 'Guest', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' }
    expect(addressPlaceLines(us)).toEqual(['Springfield, Oregon 29112'])
    expect(addressSummary(us)).toBe('Ava Guest, 12 Market Street, Springfield, Oregon 29112, United States')
    expect(toOrderAddress(us)).toEqual(us)
    // A free-text Bangladesh address (no place ids) too.
    expect(addressPlaceLines({ ...us, country: 'Bangladesh' })).toEqual(['Springfield, Oregon 29112'])
  })

  it('copies a saved address’s place ids to the checkout and compares them', () => {
    const saved = { ...BD_ADDRESS, id: 9, phone: '+8801712345678', isDefaultShipping: true }
    const form = toOrderAddress(saved)
    expect(form).toMatchObject({ divisionId: '3', districtId: '47', areaId: '1001', line1: 'House 12, Road 5' })
    expect(isSameAddress(saved, form)).toBe(true)
    expect(isSameAddress(saved, { ...form, areaId: '1002' })).toBe(false)
    expect(addressSummary({ ...saved, ...PLACES })).toBe('Rahim Uddin, House 12, Road 5, Dhanmondi, Dhaka 1209, Dhaka Division, Bangladesh')
  })

  it('suggests the postcode only when the area has exactly one', () => {
    expect(suggestedPostcode({ postcodes: ['1209'] })).toBe('1209')
    expect(suggestedPostcode({ postcodes: ['1205', '1209'] })).toBeNull()
    expect(suggestedPostcode({ postcodes: [] })).toBeNull()
    expect(placeName({ nameEn: 'Savar', nameBn: 'সাভার' })).toBe('Savar')
  })
})

describe('delivery zones and delivery times', () => {
  it('writes the ETA in days: "Delivery in 1–2 days" / "১–২ দিনে ডেলিভারি"', async () => {
    expect(etaText({ etaDaysMin: 1, etaDaysMax: 2 })).toBe('Delivery in 1–2 days')
    expect(etaText({ etaDaysMin: 1, etaDaysMax: 1 })).toBe('Delivery in 1 day')
    expect(etaText({ etaDaysMin: 3 })).toBe('Delivery in 3 days')
    expect(etaText({})).toBeNull()
    const zone = { code: 'inside_dhaka', name: 'Inside Dhaka', nameEn: 'Inside Dhaka', nameBn: 'ঢাকার ভেতরে' }
    expect(zoneDeliveryText({ etaDaysMin: 1, etaDaysMax: 2, zone: { code: 'inside_dhaka', name: null } }, zone)).toBe('Inside Dhaka · Delivery in 1–2 days')
    // A method without a zone of its own: the cart's zone.
    expect(zoneDeliveryText({ etaDaysMin: 2, etaDaysMax: 3 }, zone)).toBe('Inside Dhaka · Delivery in 2–3 days')
    await switchToBangla()
    expect(etaText({ etaDaysMin: 1, etaDaysMax: 2 })).toBe('১–২ দিনে ডেলিভারি')
    expect(zoneDeliveryText({ etaDaysMin: 3, etaDaysMax: 5 }, zone)).toBe('ঢাকার ভেতরে · ৩–৫ দিনে ডেলিভারি')
    // A zone code alone: BuyNest's own three names.
    expect(zoneDeliveryText({ zone: { code: 'outside_dhaka', name: null } })).toBe('ঢাকার বাইরে')
  })
})

describe('cash on delivery texts', () => {
  it('explains why it isn’t offered, in both languages', async () => {
    setStoreCurrency(TAKA)
    const zone = { code: 'outside_dhaka', name: 'Outside Dhaka', nameBn: 'ঢাকার বাইরে' }
    expect(codUnavailableText({ available: false, reason: 'zone' }, { zone })).toBe("Cash on delivery isn't available for Outside Dhaka. Please choose another way to pay.")
    expect(codUnavailableText({ available: false, reason: 'zone' })).toBe("Cash on delivery isn't available in your area. Please choose another way to pay.")
    expect(codUnavailableText({ available: false, reason: 'limit', maxOrderTotal: 10000 }, { format: formatBasePrice })).toBe('Cash on delivery is available for orders up to ৳10,000.00. Please choose another way to pay.')
    expect(codUnavailableText({ available: false, reason: 'other', message: 'Not today.' })).toBe('Not today.')
    expect(codUnavailableText({ available: true })).toBeNull()
    expect(codRefused({ available: false, reason: 'area_required' })).toBe(false)
    expect(codRefused({ available: false, reason: 'limit' })).toBe(true)
    await switchToBangla()
    expect(codUnavailableText({ available: false, reason: 'limit', maxOrderTotal: 10000 }, { format: formatBasePrice })).toBe('৳১০,০০০.০০ পর্যন্ত অর্ডারে ক্যাশ অন ডেলিভারি পাওয়া যায়। অন্য কোনো উপায়ে পেমেন্ট করুন।')
    expect(codUnavailableText({ available: false, reason: 'zone' }, { zone })).toBe('ঢাকার বাইরে এলাকায় ক্যাশ অন ডেলিভারি নেই। অন্য কোনো উপায়ে পেমেন্ট করুন।')
    expect(codUnavailableText({ available: false, reason: 'area_required' })).toBe('আপনার এলাকায় ক্যাশ অন ডেলিভারি আছে কি না দেখতে এলাকা বেছে নিন।')
  })

  it('says what was paid in advance and what is due on delivery', async () => {
    const order = { paymentMethod: 'cod', paymentStatus: 'partially_paid', status: 'processing', currency: 'BDT', advancePaid: 80, codDue: 2240, totals: { total: 2320 } }
    expect(paymentStatus('partially_paid').label).toBe('Partly paid')
    expect(paymentNote(order)).toBe('Delivery charge of ৳80.00 paid in advance. Please keep ৳2,240.00 ready to pay in cash on delivery.')
    expect(paymentNote({ ...order, paymentStatus: 'unpaid', status: 'pending_payment', paymentProvider: 'sslcommerz', advancePaid: 0 })).toMatch(/^Pay the delivery charge online/)
    expect(paymentNote({ ...order, paymentStatus: 'unpaid', advancePaid: 0 })).toBe('Please keep ৳2,240.00 ready to pay in cash on delivery.')
    // A COD order without the phase 14 keys keeps its old note.
    expect(paymentNote({ paymentMethod: 'cod', paymentStatus: 'unpaid', status: 'processing' })).toMatch(/courier/i)
    await switchToBangla()
    expect(paymentStatus('partially_paid').label).toBe('আংশিক পরিশোধিত')
    expect(paymentNote(order)).toBe('৳৮০.০০ ডেলিভারি চার্জ অগ্রিম পরিশোধিত। ডেলিভারির সময় নগদ ৳২,২৪০.০০ হাতে রাখুন।')
  })
})

describe('the checkout and address book rules for Bangladesh', () => {
  const base = { email: 'rahim@example.com', phone: '01712-345678', billingSameAsShipping: true, billing: {}, shippingMethod: 'standard', paymentMethod: 'cod' }
  const schema = createCheckoutSchema({ countries: ['Bangladesh', 'India'], shippingMethodIds: ['standard'], paymentMethodIds: ['cod'], bangladesh: true })
  const issues = (result) => Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]))

  it('asks for division, district and area (not city or state); the postcode is optional', () => {
    const missing = schema.safeParse({ ...base, shipping: { firstName: 'Rahim', lastName: 'Uddin', line1: '', city: '', state: '', postalCode: '', country: 'Bangladesh' } })
    expect(issues(missing)).toEqual({
      'shipping.divisionId': 'Choose your division.',
      'shipping.districtId': 'Choose your district.',
      'shipping.areaId': 'Choose your area (upazila or thana).',
      'shipping.line1': 'Enter your house, road or village.',
    })
    const ok = schema.safeParse({ ...base, shipping: { ...BD_ADDRESS, divisionId: '3', districtId: '47', areaId: '1001', postalCode: '' } })
    expect(ok.success).toBe(true)
    expect(ok.data.shipping).toMatchObject({ divisionId: '3', areaId: '1001', postalCode: '' })
    const badPostcode = schema.safeParse({ ...base, shipping: { ...BD_ADDRESS, postalCode: '12' } })
    expect(issues(badPostcode)).toEqual({ 'shipping.postalCode': 'A postcode has 4 digits, like 1209. Or leave it empty.' })
    // Bangla digits in the postcode are fine.
    expect(schema.safeParse({ ...base, shipping: { ...BD_ADDRESS, postalCode: '১২০৯' } }).data.shipping.postalCode).toBe('1209')
  })

  it('checks the mobile number as a Bangladeshi one for a Bangladesh address only', () => {
    expect(issues(schema.safeParse({ ...base, phone: '01212345678', shipping: BD_ADDRESS }))).toEqual({ phone: 'Mobile numbers start with 013 to 019. Check the third digit.' })
    const india = { firstName: 'Asha', lastName: 'Rao', line1: '1 MG Road', city: 'Pune', state: 'MH', postalCode: '411001', country: 'India' }
    expect(schema.safeParse({ ...base, phone: '+91 98765 43210', shipping: india }).success).toBe(true)
    // India is checked exactly as before (city, state, postal code required).
    expect(Object.keys(issues(schema.safeParse({ ...base, shipping: { ...india, city: '' } })))).toEqual(['shipping.city'])
  })

  it('without the store setting, a Bangladesh address keeps the old fields', () => {
    const old = createCheckoutSchema({ countries: ['Bangladesh'], shippingMethodIds: ['standard'], paymentMethodIds: ['cod'] })
    const result = old.safeParse({ ...base, shipping: { firstName: 'Rahim', lastName: 'Uddin', line1: 'House 12', city: '', state: 'Dhaka', postalCode: '1207', country: 'Bangladesh' } })
    expect(Object.keys(issues(result))).toEqual(['shipping.city'])
  })

  it('the address book: Bangladesh fields and a Bangladeshi mobile', () => {
    const book = createSavedAddressSchema(['Bangladesh', 'India'], { bangladesh: true })
    const saved = { ...BD_ADDRESS, phone: '0171234567', company: '', isDefaultShipping: true, isDefaultBilling: false }
    expect(issues(book.safeParse({ ...saved, areaId: '' }))).toEqual({
      areaId: 'Choose your area (upazila or thana).',
      phone: 'Enter a Bangladeshi mobile number: 11 digits starting with 01, like 01712-345678.',
    })
    expect(book.safeParse({ ...saved, phone: '01712345678' }).success).toBe(true)
  })
})
