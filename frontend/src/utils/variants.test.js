import { describe, expect, it } from 'vitest'
import { chooseValue, findVariant, hasVariants, initialSelection, isValueAvailable, variantLabel, withVariant } from './variants'
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
