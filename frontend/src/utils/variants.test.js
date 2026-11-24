import { describe, expect, it } from 'vitest'
import {
  chooseValue,
  findVariant,
  fromPrice,
  galleryOrder,
  hasVariants,
  initialSelection,
  isValueAvailable,
  optionSlug,
  searchForSelection,
  selectionFromSearch,
  variantLabel,
  variantPriceRange,
  withVariant,
} from './variants'
import { configurableTee as TEE } from '../test/fixtures'

describe('variant selection', () => {
  it('knows which products sell through variants', () => {
    expect(hasVariants(TEE)).toBe(true)
    expect(hasVariants({ ...TEE, options: [], variants: [] })).toBe(false)
    expect(hasVariants({ id: 1, title: 'DummyJSON product' })).toBe(false)
  })

  it('finds a variant only for a complete selection', () => {
    expect(findVariant(TEE, { 1: 12 })).toBeNull()
    expect(findVariant(TEE, { 1: 12, 2: 22 })).toMatchObject({ id: 53 })
  })

  it('disables values with no variant in stock for the earlier choices, never the first option', () => {
    expect(isValueAvailable(TEE, {}, 1, 11)).toBe(true)
    expect(isValueAvailable(TEE, { 1: 11 }, 2, 22)).toBe(false) // S/Blue doesn't exist
    expect(isValueAvailable(TEE, { 1: 12 }, 2, 21)).toBe(false) // M/Red is sold out
    expect(isValueAvailable(TEE, { 1: 12, 2: 22 }, 1, 11)).toBe(true) // the first option stays open
  })

  it('clears later choices that no longer fit', () => {
    expect(chooseValue(TEE, { 1: 12, 2: 22 }, 1, 11)).toEqual({ 1: 11 })
    expect(chooseValue(TEE, { 1: 11, 2: 21 }, 1, 11)).toEqual({ 1: 11, 2: 21 })
  })

  it('preselects options with a single value', () => {
    const oneColor = { ...TEE, options: [TEE.options[0], { id: 2, name: 'Color', values: [{ id: 21, value: 'Red' }] }] }
    expect(initialSelection(oneColor)).toEqual({ 2: 21 })
    expect(initialSelection(TEE)).toEqual({})
  })

  it('builds the label and the purchasable product', () => {
    expect(variantLabel(TEE, TEE.variants[2])).toBe('Size: M / Color: Blue')
    expect(withVariant(TEE, TEE.variants[2])).toMatchObject({ id: 5, price: 22, stock: 3, sku: 'TEE-M-BLUE', variantId: 53, variantLabel: 'Size: M / Color: Blue', discountPercentage: 10 })
  })
})

describe('phase 16: Magento-style choice', () => {
  it('pre-selects only the single buyable combination', () => {
    expect(initialSelection(TEE)).toEqual({}) // two variants in stock: nothing chosen
    const oneLeft = { ...TEE, variants: TEE.variants.map((variant) => (variant.id === 53 ? variant : { ...variant, stock: 0, inStock: false })) }
    expect(initialSelection(oneLeft)).toEqual({ 1: 12, 2: 22 })
    expect(initialSelection({ ...TEE, variants: [TEE.variants[1]] })).toEqual({ 1: 12, 2: 21 }) // the only variant, even sold out
  })

  it('"From": the lowest final price, only when variants differ', () => {
    expect(variantPriceRange(TEE)).toEqual({ min: 18, max: 19.8 }) // the product's 10 % applies
    expect(variantPriceRange({ ...TEE, variants: [{ ...TEE.variants[0], finalPrice: 15 }, TEE.variants[2]] })).toEqual({ min: 15, max: 19.8 })
    expect(fromPrice(TEE)).toBe(18)
    expect(fromPrice({ priceRange: { min: 20, max: 24 } })).toBe(20)
    expect(fromPrice({ priceRange: { min: 22, max: 22 } })).toBeNull()
    expect(fromPrice({ price: 9, priceRange: null })).toBeNull()
  })

  it('slugs option names and values for the URL', () => {
    expect(optionSlug('Sky Blue')).toBe('sky-blue')
    expect(optionSlug('128 GB')).toBe('128-gb')
    expect(optionSlug('Crème')).toBe('creme')
    expect(optionSlug('নীল')).not.toBe('')
  })

  it('writes a full choice to the query and reads it back; invalid parameters are ignored', () => {
    expect(searchForSelection(TEE, { 1: 12, 2: 22 }, '?ref=mail')).toBe('?ref=mail&size=m&color=blue')
    expect(searchForSelection(TEE, { 1: 12 }, '?size=m&color=blue')).toBe('')
    expect(selectionFromSearch(TEE, '?size=m&color=blue')).toEqual({ 1: 12, 2: 22 })
    expect(selectionFromSearch(TEE, '?SIZE=x&color=purple')).toBeNull()
    expect(selectionFromSearch(TEE, '?size=s&color=blue')).toEqual({ 1: 11 }) // S/Blue doesn't exist
    expect(selectionFromSearch(TEE, '?size=m&color=red')).toEqual({ 1: 12 }) // sold out…
    expect(selectionFromSearch(TEE, '?size=m&color=red', { soldOut: true })).toEqual({ 1: 12, 2: 21 }) // …unless stock alerts are on
    expect(selectionFromSearch({ id: 1 }, '?size=m')).toBeNull()
  })

  it('uses the API codes for the URL, the same in Bangla and English', () => {
    const bangla = {
      ...TEE,
      options: [
        { id: 1, name: 'সাইজ', code: 'size', values: [{ id: 11, value: 'S', code: 's' }, { id: 12, value: 'M', code: 'm' }] },
        { id: 2, name: 'রং', code: 'color', values: [{ id: 21, value: 'লাল', code: 'red' }, { id: 22, value: 'নীল', code: 'blue' }] },
      ],
    }
    expect(searchForSelection(bangla, { 1: 12, 2: 22 }, '')).toBe('?size=m&color=blue')
    expect(selectionFromSearch(bangla, '?size=m&color=blue')).toEqual({ 1: 12, 2: 22 }) // an English link, opened in Bangla
    expect(selectionFromSearch(bangla, '?size=m&color=Blue')).toEqual({ 1: 12, 2: 22 })
    expect(selectionFromSearch(bangla, `?${new URLSearchParams({ 'রং': 'নীল', size: 'm' })}`)).toEqual({ 1: 12, 2: 22 }) // an old name-slug link
    expect(selectionFromSearch(bangla, '?color=purple')).toBeNull()
  })

  it('puts the chosen value\'s photos first, then the shared ones', () => {
    const product = { ...TEE, images: ['a', 'red', 'blue1', 'blue2'], imageOptionValueIds: [null, 21, 22, 22] }
    expect(galleryOrder(product, {})).toEqual({ indexes: [0, 1, 2, 3], valueId: null })
    expect(galleryOrder(product, { 2: 22 })).toEqual({ indexes: [2, 3, 0], valueId: 22 })
    expect(galleryOrder(product, { 1: 11 })).toEqual({ indexes: [0, 1, 2, 3], valueId: null })
    expect(galleryOrder({ ...product, imageOptionValueIds: undefined }, { 2: 22 }).valueId).toBeNull()
  })
})
