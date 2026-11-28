// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 5 admin routes (adminCatalogApi.js, shop/adminCatalog.js):
 * categories, images, options and variants, mass actions, CSV export and
 * import, reviews. Laravel is faked; each call is recorded with its raw body.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Admin', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['products.view'] }

/** Fakes Laravel: "METHOD /path" → { status, body, headers? } or a function (call) → that. */
function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    if (typeof route.body === 'string') return new Response(route.body, { status: route.status ?? 200, headers: route.headers })
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

function admin(action, { method = 'GET', body, headers = {}, raw } = {}) {
  return handleApiRequest(
    new Request(`${SITE}/api/admin/${action}`, {
      method,
      headers: { 'Sec-Fetch-Site': 'same-origin', Cookie: 'buynest_admin_at=9|ADMIN', ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      ...(raw instanceof ReadableStream && { duplex: 'half' }),
    }),
  )
}
const sent = (entry) => JSON.parse(entry.body)
const toApi = (calls) => calls.filter((entry) => entry.path !== '/api/admin/v1/me')

const BOUNDARY = '----BuyNestTest7f3a'
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`
const multipartBody = (field, name, type, content) =>
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n${content}\r\n--${BOUNDARY}--\r\n`

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('categories (tree)', () => {
  const TREE = [
    {
      id: 1, name: 'Beauty', slug: 'beauty', parent_id: null, position: 0, is_active: true, image_url: null, description: null, meta_title: null, meta_description: null, product_count: 5,
      children: [{ id: 3, name: 'Lipstick', slug: 'lipstick', parent_id: 1, position: 0, is_active: false, product_count: 2, children: [] }],
    },
    { id: 2, name: 'Laptops', slug: 'laptops', parent_id: null, position: 1, is_active: true, product_count: 0, children: [] },
  ]

  it('lists the tree flat, in tree order, with depth (the product filter keeps reading slug and name)', async () => {
    fakeLaravel({ 'GET /api/admin/v1/categories': { body: { data: TREE } } })
    const list = await (await admin('categories')).json()
    expect(list.map((category) => [category.slug, category.depth, category.parentId, category.childCount])).toEqual([['beauty', 0, null, 1], ['lipstick', 1, 1, 0], ['laptops', 0, null, 0]])
    expect(list[1]).toMatchObject({ id: 3, name: 'Lipstick', isActive: false, productCount: 2, metaTitle: '', imageUrl: null })
    expect(list[0]).not.toHaveProperty('children')
  })

  it('builds the order from parent_id when the API answers a flat list', async () => {
    fakeLaravel({ 'GET /api/admin/v1/categories': { body: { data: [{ id: 3, name: 'Lipstick', slug: 'lipstick', parent_id: 1 }, { id: 1, name: 'Beauty', slug: 'beauty', parent_id: null }] } } })
    expect((await (await admin('categories')).json()).map((category) => [category.slug, category.depth])).toEqual([['beauty', 0], ['lipstick', 1]])
  })

  it('creates and edits with checked, allow-listed fields in API names', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/categories': { status: 201, body: { data: { id: 9, name: 'Serums', slug: 'serums', parent_id: 1, is_active: true } } },
      'PATCH /api/admin/v1/categories/9': { status: 422, body: { message: 'Too deep.', errors: { parent_id: ['Categories go at most 3 levels deep.'] } } },
    })
    expect((await admin('categories', { method: 'POST', body: { name: 'Serums', slug: 'Serums!' } })).status).toBe(422)
    const created = await admin('categories', { method: 'POST', body: { name: ' Serums ', slug: 'serums', parentId: 1, description: '', productCount: 7, isActive: true } })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ category: { id: 9, slug: 'serums', parentId: 1 }, live: true })
    expect(sent(toApi(calls).at(-1))).toEqual({ name: 'Serums', slug: 'serums', parent_id: 1, description: null, is_active: true })

    const refused = await admin('categories/9', { method: 'PATCH', body: { parentId: 3 } })
    expect(await refused.json()).toEqual({ message: 'Too deep.', errors: { parentId: ['Categories go at most 3 levels deep.'] } })
    expect((await admin('categories/9', { method: 'PATCH', body: { parentId: 9 } })).status).toBe(422)
    expect((await admin('categories/9', { method: 'PATCH', body: {} })).status).toBe(422)
  })

  it("passes the API's delete refusal (children or products) through with its message", async () => {
    fakeLaravel({ 'DELETE /api/admin/v1/categories/1': { status: 422, body: { message: 'This category has 1 subcategory and 5 products. Move them first.' } }, 'DELETE /api/admin/v1/categories/2': { status: 204 } })
    const refused = await admin('categories/1', { method: 'DELETE' })
    expect([refused.status, (await refused.json()).message]).toEqual([422, 'This category has 1 subcategory and 5 products. Move them first.'])
    expect(await (await admin('categories/2', { method: 'DELETE' })).json()).toEqual({ id: 2, deleted: true, live: true })
  })

  it('reorders siblings', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/categories/reorder': { body: { data: [TREE[1], TREE[0]] } } })
    expect((await admin('categories/reorder', { method: 'POST', body: { parentId: null, ids: [2, 2] } })).status).toBe(422)
    const reordered = await (await admin('categories/reorder', { method: 'POST', body: { parentId: null, ids: [2, 1] } })).json()
    expect(reordered.categories.map((category) => category.slug)).toEqual(['laptops', 'beauty', 'lipstick'])
    expect(sent(toApi(calls).at(-1))).toEqual({ parent_id: null, ids: [2, 1] })
  })
})

describe('product images (multipart passthrough)', () => {
  const IMAGES = [
    { id: 8, url: 'https://cdn.example/b.png', alt: '', position: 1, is_upload: false },
    { id: 7, url: '/media/products/4/' + 'a'.repeat(32) + '.jpg', alt: 'Front', position: 0, is_upload: true },
  ]

  it('forwards the upload unchanged, with its Content-Type and boundary', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/products/4/images': { status: 201, body: { data: IMAGES } } })
    const body = multipartBody('images[]', 'front.jpg', 'image/jpeg', 'JPEGDATA')
    const response = await admin('products/4/images', { method: 'POST', headers: { 'Content-Type': MULTIPART }, raw: body })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ images: [{ id: 7, url: IMAGES[1].url, alt: 'Front', position: 0, isUpload: true }, { id: 8, url: IMAGES[0].url, alt: '', position: 1, isUpload: false }], live: true })
    const upload = toApi(calls)[0]
    expect(upload.headers['Content-Type']).toBe(MULTIPART)
    expect(upload.headers.Authorization).toBe('Bearer 9|ADMIN')
    expect(new TextDecoder().decode(upload.body)).toBe(body)
  })

  it('refuses a body that is not multipart, or too large, before calling the API', async () => {
    const calls = fakeLaravel({})
    expect((await admin('products/4/images', { method: 'POST', body: { images: ['x'] } })).status).toBe(422)
    const declared = await admin('products/4/images', { method: 'POST', headers: { 'Content-Type': MULTIPART, 'Content-Length': String(61 * 1024 * 1024) }, raw: 'x' })
    expect(declared.status).toBe(413)
    // No Content-Length (streamed): reading stops at the cap.
    let pulled = 0
    const chunk = new Uint8Array(1024 * 1024)
    const stream = new ReadableStream({
      pull(controller) {
        pulled += 1
        if (pulled > 100) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const streamed = await admin('products/4/images', { method: 'POST', headers: { 'Content-Type': MULTIPART }, raw: stream })
    expect(streamed.status).toBe(413)
    expect(pulled).toBeLessThan(70)
    expect(toApi(calls)).toEqual([])
  })

  it('edits alt text, deletes, and reorders', async () => {
    const calls = fakeLaravel({
      'PATCH /api/admin/v1/products/4/images/7': { body: { data: [{ id: 7, url: 'u', alt: 'Front view', position: 0, is_upload: true }] } },
      'DELETE /api/admin/v1/products/4/images/7': { body: { data: [IMAGES[0]] } },
      'POST /api/admin/v1/products/4/images/reorder': { body: { data: IMAGES } },
    })
    expect(await (await admin('products/4/images/7', { method: 'PATCH', body: { alt: ' Front view ', url: 'x' } })).json()).toEqual({ images: [{ id: 7, url: 'u', alt: 'Front view', position: 0, isUpload: true }], live: true })
    expect(sent(toApi(calls).at(-1))).toEqual({ alt: 'Front view' })
    await admin('products/4/images/7', { method: 'PATCH', body: { alt: '' } })
    expect(sent(toApi(calls).at(-1))).toEqual({ alt: null })
    expect((await admin('products/4/images/7', { method: 'PATCH', body: { alt: 'x'.repeat(191) } })).status).toBe(422)
    const deleted = await admin('products/4/images/7', { method: 'DELETE' })
    expect((await deleted.json()).images.map((image) => image.id)).toEqual([8])
    expect((await (await admin('products/4/images/reorder', { method: 'POST', body: { ids: [8, 7] } })).json()).images.map((image) => image.id)).toEqual([7, 8])
    expect(sent(toApi(calls).at(-1))).toEqual({ ids: [8, 7] })
  })

  it('only matches well-formed product part addresses', async () => {
    const calls = fakeLaravel({})
    for (const path of ['products/abc/images', 'products/4/pictures', 'products/4/images/abc', 'products/4/images/7/8', 'products/4/variants/reorder', 'products/4/options/1']) {
      expect((await admin(path, { method: 'POST', body: {} })).status).toBe(404)
    }
    expect(toApi(calls)).toEqual([])
  })
})

describe('options and variants', () => {
  const PRODUCT = {
    id: 4,
    images: [],
    options: [{ id: 1, name: 'Size', position: 0, values: [{ id: 11, value: 'S', position: 0 }, { id: 12, value: 'M', position: 1 }] }],
    variants: [{ id: 21, sku: 'BEA-1-S', option_value_ids: [11], label: 'Size: S', price: null, effective_price: '9.99', final_price: '9.99', stock_quantity: 0, is_active: false, is_current: true }],
  }

  it('replaces the options after checking them', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/products/4/options': { body: { data: PRODUCT } } })
    const tooMany = await admin('products/4/options', { method: 'PUT', body: { options: [1, 2, 3, 4].map((n) => ({ name: `O${n}`, values: ['a'] })) } })
    expect(tooMany.status).toBe(422)
    const duplicates = await (await admin('products/4/options', { method: 'PUT', body: { options: [{ name: 'Size', values: ['S', 's'] }, { name: 'size', values: [] }] } })).json()
    expect(Object.keys(duplicates.errors).sort()).toEqual(['options.0.values', 'options.1.name', 'options.1.values'])

    const saved = await (await admin('products/4/options', { method: 'PUT', body: { options: [{ name: ' Size ', values: ['S ', 'M'], id: 3 }] } })).json()
    expect(sent(toApi(calls).at(-1))).toEqual({ options: [{ name: 'Size', values: ['S', 'M'] }] })
    expect(saved).toMatchObject({ options: [{ id: 1, name: 'Size', values: [{ id: 11, value: 'S' }, { id: 12, value: 'M' }] }], variants: [{ id: 21, sku: 'BEA-1-S', optionValueIds: [11], label: 'Size: S', price: null, effectivePrice: 9.99, finalPrice: 9.99, stock: 0, isActive: false, isCurrent: true }], hasVariants: true })
  })

  it('generates combinations and edits a variant (price as a 2-decimal string, null = the product price)', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/products/4/variants/generate': { status: 201, body: { data: PRODUCT, meta: { created: 1 } } },
      'PATCH /api/admin/v1/products/4/variants/21': { body: { data: { ...PRODUCT, variants: [{ ...PRODUCT.variants[0], price: '12.50', is_active: true }] } } },
    })
    expect(await (await admin('products/4/variants/generate', { method: 'POST', body: {} })).json()).toMatchObject({ created: 1, variants: [{ id: 21 }] })
    const changed = await (await admin('products/4/variants/21', { method: 'PATCH', body: { price: 12.5, stock: 3, isActive: true, optionValueIds: [1] } })).json()
    expect(changed.variants[0]).toMatchObject({ price: 12.5, isActive: true })
    expect(sent(toApi(calls).at(-1))).toEqual({ price: '12.50', stock_quantity: 3, is_active: true })
    await admin('products/4/variants/21', { method: 'PATCH', body: { price: null } })
    expect(sent(toApi(calls).at(-1))).toEqual({ price: null })
    expect((await admin('products/4/variants/21', { method: 'PATCH', body: { price: 0, stock: -1, sku: 'a b' } })).status).toBe(422)
    expect((await admin('products/4/variants/21', { method: 'PATCH', body: { sku: 'TS_S.1' } })).status).toBe(422)
  })

  it('adds images with ids, options, and variants to the product detail', async () => {
    fakeLaravel({ 'GET /api/admin/v1/products/4': { body: { data: { ...PRODUCT, name: 'Mascara', price: '9.99', images: [{ id: 7, url: 'u', alt: 'Front', position: 0 }], has_variants: true } } } })
    const product = await (await admin('products/4')).json()
    expect(product).toMatchObject({ title: 'Mascara', images: ['u'], imageList: [{ id: 7, alt: 'Front' }], hasVariants: true, options: [{ name: 'Size' }] })
  })
})

describe('mass actions', () => {
  it('checks each action and its value, and answers the summary with skipped items', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/products/bulk': { body: { data: { updated: 2, skipped: [{ id: 3, reason: 'Has variants: set the stock per variant.' }] } } } })
    const bad = [
      { ids: [], action: 'enable' },
      { ids: Array.from({ length: 201 }, (_, index) => index + 1), action: 'enable' },
      { ids: [1, 1], action: 'enable' },
      { ids: [1], action: 'explode' },
      { ids: [1], action: 'set_category', value: 'beauty' },
      { ids: [1], action: 'set_stock', value: 1.5 },
      { ids: [1], action: 'adjust_price', value: { mode: 'percent', amount: -100 } },
      { ids: [1], action: 'adjust_price', value: { mode: 'fixed', amount: 0 } },
    ]
    for (const body of bad) expect((await admin('products/bulk', { method: 'POST', body })).status).toBe(422)
    expect(toApi(calls)).toEqual([])

    const result = await (await admin('products/bulk', { method: 'POST', body: { ids: [1, 2, 3], action: 'set_stock', value: 5, extra: 1 } })).json()
    expect(result).toEqual({ updated: 2, skipped: [{ id: 3, name: null, reason: 'Has variants: set the stock per variant.' }], live: true })
    expect(sent(toApi(calls).at(-1))).toEqual({ ids: [1, 2, 3], action: 'set_stock', value: 5 })
    await admin('products/bulk', { method: 'POST', body: { ids: [1], action: 'adjust_price', value: { mode: 'percent', amount: -10 } } })
    expect(sent(toApi(calls).at(-1))).toEqual({ ids: [1], action: 'adjust_price', value: { mode: 'percent', amount: '-10.00' } })
    await admin('products/bulk', { method: 'POST', body: { ids: [1], action: 'delete', value: 3 } })
    expect(sent(toApi(calls).at(-1))).toEqual({ ids: [1], action: 'delete' })
  })

  it('passes a 422 naming the products (price below 0.01) and a 403 through', async () => {
    fakeLaravel({
      'POST /api/admin/v1/products/bulk': ({ body }) =>
        JSON.parse(body).action === 'delete'
          ? { status: 403, body: { message: "Your role doesn't allow this.", code: 'permission_denied', permission: 'products.delete' } }
          : { status: 422, body: { message: 'These prices would go below 0.01: Mascara (#1).', errors: { value: ['These prices would go below 0.01: Mascara (#1).'] } } },
    })
    const low = await admin('products/bulk', { method: 'POST', body: { ids: [1], action: 'adjust_price', value: { mode: 'fixed', amount: -50 } } })
    expect(await low.json()).toMatchObject({ message: 'These prices would go below 0.01: Mascara (#1).' })
    const denied = await admin('products/bulk', { method: 'POST', body: { ids: [1], action: 'delete' } })
    expect([denied.status, (await denied.json()).permission]).toEqual([403, 'products.delete'])
  })
})

describe('CSV export and import', () => {
  it('exports with the list filters and passes the file through as a download', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/products/export.csv': {
        body: "sku,name\nBEA-1,'=HYPERLINK()\n",
        headers: { 'Content-Type': 'text/csv; charset=UTF-8', 'Content-Disposition': 'attachment; filename="products-2026-11-16.csv"' },
      },
    })
    const file = await admin('products/export.csv?q=mas&category=beauty&status=draft&evil=1&category2=x')
    expect(file.headers.get('content-type')).toBe('text/csv; charset=UTF-8')
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="products-2026-11-16.csv"')
    expect(await file.text()).toContain("'=HYPERLINK()")
    expect(Object.fromEntries(new URLSearchParams(toApi(calls)[0].search))).toEqual({ search: 'mas', category: 'beauty', status: 'draft' })
  })

  it('imports as a dry run unless told otherwise, and maps the report', async () => {
    const report = {
      dry_run: true, rows: 3, created: 1, updated: 1, unchanged: 0, errors: [{ row: 4, column: 'price', message: 'Enter a price.' }],
      warnings: [{ row: 2, column: 'related_skus', message: 'Unknown SKU "NOPE" skipped.' }],
    }
    const calls = fakeLaravel({ 'POST /api/admin/v1/products/import': { body: { data: report } } })
    const body = multipartBody('file', 'products.csv', 'text/csv', 'sku,name\nA,B\n')
    const dry = await (await admin('products/import', { method: 'POST', headers: { 'Content-Type': MULTIPART }, raw: body })).json()
    expect(dry).toEqual({
      dryRun: true, rows: 3, created: 1, updated: 1, unchanged: 0, errors: [{ row: 4, column: 'price', message: 'Enter a price.' }],
      warnings: [{ row: 2, column: 'related_skus', message: 'Unknown SKU "NOPE" skipped.' }], live: true,
    })
    expect(toApi(calls)[0].search).toBe('?dry_run=1')
    expect(new TextDecoder().decode(toApi(calls)[0].body)).toBe(body)
    await admin('products/import?dryRun=false', { method: 'POST', headers: { 'Content-Type': MULTIPART }, raw: body })
    expect(toApi(calls).at(-1).search).toBe('?dry_run=0')
  })

  it('refuses a CSV over the cap, and keeps a report sent with a 422', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/products/import': { status: 422, body: { message: 'Fix the rows.', data: { dry_run: false, rows: 1, errors: [{ row: 2, column: 'sku', message: 'Required.' }] } } } })
    const big = multipartBody('file', 'big.csv', 'text/csv', 'x'.repeat(2 * 1024 * 1024 + 70 * 1024))
    expect((await admin('products/import', { method: 'POST', headers: { 'Content-Type': MULTIPART }, raw: big })).status).toBe(413)
    expect(toApi(calls)).toEqual([])
    const refused = await (await admin('products/import?dryRun=false', { method: 'POST', headers: { 'Content-Type': MULTIPART }, raw: multipartBody('file', 'a.csv', 'text/csv', 'x') })).json()
    expect(refused).toMatchObject({ message: 'Fix the rows.', report: { dryRun: false, errors: [{ row: 2, column: 'sku' }] } })
  })
})

describe('reviews', () => {
  const REVIEW = { id: 5, product: { id: 4, name: 'Mascara', sku: 'BEA-1' }, customer: { id: 2, name: 'Ava Customer', email: 'ava@example.com' }, author_name: 'Ava', rating: 4, title: 'Nice', comment: 'Lasts all day.', status: 'pending', verified_purchase: true, created_at: 'T', email: 'secret' }

  it('lists with well-formed filters only', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/reviews': { body: { data: [REVIEW], meta: { total: 1, counts: { pending: 1, approved: '3' } } } } })
    const list = await (await admin('reviews?status=pending&productId=4&rating=4&q=day&evil=1&limit=10')).json()
    expect(list).toEqual({
      reviews: [{ id: 5, productId: 4, productName: 'Mascara', productSku: 'BEA-1', productThumbnail: null, authorName: 'Ava', authorEmail: 'ava@example.com', rating: 4, title: 'Nice', comment: 'Lasts all day.', status: 'pending', verifiedPurchase: true, createdAt: 'T', updatedAt: null, photos: [] }],
      total: 1,
      counts: { pending: 1, approved: 3, rejected: 0 },
      limit: 10,
      skip: 0,
      live: true,
    })
    expect(Object.fromEntries(new URLSearchParams(toApi(calls)[0].search))).toEqual({ page: '1', per_page: '10', status: 'pending', rating: '4', product_id: '4', search: 'day' })
    await admin('reviews?status=spam&rating=9&productId=x')
    expect(Object.fromEntries(new URLSearchParams(toApi(calls).at(-1).search))).toEqual({ page: '1', per_page: '20' })
  })

  it('moderates one or many, and deletes', async () => {
    const calls = fakeLaravel({
      'PATCH /api/admin/v1/reviews/5': { body: { data: { ...REVIEW, status: 'approved' } } },
      'POST /api/admin/v1/reviews/bulk': { body: { data: { updated: 2 } } },
      'DELETE /api/admin/v1/reviews/5': { status: 204 },
    })
    expect((await admin('reviews/5', { method: 'PATCH', body: { status: 'published' } })).status).toBe(422)
    expect((await (await admin('reviews/5', { method: 'PATCH', body: { status: 'approved', rating: 5 } })).json()).review.status).toBe('approved')
    expect(sent(toApi(calls).at(-1))).toEqual({ status: 'approved' })
    expect(await (await admin('reviews/bulk', { method: 'POST', body: { ids: [5, 6], status: 'rejected' } })).json()).toEqual({ updated: 2, skipped: [], live: true })
    expect((await admin('reviews/bulk', { method: 'POST', body: { ids: [], status: 'rejected' } })).status).toBe(422)
    expect(await (await admin('reviews/5', { method: 'DELETE' })).json()).toEqual({ id: 5, deleted: true, live: true })
  })
})

describe('settings and demo mode', () => {
  it('reads and saves the review approval setting (Catalog group)', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/settings': { body: { data: { catalog: { reviews_require_approval: true } } } },
      'PATCH /api/admin/v1/settings': { body: { data: { catalog: { reviews_require_approval: false } } } },
    })
    expect((await (await admin('settings')).json()).catalog).toEqual({ reviewsRequireApproval: true })
    expect((await admin('settings', { method: 'PATCH', body: { catalog: { reviewsRequireApproval: 'no' } } })).status).toBe(422)
    const saved = await (await admin('settings', { method: 'PATCH', body: { catalog: { reviewsRequireApproval: false } } })).json()
    expect(saved.catalog).toEqual({ reviewsRequireApproval: false })
    expect(sent(toApi(calls).at(-1))).toEqual({ catalog: { reviews_require_approval: false } })
  })

  it('answers 404 for every phase 5 route with the demo catalog, without calling anything', async () => {
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    const calls = fakeLaravel({})
    for (const [path, method] of [['categories', 'POST'], ['categories/1', 'PATCH'], ['categories/reorder', 'POST'], ['products/1/images', 'POST'], ['products/1/options', 'PUT'], ['products/1/variants/generate', 'POST'], ['products/bulk', 'POST'], ['products/export.csv', 'GET'], ['products/import', 'POST'], ['reviews', 'GET'], ['reviews/bulk', 'POST']]) {
      expect((await admin(path, { method, body: method === 'GET' ? undefined : {} })).status).toBe(404)
    }
    expect(toApi(calls)).toEqual([])
  })
})
