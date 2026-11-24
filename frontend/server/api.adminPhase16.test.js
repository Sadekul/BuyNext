// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { validateImage, validateOptions } from './adminCatalogApi'
import { adminImage, adminOption, toOptionLookBody } from './shop/adminCatalog'

/*
 * Phase 16 admin routes (docs/backend/PHASE16_CONTRACT.md §1, §2): option
 * types and colour swatches on PUT products/:id/options, and the option value
 * an image is shown for on PATCH products/:id/images/:imageId. Laravel is faked.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Admin', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['products.view', 'products.edit'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const route = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : (routes[key] ?? { status: 404, body: { message: 'Not found' } })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}
const admin = (action, { method = 'GET', body } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  )
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((call) => call.path !== '/api/admin/v1/me')

const API_PRODUCT = {
  id: 4,
  images: [
    { id: 7, url: 'a.jpg', alt: '', position: 0, is_upload: true, option_value_id: 12 },
    { id: 8, url: 'b.jpg', alt: '', position: 1, is_upload: true, option_value_id: null },
  ],
  options: [
    {
      id: 1,
      name: 'Color',
      type: 'color',
      position: 0,
      values: [
        { id: 11, value: 'Red', swatch: '#c0392b', position: 0 },
        { id: 12, value: 'Blue', swatch: '#1E40AF', position: 1 },
      ],
    },
    { id: 2, name: 'Size', type: 'text', position: 1, values: [{ id: 21, value: 'M', swatch: null, position: 0 }] },
  ],
  variants: [],
}

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('option types and swatches (checks)', () => {
  it('keeps plain text options exactly as before (no type sent)', () => {
    expect(validateOptions({ options: [{ name: 'Size', values: ['S', 'M'] }] })).toEqual({ values: { options: [{ name: 'Size', values: ['S', 'M'] }] } })
  })

  it('accepts a color option with a #RRGGBB swatch per value (objects or text)', () => {
    const { values } = validateOptions({ options: [{ name: 'Color', type: 'color', values: [{ value: ' Red ', swatch: '#c0392b' }, { value: 'Blue', swatch: '#1E40AF' }] }] })
    expect(values.options[0]).toEqual({ name: 'Color', type: 'color', values: ['Red', 'Blue'], swatches: ['#C0392B', '#1E40AF'] })
    const text = validateOptions({ options: [{ name: 'Size', type: 'text', values: ['S', { value: 'M', swatch: '#000000' }] }] })
    expect(text.values.options[0]).toEqual({ name: 'Size', type: 'text', values: ['S', 'M'], swatches: [null, null] })
  })

  it('refuses an unknown type and missing or malformed swatches, by path', () => {
    const { errors } = validateOptions({
      options: [
        { name: 'Look', type: 'image', values: ['A'] },
        { name: 'Color', type: 'color', values: [{ value: 'Red', swatch: '#c0392b' }, { value: 'Blue', swatch: 'blue' }, 'Green', { value: 'Pink', swatch: '#fff' }] },
      ],
    })
    expect(Object.keys(errors).sort()).toEqual(['options.0.type', 'options.1.values.1.swatch', 'options.1.values.2.swatch', 'options.1.values.3.swatch'])
    const two = validateOptions({ options: [{ name: 'Color', type: 'color', values: [{ value: 'Red', swatch: '#C0392B' }] }, { name: 'Trim', type: 'color', values: [{ value: 'Gold', swatch: '#D4AF37' }] }] })
    expect(two.errors).toEqual({ 'options.1.type': ['Only one option can use colour swatches.'] })
  })

  it('checks an image change: alt and/or optionValueId', () => {
    expect(validateImage({ optionValueId: 12 })).toEqual({ values: { optionValueId: 12 } })
    expect(validateImage({ optionValueId: null })).toEqual({ values: { optionValueId: null } })
    expect(validateImage({ alt: ' Front ', optionValueId: 3 })).toEqual({ values: { alt: 'Front', optionValueId: 3 } })
    expect(validateImage({ alt: '' })).toEqual({ values: { alt: null } })
    expect(validateImage({ optionValueId: 'red' }).errors.optionValueId).toBeDefined()
    expect(validateImage({ optionValueId: 1.5 }).errors.optionValueId).toBeDefined()
    expect(validateImage({}).errors.alt).toBeDefined()
  })
})

describe('option types and swatches (mapping)', () => {
  it('reads type and swatch when the API sends them, and nothing when it does not', () => {
    expect(adminOption(API_PRODUCT.options[0])).toEqual({
      id: 1,
      name: 'Color',
      type: 'color',
      position: 0,
      values: [
        { id: 11, value: 'Red', swatch: '#C0392B', position: 0 },
        { id: 12, value: 'Blue', swatch: '#1E40AF', position: 1 },
      ],
    })
    expect(adminOption({ id: 3, name: 'Fit', type: 'odd', values: [{ id: 31, value: 'Slim', swatch: 'nope' }] })).toMatchObject({ type: 'text', values: [{ swatch: null }] })
    expect(adminOption({ id: 3, name: 'Fit', values: [{ id: 31, value: 'Slim' }] })).toEqual({ id: 3, name: 'Fit', position: 0, values: [{ id: 31, value: 'Slim', position: 0 }] })
  })

  it('reads an image’s optionValueId (null = every choice), only when sent', () => {
    expect(adminImage(API_PRODUCT.images[0])).toMatchObject({ id: 7, optionValueId: 12 })
    expect(adminImage(API_PRODUCT.images[1])).toMatchObject({ id: 8, optionValueId: null })
    expect(adminImage({ id: 9, url: 'c.jpg', option_value_id: 'x' }).optionValueId).toBeNull()
    expect(adminImage({ id: 9, url: 'c.jpg' })).not.toHaveProperty('optionValueId')
  })

  it('writes type and values as { value, swatch } only when a type was given', () => {
    expect(toOptionLookBody({ name: 'Size', values: ['S'] })).toEqual({ name: 'Size', values: ['S'] })
    expect(toOptionLookBody({ name: 'Color', type: 'color', values: ['Red'], swatches: ['#C0392B'], nameBn: 'রং', valuesBn: ['লাল'] })).toEqual({
      name: 'Color',
      type: 'color',
      values: [{ value: 'Red', swatch: '#C0392B' }],
      name_bn: 'রং',
      values_bn: ['লাল'],
    })
  })
})

describe('the routes', () => {
  it('PUT products/:id/options sends type and swatches and returns them', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/products/4/options': { body: { data: API_PRODUCT } } })
    const response = await admin('products/4/options', {
      method: 'PUT',
      body: {
        options: [
          { name: 'Color', type: 'color', values: [{ value: 'Red', swatch: '#c0392b' }, { value: 'Blue', swatch: '#1e40af' }], nameBn: 'রং', valuesBn: ['লাল', 'নীল'] },
          { name: 'Size', type: 'text', values: [{ value: 'M', swatch: null }] },
        ],
      },
    })
    expect(response.status).toBe(200)
    expect(sent(toApi(calls)[0])).toEqual({
      options: [
        { name: 'Color', type: 'color', values: [{ value: 'Red', swatch: '#C0392B' }, { value: 'Blue', swatch: '#1E40AF' }], name_bn: 'রং', values_bn: ['লাল', 'নীল'] },
        { name: 'Size', type: 'text', values: [{ value: 'M', swatch: null }] },
      ],
    })
    const body = await response.json()
    expect(body.options[0]).toMatchObject({ type: 'color', values: [{ id: 11, swatch: '#C0392B' }, { id: 12, swatch: '#1E40AF' }] })
    expect(body.imageList.map((image) => image.optionValueId)).toEqual([12, null])
  })

  it('refuses a colour without a swatch before any call, and passes the API’s 422 paths through', async () => {
    const calls = fakeLaravel({
      'PUT /api/admin/v1/products/4/options': { status: 422, body: { message: 'Invalid.', errors: { 'options.0.values.1.swatch': ['Bad colour.'], 'options.0.type': ['Bad type.'] } } },
    })
    const refused = await admin('products/4/options', { method: 'PUT', body: { options: [{ name: 'Color', type: 'color', values: [{ value: 'Red', swatch: '' }] }] } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors['options.0.values.0.swatch']).toBeDefined()
    expect(toApi(calls)).toEqual([])
    const api = await admin('products/4/options', { method: 'PUT', body: { options: [{ name: 'Color', type: 'color', values: [{ value: 'Red', swatch: '#C0392B' }, { value: 'Blue', swatch: '#1E40AF' }] }] } })
    expect(api.status).toBe(422)
    expect(Object.keys((await api.json()).errors).sort()).toEqual(['options.0.type', 'options.0.values.1.swatch'])
  })

  it('PATCH products/:id/images/:imageId sends option_value_id alone, and maps the API’s refusal to optionValueId', async () => {
    const calls = fakeLaravel({ 'PATCH /api/admin/v1/products/4/images/7': { body: { data: API_PRODUCT.images } } })
    const response = await admin('products/4/images/7', { method: 'PATCH', body: { optionValueId: 12 } })
    expect(response.status).toBe(200)
    expect(sent(toApi(calls).at(-1))).toEqual({ option_value_id: 12 })
    expect((await response.json()).images[0]).toMatchObject({ id: 7, optionValueId: 12 })
    await admin('products/4/images/7', { method: 'PATCH', body: { optionValueId: null } })
    expect(sent(toApi(calls).at(-1))).toEqual({ option_value_id: null })
    expect((await admin('products/4/images/7', { method: 'PATCH', body: { optionValueId: 'blue' } })).status).toBe(422)

    fakeLaravel({ 'PATCH /api/admin/v1/products/4/images/7': { status: 422, body: { message: 'Invalid.', errors: { option_value_id: ['That value is not one of this product’s.'] } } } })
    const refused = await admin('products/4/images/7', { method: 'PATCH', body: { optionValueId: 99 } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ optionValueId: ['That value is not one of this product’s.'] })
  })
})
