import { describe, expect, it } from 'vitest'
import { normalizeImageVariants, responsiveImageProps, smallestImage, srcSetOf } from './images'
import { normalizeProduct } from '../services/adapters/laravelAdapter'

const HEX = 'b'.repeat(32)
const ORIGINAL = `/media/products/12/${HEX}.jpg`
const BOTH = { 320: `/media/products/12/${HEX}-320.webp`, 960: `/media/products/12/${HEX}-960.webp` }

describe('responsive product photos', () => {
  it('keeps only the known widths with safe addresses', () => {
    expect(normalizeImageVariants({ '320': BOTH[320], '960': 'javascript:alert(1)', '640': '/media/x.jpg' })).toEqual({ 320: BOTH[320] })
    expect(normalizeImageVariants({})).toBeNull()
    expect(normalizeImageVariants([])).toBeNull()
    expect(normalizeImageVariants(null)).toBeNull()
    expect(normalizeImageVariants({ 320: '/media/a b.jpg' })).toBeNull() // a space would break srcset
  })

  it('lists the copies plus the original (wider than the largest copy)', () => {
    expect(srcSetOf(BOTH, ORIGINAL)).toBe(`${BOTH[320]} 320w, ${BOTH[960]} 960w, ${ORIGINAL} 1600w`)
    // Only a 320 copy: the original is at most 960 wide.
    expect(srcSetOf({ 320: BOTH[320] }, ORIGINAL)).toBe(`${BOTH[320]} 320w, ${ORIGINAL} 960w`)
    expect(srcSetOf(null, ORIGINAL)).toBeUndefined()
  })

  it('adds srcset and sizes only when there are copies', () => {
    expect(responsiveImageProps(ORIGINAL, BOTH, '50vw')).toEqual({ srcSet: srcSetOf(BOTH, ORIGINAL), sizes: '50vw' })
    expect(responsiveImageProps('https://cdn.dummyjson.com/a.png', null, '50vw')).toEqual({})
    expect(smallestImage(ORIGINAL, BOTH)).toBe(BOTH[320])
    expect(smallestImage(ORIGINAL, null)).toBe(ORIGINAL)
  })

  it("maps the API's image and thumbnail variants onto the product", () => {
    const product = normalizeProduct({
      id: 12, name: 'Lamp', price: '10.00', thumbnail_url: ORIGINAL, thumbnail_variants: BOTH,
      images: [{ url: ORIGINAL, alt: null, variants: BOTH }, { url: 'https://cdn.dummyjson.com/x.png', alt: null, variants: {} }],
    })
    expect(product.imageVariants).toEqual([BOTH, null])
    expect(product.thumbnailVariants).toEqual(BOTH)
    // A list item without thumbnail_variants: the first image's, when the thumbnail is that image.
    expect(normalizeProduct({ id: 1, name: 'A', price: '1', thumbnail_url: ORIGINAL, images: [{ url: ORIGINAL, variants: BOTH }] }).thumbnailVariants).toEqual(BOTH)
    expect(normalizeProduct({ id: 1, name: 'A', price: '1', thumbnail_url: 'https://cdn.dummyjson.com/t.png' }).thumbnailVariants).toBeNull()
  })
})
