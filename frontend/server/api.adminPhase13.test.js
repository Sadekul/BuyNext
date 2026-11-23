// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 13 admin routes and fields (adminPhase13Api.js, shop/adminPhase13.js):
 * Bangla texts of products (options, specifications), categories, pages and
 * home blocks; the products grid's Bangla filter; email templates per
 * language; the customer's and order's language; Settings → General.
 * Laravel is faked; shapes from docs/backend/PHASE13_CONTRACT.md and the
 * backend's admin resources.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: [] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
}
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((entry) => entry.path !== '/api/admin/v1/me')

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const API_PRODUCT = {
  id: 3, name: 'Tee', sku: 'TEE', price: '20.00', status: 'active', description: 'Soft', images: [],
  specifications: [{ label: 'Material', value: 'Cotton', label_bn: 'উপাদান', value_bn: null }],
  options: [{ id: 8, name: 'Size', name_bn: 'সাইজ', position: 0, values: [{ id: 81, value: 'Small', value_bn: null, position: 0 }] }],
  translations: { bn: { name: 'টি-শার্ট', short_description: null, description: null, meta_title: null, meta_description: null } },
  bangla: { complete: false, missing: ['description'] },
  bangla_complete: false,
}

describe('products in Bangla', () => {
  it('reads the Bangla texts, option names, specification rows, and status', async () => {
    fakeLaravel({ 'GET /api/admin/v1/products/3': { body: { data: API_PRODUCT } } })
    const product = await (await admin('products/3')).json()
    expect(product.bn).toEqual({ name: 'টি-শার্ট', shortDescription: '', description: '', metaTitle: '', metaDescription: '' })
    expect(product.banglaStatus).toBe('missing')
    expect(product.specifications).toEqual([{ label: 'Material', value: 'Cotton', labelBn: 'উপাদান', valueBn: '' }])
    expect(product.options[0]).toMatchObject({ id: 8, name: 'Size', nameBn: 'সাইজ', values: [{ id: 81, value: 'Small', valueBn: '' }] })
  })

  it('an older answer has no Bangla fields', async () => {
    const older = { ...API_PRODUCT, options: [{ id: 8, name: 'Size', position: 0, values: [{ id: 81, value: 'Small', position: 0 }] }], specifications: [{ label: 'Material', value: 'Cotton' }] }
    for (const key of ['translations', 'bangla', 'bangla_complete']) delete older[key]
    fakeLaravel({ 'GET /api/admin/v1/products/3': { body: { data: older } } })
    const product = await (await admin('products/3')).json()
    expect(product.bn).toBeUndefined()
    expect(product.banglaStatus).toBeUndefined()
    expect(product.specifications).toEqual([{ label: 'Material', value: 'Cotton' }])
    expect(product.options[0]).toEqual({ id: 8, name: 'Size', position: 0, values: [{ id: 81, value: 'Small', position: 0 }] })
  })

  it('saves the Bangla texts as translations.bn and rows with label_bn/value_bn', async () => {
    const calls = fakeLaravel({ 'PATCH /api/admin/v1/products/3': { body: { data: API_PRODUCT } } })
    const response = await admin('products/3', {
      method: 'PUT',
      body: { bn: { name: ' টি-শার্ট ', description: '', metaTitle: null }, specifications: [{ label: 'Material', value: 'Cotton', labelBn: 'উপাদান', valueBn: '' }] },
    })
    expect(response.status).toBe(200)
    expect(sent(toApi(calls)[0])).toEqual({
      translations: { bn: { name: 'টি-শার্ট', description: null, meta_title: null } },
      specifications: [{ label: 'Material', value: 'Cotton', label_bn: 'উপাদান', value_bn: null }],
    })
  })

  it('refuses Bangla texts that are too long or not text, before any call', async () => {
    const calls = fakeLaravel({})
    const response = await admin('products/3', { method: 'PUT', body: { bn: { name: 'ক'.repeat(121), description: 5 }, specifications: [{ label: 'A', value: 'B', labelBn: 'ক'.repeat(61) }] } })
    expect(response.status).toBe(422)
    const { errors } = await response.json()
    expect(errors['bn.name']).toEqual(['Keep this under 120 characters.'])
    expect(errors['bn.description']).toEqual(['Enter text.'])
    expect(errors.specifications).toEqual(['Keep every Bangla label under 60 characters.'])
    expect(toApi(calls)).toEqual([])
  })

  it('saves option names in Bangla with the options (values_bn in the values’ order)', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/products/3/options': { body: { data: API_PRODUCT } } })
    const response = await admin('products/3/options', { method: 'PUT', body: { options: [{ name: 'Size', values: ['Small', 'Large'], nameBn: ' সাইজ ', valuesBn: ['ছোট', ''] }] } })
    expect(response.status).toBe(200)
    expect(sent(toApi(calls)[0])).toEqual({ options: [{ name: 'Size', values: ['Small', 'Large'], name_bn: 'সাইজ', values_bn: ['ছোট', null] }] })
    // Without Bangla names: exactly as before (the saved ones stay).
    await admin('products/3/options', { method: 'PUT', body: { options: [{ name: 'Size', values: ['Small'] }] } })
    expect(sent(toApi(calls)[1])).toEqual({ options: [{ name: 'Size', values: ['Small'] }] })
    const refused = await admin('products/3/options', { method: 'PUT', body: { options: [{ name: 'Size', values: ['Small'], valuesBn: ['ছোট', 'বড়'] }] } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors['options.0.valuesBn']).toBeDefined()
  })

  it('filters the grid by Bangla status and maps each row', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/products': { body: { data: [{ ...API_PRODUCT, bangla: { complete: true, missing: [] } }], meta: { total: 1 } } } })
    const list = await (await admin('products?bangla=missing')).json()
    expect(new URLSearchParams(toApi(calls)[0].search).get('bangla')).toBe('missing')
    expect(list.products[0].banglaStatus).toBe('complete')
    await admin('products?bangla=nonsense')
    expect(new URLSearchParams(toApi(calls)[1].search).get('bangla')).toBeNull()
  })
})

describe('categories, pages and the home page', () => {
  it('reads and saves a category’s Bangla texts', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/categories': { body: { data: [{ id: 1, name: 'Beauty', slug: 'beauty', parent_id: null, translations: { bn: { name: 'সৌন্দর্য', description: null, meta_title: null, meta_description: null } }, children: [] }] } },
      'PATCH /api/admin/v1/categories/1': { body: { data: { id: 1, name: 'Beauty', slug: 'beauty' } } },
    })
    const [category] = await (await admin('categories')).json()
    expect(category.bn).toEqual({ name: 'সৌন্দর্য', description: '', metaTitle: '', metaDescription: '' })
    expect((await admin('categories/1', { method: 'PATCH', body: { bn: { name: 'সৌন্দর্য', description: '' } } })).status).toBe(200)
    expect(sent(toApi(calls)[1])).toEqual({ translations: { bn: { name: 'সৌন্দর্য', description: null } } })
  })

  it('saves a page’s Bangla content as typed (the API sanitizes it)', async () => {
    const calls = fakeLaravel({ 'PATCH /api/admin/v1/pages/3': { body: { data: { id: 3, slug: 'about', title: 'About', body: '<p>Hi</p>', translations: { bn: { title: 'আমাদের কথা', body: '<p>স্বাগতম</p>', meta_title: null, meta_description: null } } } } } })
    const response = await admin('pages/3', { method: 'PATCH', body: { bn: { title: 'আমাদের কথা', body: '<p>স্বাগতম</p>\n' } } })
    expect((await response.json()).page.bn).toEqual({ title: 'আমাদের কথা', body: '<p>স্বাগতম</p>', metaTitle: '', metaDescription: '' })
    expect(sent(toApi(calls)[0])).toEqual({ translations: { bn: { title: 'আমাদের কথা', body: '<p>স্বাগতম</p>\n' } } })
  })

  it("saves the hero's and banners' Bangla texts", async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/home': { body: { data: { hero: { title: 'Hello', bn: { title: 'হ্যালো', highlights: ['ফ্রি'] } }, banners: [{ id: 1, title: 'Laptops', bn: { cta_label: 'দেখুন' } }] } } } })
    const response = await admin('home', {
      method: 'PUT',
      body: {
        hero: { title: 'Hello', primaryCta: { label: 'Shop', url: '/products' }, highlights: [], bn: { title: 'হ্যালো', primaryCtaLabel: 'কিনুন', highlights: ['ফ্রি', ''] } },
        banners: [{ title: 'Laptops', cta: { label: 'Go', url: '/laptops' }, tone: 'navy', bn: { ctaLabel: 'দেখুন' } }],
        featuredProductIds: [],
      },
    })
    expect(response.status).toBe(200)
    const body = sent(toApi(calls)[0])
    expect(body.hero.bn).toEqual({ title: 'হ্যালো', primary_cta_label: 'কিনুন', highlights: ['ফ্রি'] })
    expect(body.banners[0].bn).toEqual({ cta_label: 'দেখুন' })
    const { home } = await response.json()
    expect(home.hero.bn).toMatchObject({ title: 'হ্যালো', highlights: ['ফ্রি'] })
    expect(home.banners[0].bn).toMatchObject({ ctaLabel: 'দেখুন', title: '' })
  })
})

describe('email templates per language', () => {
  const TEMPLATE = { key: 'order_confirmation', locale: 'bn', name: 'Order confirmation', description: '', subject: 'আপনার অর্ডার', body: '<p>ধন্যবাদ</p>', is_customized: true, updated_at: null, updated_by: null, variables: [], required: [], locales: { en: { is_customized: false, updated_at: null }, bn: { is_customized: true, updated_at: '2026-11-20T10:00:00Z' } } }

  it('lists every language, and reads, saves, previews, tests and resets one', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/email-templates': { body: { data: [TEMPLATE] } },
      'GET /api/admin/v1/email-templates/order_confirmation': { body: { data: TEMPLATE } },
      'PUT /api/admin/v1/email-templates/order_confirmation': { body: { data: TEMPLATE } },
      'POST /api/admin/v1/email-templates/order_confirmation/preview': { body: { data: { subject: 'আপনার অর্ডার', html: '<p>x</p>', text: 'x' } } },
      'POST /api/admin/v1/email-templates/order_confirmation/test': { status: 202, body: { message: 'Sent.', data: { email: 'admin@buynest.test' } } },
      'POST /api/admin/v1/email-templates/order_confirmation/reset': { body: { data: { ...TEMPLATE, is_customized: false } } },
    })
    const list = await (await admin('email-templates')).json()
    expect(list.templates[0].locales).toEqual({ en: { subject: '', isCustomized: false, updatedAt: null }, bn: { subject: '', isCustomized: true, updatedAt: '2026-11-20T10:00:00Z' } })
    const template = await (await admin('email-templates/order_confirmation?locale=bn')).json()
    expect(template).toMatchObject({ key: 'order_confirmation', locale: 'bn', subject: 'আপনার অর্ডার', isCustomized: true })
    expect((await admin('email-templates/order_confirmation?locale=bn', { method: 'PUT', body: { subject: 'আপনার অর্ডার', body: '<p>ধন্যবাদ</p>' } })).status).toBe(200)
    expect(await (await admin('email-templates/order_confirmation/preview?locale=bn', { method: 'POST', body: { subject: 'আপনার অর্ডার' } })).json()).toEqual({ subject: 'আপনার অর্ডার', html: '<p>x</p>', text: 'x', locale: 'bn' })
    expect(await (await admin('email-templates/order_confirmation/test?locale=bn', { method: 'POST', body: {} })).json()).toEqual({ sent: true, to: 'admin@buynest.test', message: 'Sent.' })
    expect((await (await admin('email-templates/order_confirmation/reset?locale=bn', { method: 'POST', body: {} })).json()).template.isCustomized).toBe(false)
    const api = toApi(calls)
    expect(api.slice(1).every((entry) => new URLSearchParams(entry.search).get('locale') === 'bn')).toBe(true)
    expect(sent(api[2])).toEqual({ subject: 'আপনার অর্ডার', body: '<p>ধন্যবাদ</p>', locale: 'bn' })
    expect(sent(api[5])).toEqual({ locale: 'bn' })
  })

  it('without a language works as before; an unknown one is refused', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/email-templates/order_confirmation': { body: { data: { ...TEMPLATE, locale: 'en' } } } })
    const template = await (await admin('email-templates/order_confirmation')).json()
    expect(template.locale).toBeUndefined()
    expect(toApi(calls)[0].search).toBe('')
    const refused = await admin('email-templates/order_confirmation?locale=fr')
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors.locale).toBeDefined()
    expect((await admin('email-templates/Bad-Key?locale=bn')).status).toBe(404)
    expect(toApi(calls)).toHaveLength(1)
  })
})

describe("customers, orders and settings", () => {
  it("reads and changes a customer's language", async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/customers/5': { body: { data: { id: 5, first_name: 'Nadia', last_name: 'Rahman', email: 'n@example.com', locale: 'bn' } } },
      'PATCH /api/admin/v1/customers/5': { body: { data: { id: 5, first_name: 'Nadia', last_name: 'Rahman', email: 'n@example.com', locale: null } } },
    })
    expect((await (await admin('customers/5')).json()).locale).toBe('bn')
    const updated = await (await admin('customers/5', { method: 'PATCH', body: { locale: null } })).json()
    expect(updated.locale).toBeNull()
    expect(sent(toApi(calls)[1])).toEqual({ locale: null })
    const refused = await admin('customers/5', { method: 'PATCH', body: { locale: 'fr' } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors.locale).toEqual(['Choose English, Bangla, or the store default.'])
  })

  it("shows the order's language", async () => {
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: { number: 'BN-100001', email: 'n@example.com', locale: 'bn', items: [], totals: {}, status: 'processing' } } } })
    expect((await (await admin('orders/BN-100001')).json()).locale).toBe('bn')
  })

  it('reads and saves the default language and Bangla digits', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/settings': { body: { data: { general: { store_name: 'BuyNest', default_locale: 'en', bangla_digits: true } } } },
      'PATCH /api/admin/v1/settings': { body: { data: { general: { store_name: 'BuyNest', default_locale: 'bn', bangla_digits: false } } } },
    })
    expect((await (await admin('settings')).json()).general).toEqual({ storeName: 'BuyNest', defaultLocale: 'en', banglaDigits: true })
    const saved = await admin('settings', { method: 'PATCH', body: { general: { defaultLocale: 'bn', banglaDigits: false } } })
    expect((await saved.json()).general).toMatchObject({ defaultLocale: 'bn', banglaDigits: false })
    expect(sent(toApi(calls)[1])).toEqual({ general: { default_locale: 'bn', bangla_digits: false } })
    const refused = await admin('settings', { method: 'PATCH', body: { general: { defaultLocale: 'fr', banglaDigits: 'yes' } } })
    expect(Object.keys((await refused.json()).errors).sort()).toEqual(['general.banglaDigits', 'general.defaultLocale'])
  })
})
