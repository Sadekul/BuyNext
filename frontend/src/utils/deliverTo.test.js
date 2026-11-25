import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearDeliverTo, deliverToPlace, getDeliverTo, prefillDeliverTo, resetDeliverToForTests, sanitizeDeliverTo, saveDeliverTo } from './deliverTo'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { switchToBangla } from '../test/i18n'

// Phase 17 §3.2: the "Deliver to" choice, remembered per browser, and the checkout pre-fill.
const CHOICE = {
  divisionId: 3, districtId: '47', areaId: '1001',
  division: { nameEn: 'Dhaka', nameBn: 'ঢাকা' }, district: { name_en: 'Dhaka', name_bn: 'ঢাকা' }, area: { nameEn: 'Banani', nameBn: 'বনানী', postcodes: ['1213', 'x'], extra: 'dropped' },
}
const EMPTY = { firstName: '', lastName: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'Bangladesh', divisionId: '', districtId: '', areaId: '' }
const BD = { bangladeshAddresses: true }

beforeEach(() => resetDeliverToForTests())
afterEach(() => resetDeliverToForTests())

describe('deliverTo', () => {
  it('keeps only a well-formed choice (string ids, names, 4-digit postcodes)', () => {
    expect(sanitizeDeliverTo(CHOICE)).toEqual({
      divisionId: '3', districtId: '47', areaId: '1001',
      division: { nameEn: 'Dhaka', nameBn: 'ঢাকা' }, district: { nameEn: 'Dhaka', nameBn: 'ঢাকা' }, area: { nameEn: 'Banani', nameBn: 'বনানী', postcodes: ['1213'] },
    })
    expect(sanitizeDeliverTo({ ...CHOICE, areaId: 'abc' })).toBeNull()
    expect(sanitizeDeliverTo({ ...CHOICE, area: null })).toBeNull()
    expect(sanitizeDeliverTo('Banani')).toBeNull()
  })

  it('saves, reads back after a reload, and clears', () => {
    saveDeliverTo(CHOICE)
    resetDeliverToForTests()
    expect(getDeliverTo()).toMatchObject({ areaId: '1001', area: { nameEn: 'Banani' } })
    clearDeliverTo()
    expect(getDeliverTo()).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEYS.deliverTo)).toBeNull()
  })

  it('ignores a broken stored value, and works with storage blocked (for this page)', () => {
    window.localStorage.setItem(STORAGE_KEYS.deliverTo, '{not json')
    expect(getDeliverTo()).toBeNull()
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked') } })
    try {
      resetDeliverToForTests()
      expect(getDeliverTo()).toBeNull()
      expect(saveDeliverTo(CHOICE)).not.toBeNull()
      expect(getDeliverTo().areaId).toBe('1001')
      clearDeliverTo()
      expect(getDeliverTo()).toBeNull()
    } finally {
      Object.defineProperty(window, 'localStorage', original)
    }
  })

  it('names the place in the reader’s language', async () => {
    const choice = sanitizeDeliverTo(CHOICE)
    expect(deliverToPlace(choice)).toBe('Banani, Dhaka')
    expect(deliverToPlace({ ...choice, area: { nameEn: 'Dhaka', nameBn: null } })).toBe('Dhaka')
    await switchToBangla()
    expect(deliverToPlace(choice)).toBe('বনানী, ঢাকা')
  })

  it('pre-fills only an empty Bangladesh address in a store with the Bangladesh form', () => {
    const choice = sanitizeDeliverTo(CHOICE)
    expect(prefillDeliverTo(EMPTY, choice, BD)).toEqual({ ...EMPTY, divisionId: '3', districtId: '47', areaId: '1001', state: 'Dhaka', city: 'Dhaka', postalCode: '1213' })
    // A typed postcode stays; an area with several postcodes fills none.
    expect(prefillDeliverTo({ ...EMPTY, postalCode: '1212' }, choice, BD).postalCode).toBe('1212')
    expect(prefillDeliverTo(EMPTY, { ...choice, area: { ...choice.area, postcodes: ['1216', '1221'] } }, BD).postalCode).toBe('')
    // Already chosen, another country, no Bangladesh form, or nothing remembered: unchanged.
    const chosen = { ...EMPTY, divisionId: '6' }
    expect(prefillDeliverTo(chosen, choice, BD)).toBe(chosen)
    const india = { ...EMPTY, country: 'India' }
    expect(prefillDeliverTo(india, choice, BD)).toBe(india)
    expect(prefillDeliverTo(EMPTY, choice, { bangladeshAddresses: false })).toBe(EMPTY)
    expect(prefillDeliverTo(EMPTY, null, BD)).toBe(EMPTY)
  })
})
