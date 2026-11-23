import { afterEach, describe, expect, it } from 'vitest'
import { formatBasePrice, formatDate, formatNumber, formatPrice } from '../utils/formatters'
import { resetDisplayCurrencyForTests, setStoreCurrency } from '../utils/displayCurrency'
import { currentLanguage, translate } from '.'
import { switchToBangla } from '../test/i18n'
import { formatPoints } from '../utils/rewards'
import { availabilityLabel } from '../utils/catalogText'
import { paymentMethodLabel, shippingMethodText } from '../utils/payment'
import { orderStatus } from '../constants/orders'
import { browserPrefersBangla } from '../components/layout/languageChoice'

// Phase 13 (docs/backend/PHASE13_CONTRACT.md §1–§2): money, numbers and dates in Bangla, and the
// helpers that put fixed English codes into the shopper's language.

const TAKA = { code: 'BDT', symbol: '৳', decimals: 2 }
afterEach(() => resetDisplayCurrencyForTests())

describe('money in Bangla (the same layout as the API’s emails and PDFs)', () => {
  it('is symbol first with groups of three and Bangla digits: ৳১,২৫০.০০', async () => {
    setStoreCurrency(TAKA)
    await switchToBangla()
    expect(formatBasePrice(1250)).toBe('৳১,২৫০.০০')
    expect(formatPrice(1250)).toBe('৳১,২৫০.০০')
    // Groups of three, never the lakh grouping of Intl bn-BD ("১২,৩৪,৫৬৭.৮৯৳").
    expect(formatBasePrice(1234567.89)).toBe('৳১,২৩৪,৫৬৭.৮৯')
    expect(formatBasePrice(-5)).toBe('-৳৫.০০')
  })

  it('keeps Latin digits when the store turned Bangla digits off: ৳1,250.00', async () => {
    setStoreCurrency(TAKA)
    await switchToBangla({ digits: false })
    expect(formatBasePrice(1250)).toBe('৳1,250.00')
    expect(formatBasePrice(1234567.89)).toBe('৳1,234,567.89')
  })

  it('is unchanged in English', () => {
    setStoreCurrency(TAKA)
    expect(currentLanguage()).toBe('en')
    expect(formatBasePrice(1250)).toBe('৳1,250.00')
  })
})

describe('numbers, dates and words in Bangla', () => {
  it('writes numbers and dates with Intl bn-BD (Latin digits when turned off)', async () => {
    await switchToBangla()
    expect(formatNumber(1500)).toBe('১,৫০০')
    expect(formatDate('2026-11-19T10:00:00Z')).toMatch(/১৯/)
    expect(formatDate('2026-11-19T10:00:00Z')).toMatch(/নভেম্বর/)
    expect(formatPoints(1500)).toBe('১,৫০০ পয়েন্ট')
    await switchToBangla({ digits: false })
    expect(formatNumber(1500)).toBe('1,500')
  })

  it('translates fixed codes: availability, order status, payment and delivery methods', async () => {
    await switchToBangla()
    expect(availabilityLabel('In Stock')).toBe('স্টকে আছে')
    expect(availabilityLabel('Something new')).toBe('Something new')
    expect(orderStatus('shipped').label).toBe('পাঠানো হয়েছে')
    expect(paymentMethodLabel('cod')).toBe('ক্যাশ অন ডেলিভারি')
    // A label the store wrote itself is shown as written.
    expect(paymentMethodLabel({ id: 'cod', label: 'Pay at the door' })).toBe('Pay at the door')
    expect(shippingMethodText({ id: 'standard' })).toEqual({ label: 'স্ট্যান্ডার্ড', eta: '৩–৫ কর্মদিবস' })
    expect(translate('cart:summary.subtotal', { count: 3 })).toBe('সাবটোটাল (৩টি পণ্য)')
  })

  it('offers the Bangla hint only when the browser lists Bangla before English', () => {
    expect(browserPrefersBangla(['bn-BD', 'en-US'])).toBe(true)
    expect(browserPrefersBangla(['en-US', 'bn'])).toBe(false)
    expect(browserPrefersBangla(['fr'])).toBe(false)
  })
})

describe('the free-shipping texts name the store’s own threshold, never a fixed "$50"', () => {
  it('shows the threshold in the store currency and language, or no amount without one', async () => {
    const { freeShippingAmount } = await import('../constants/site')
    const { localizedBenefits, localizedHeroContent } = await import('../data/homeContent')
    setStoreCurrency(TAKA)
    await switchToBangla()
    const amount = freeShippingAmount(5000, formatBasePrice)
    expect(amount).toBe('৳৫,০০০')
    const shipping = (freeShipping) => localizedBenefits((key, values) => translate(`marketing:${key}`, values), freeShipping).find((benefit) => benefit.id === 'shipping')
    expect(shipping(amount).text).toBe('৳৫,০০০-এর বেশি প্রতিটি অর্ডারে।')
    expect(shipping(freeShippingAmount(null, formatBasePrice)).text).toBe('শর্ত পূরণ করা অর্ডারে।')
    const hero = localizedHeroContent((key, values) => translate(`marketing:${key}`, values), amount)
    expect(hero.highlights[0]).toBe('৳৫,০০০-এর বেশি অর্ডারে ফ্রি ডেলিভারি')
    expect(JSON.stringify(hero)).not.toContain('$')
  })
})
