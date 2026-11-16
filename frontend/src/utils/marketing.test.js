import { afterEach, describe, expect, it } from 'vitest'
import { effectiveDiscountPercent, getProductPricing } from './pricing'
import { safeRedirectTarget } from './safeRedirect'
import { applyPageMeta, removePageMetaLayer, setPageMetaLayer, toDescription } from './pageMeta'
import { normalizeCategories, normalizeProductDetail, normalizeProductPage } from '../services/adapters/laravelAdapter'
import { withVariant } from './variants'

/* Phase 7 helpers: rule prices shown as sales, redirect targets, and page meta tags. */

describe('catalog price rules shown as sales', () => {
  it("uses the server's final price when a rule beats the product's own discount", () => {
    expect(effectiveDiscountPercent(100, 10, 80)).toBeCloseTo(20)
    expect(getProductPricing({ price: 100, discountPercentage: effectiveDiscountPercent(100, 10, 80) })).toMatchObject({ hasDiscount: true, roundedDiscount: 20, salePrice: 80 })
  })

  it("keeps the own discount when the final price isn't lower (or unknown)", () => {
    expect(effectiveDiscountPercent(100, 10, 90)).toBe(10)
    expect(effectiveDiscountPercent(100, 10, null)).toBe(10)
    expect(effectiveDiscountPercent(0, 0, 0)).toBe(0)
  })

  it("maps a product's price rule from the API (sale_price + price_rule)", () => {
    const product = normalizeProductDetail({
      data: { id: 4, name: 'Lamp', price: '50.00', discount_percent: 0, sale_price: '37.49', price_rule: { id: 2, name: 'Winter sale' }, images: [], meta_title: ' Best lamp ', meta_description: '' },
    })
    expect(getProductPricing(product).salePrice).toBe(37.49)
    expect(product.priceRule).toEqual({ id: 2, name: 'Winter sale' })
    expect(product.metaTitle).toBe('Best lamp')
    expect(product.metaDescription).toBeNull()
  })

  it('ignores sale_price without a rule (the own discount stays the source)', () => {
    const product = normalizeProductDetail({ data: { id: 4, name: 'Lamp', price: '50.00', discount_percent: 10, sale_price: '45.00', price_rule: null, images: [] } })
    expect(product.discountPercentage).toBe(10)
    expect(product).not.toHaveProperty('priceRule')
  })

  it("prices a variant at its rule price (the variant's final_price)", () => {
    const product = normalizeProductDetail({
      data: { id: 4, name: 'Tee', price: '20.00', discount_percent: 0, images: [], options: [], variants: [{ id: 9, price: '24.00', final_price: '18.00', stock_quantity: 3, option_value_ids: [] }] },
    })
    expect(getProductPricing(withVariant(product, product.variants[0])).salePrice).toBe(18)
  })
})

describe('search redirects and URL redirect targets', () => {
  it('passes a safe redirect_url on from the product list', () => {
    const page = (redirect) => normalizeProductPage({ data: [], meta: { current_page: 1, per_page: 6, total: 0, redirect_url: redirect } })
    expect(page('/deals').redirectUrl).toBe('/deals')
    expect(page('https://help.example.com/sizes').redirectUrl).toBe('https://help.example.com/sizes')
    expect(page(null)).not.toHaveProperty('redirectUrl')
    expect(page('//evil.example')).not.toHaveProperty('redirectUrl')
  })

  it('accepts store paths and https addresses only', () => {
    expect(safeRedirectTarget('/products/5?ref=x')).toBe('/products/5?ref=x')
    for (const bad of ['//evil.example', '/\\evil.example', 'http://evil.example', 'javascript:alert(1)', 'https://', '/a b', null]) {
      expect(safeRedirectTarget(bad)).toBeNull()
    }
  })
})

describe('page meta tags', () => {
  afterEach(() => {
    removePageMetaLayer(1001)
    removePageMetaLayer(1002)
  })

  const tag = (selector, attribute = 'content') => document.head.querySelector(selector)?.getAttribute(attribute) ?? null

  it('writes the defaults: description, canonical, and Open Graph', () => {
    applyPageMeta()
    expect(tag('meta[name="description"]')).toMatch(/BuyNest/)
    expect(tag('link[rel="canonical"]', 'href')).toBe(`${window.location.origin}${window.location.pathname}`)
    expect(tag('meta[property="og:site_name"]')).toBe('BuyNest')
    expect(tag('meta[property="og:type"]')).toBe('website')
    expect(tag('meta[property="og:image"]')).toBe(`${window.location.origin}/favicon.svg`)
  })

  it("uses the latest page's tags, and goes back to the defaults when it leaves", () => {
    setPageMetaLayer(1001, { title: 'Lamp', description: 'A warm lamp.', image: 'https://cdn.example/lamp.webp', type: 'product', canonicalPath: '/products/4' })
    expect(tag('meta[property="og:title"]')).toBe('Lamp')
    expect(tag('meta[name="description"]')).toBe('A warm lamp.')
    expect(tag('meta[property="og:type"]')).toBe('product')
    expect(tag('link[rel="canonical"]', 'href')).toBe(`${window.location.origin}/products/4`)
    expect(tag('meta[name="twitter:card"]')).toBe('summary_large_image')
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)

    setPageMetaLayer(1002, { title: 'Not found', noindex: true })
    expect(tag('meta[name="robots"]')).toBe('noindex')
    expect(tag('link[rel="canonical"]', 'href')).toBeNull()

    removePageMetaLayer(1002)
    removePageMetaLayer(1001)
    expect(tag('meta[name="robots"]')).toBeNull()
    expect(tag('meta[property="og:type"]')).toBe('website')
  })

  it('shortens descriptions to plain text', () => {
    expect(toDescription('<p>Soft   <b>cotton</b></p>')).toBe('Soft cotton')
    expect(toDescription('word '.repeat(60)).length).toBeLessThanOrEqual(160)
    expect(toDescription('  ')).toBeNull()
  })

  it("keeps a category's SEO fields from the tree", () => {
    expect(normalizeCategories({ data: [{ slug: 'lamps', name: 'Lamps', meta_title: 'Lamps & lights', meta_description: 'Warm light.', image_url: null }] })[0]).toEqual({
      slug: 'lamps',
      name: 'Lamps',
      parentSlug: null,
      depth: 0,
      metaTitle: 'Lamps & lights',
      metaDescription: 'Warm light.',
    })
  })
})
