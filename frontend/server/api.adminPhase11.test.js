// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 11 admin routes (adminPhase11Api.js, shop/adminPhase11.js) and the
 * phase 11 fields on products, orders, refunds, customers, and settings.
 * Laravel is faked; shapes from "Implementation notes — backend" in
 * docs/backend/PHASE11_CONTRACT.md.
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: ['customers.view', 'rewards.manage', 'reports.view', 'settings.edit', 'products.edit'] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, headers: init.headers ?? {}, body: init.body }
    calls.push(entry)
    const key = `${entry.method} ${pathname}`
    const found = key === 'GET /api/admin/v1/me' ? { body: { data: ME } } : routes[key]
    const route = typeof found === 'function' ? found(entry) : (found ?? { status: 404, body: { message: 'Not found' } })
    return new Response(route.status === 204 ? null : JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
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

describe("a customer's wishlist", () => {
  it('lists every row with the product, variant, note, and whether the list is shared', async () => {
    fakeLaravel({
      'GET /api/admin/v1/customers/5/wishlist': {
        body: {
          data: [
            { id: 3, product: { id: 9, name: 'Mascara', sku: 'BEA-1', thumbnail_url: 'https://cdn.example/m.webp', status: 'active', deleted: false }, variant: { id: 2, label: 'Black' }, note: 'For Eid', added_at: '2026-11-18T10:00:00Z' },
            { id: 4, product: { id: 10, name: 'Old lamp', sku: null, thumbnail_url: 'javascript:alert(1)', status: 'archived', deleted: true }, variant: null, note: null, added_at: '2026-11-17T10:00:00Z' },
          ],
          meta: { shared: true, shared_at: '2026-11-18T11:00:00Z' },
        },
      },
    })
    expect(await (await admin('customers/5/wishlist')).json()).toEqual({
      items: [
        { id: 3, product: { id: 9, name: 'Mascara', sku: 'BEA-1', image: 'https://cdn.example/m.webp', status: 'active', deleted: false }, variant: { id: 2, label: 'Black' }, note: 'For Eid', addedAt: '2026-11-18T10:00:00Z' },
        { id: 4, product: { id: 10, name: 'Old lamp', sku: null, image: null, status: 'archived', deleted: true }, variant: null, note: null, addedAt: '2026-11-17T10:00:00Z' },
      ],
      shared: true,
      sharedAt: '2026-11-18T11:00:00Z',
      live: true,
    })
  })

  it('refuses malformed addresses before any call, and needs the BuyNest backend', async () => {
    const calls = fakeLaravel({})
    expect((await admin('customers/x/wishlist')).status).toBe(404)
    expect((await admin('customers/5/wishlist/3')).status).toBe(404)
    expect((await admin('customers/5/rewards/adjust/1', { method: 'POST', body: {} })).status).toBe(404)
    expect(toApi(calls)).toEqual([])
    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    expect((await admin('customers/5/wishlist')).status).toBe(404)
  })
})

const TX = { id: 7, points: -200, balance_after: 300, type: 'spend', order_number: 'BN-100004', credit_memo_number: null, admin_name: null, note: null, created_at: '2026-11-18T10:00:00Z' }

describe("a customer's reward points", () => {
  it('pages the history and maps each change', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/customers/5/rewards': {
        body: { data: { enabled: true, balance: 300, value: '3.00', point_value: '0.0100', transactions: [TX, { ...TX, id: 8, points: 50, type: 'adjust', order_number: null, admin_name: 'Store Owner', note: 'Goodwill' }] }, meta: { total: 42 } },
      },
    })
    const answer = await (await admin('customers/5/rewards?limit=20&skip=20')).json()
    expect(toApi(calls).at(-1).search).toBe('?page=2&per_page=20')
    expect(answer).toEqual({
      enabled: true,
      balance: 300,
      value: 3,
      pointValue: 0.01,
      transactions: [
        { id: 7, points: -200, balanceAfter: 300, type: 'spend', orderNumber: 'BN-100004', creditMemoNumber: null, reviewId: null, adminName: null, note: null, createdAt: '2026-11-18T10:00:00Z' },
        { id: 8, points: 50, balanceAfter: 300, type: 'adjust', orderNumber: null, creditMemoNumber: null, reviewId: null, adminName: 'Store Owner', note: 'Goodwill', createdAt: '2026-11-18T10:00:00Z' },
      ],
      total: 42,
      limit: 20,
      skip: 20,
      live: true,
    })
  })

  it('adjusts with signed points and a reason, checked here first', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/customers/5/rewards/adjust': { body: { data: { balance: 800, value: '8.00', transaction: { ...TX, points: 500, balance_after: 800, type: 'adjust', note: 'Late parcel' } } } },
    })
    const done = await admin('customers/5/rewards/adjust', { method: 'POST', body: { points: 500, note: ' Late parcel ' } })
    expect(done.status).toBe(200)
    expect(await done.json()).toMatchObject({ balance: 800, value: 8, transaction: { points: 500, type: 'adjust' } })
    expect(sent(toApi(calls).at(-1))).toEqual({ points: 500, note: 'Late parcel' })
    const bad = await admin('customers/5/rewards/adjust', { method: 'POST', body: { points: 1.5, note: '' } })
    expect(bad.status).toBe(422)
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(['note', 'points'])
    expect((await admin('customers/5/rewards/adjust', { method: 'POST', body: { points: 0, note: 'x' } })).status).toBe(422)
  })

  it("passes the API's refusals on: below 0, and a role without rewards.manage", async () => {
    fakeLaravel({ 'POST /api/admin/v1/customers/5/rewards/adjust': { status: 422, body: { message: 'Invalid.', errors: { points: ["The balance can't go below 0 (it is 300 points)."] } } } })
    expect((await (await admin('customers/5/rewards/adjust', { method: 'POST', body: { points: -400, note: 'Fix' } })).json()).errors).toEqual({ points: ["The balance can't go below 0 (it is 300 points)."] })
    fakeLaravel({ 'POST /api/admin/v1/customers/5/rewards/adjust': { status: 403, body: { message: 'No.', code: 'permission_denied', permission: 'rewards.manage' } } })
    const refused = await admin('customers/5/rewards/adjust', { method: 'POST', body: { points: 5, note: 'Fix' } })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ message: 'No.', code: 'permission_denied', permission: 'rewards.manage' })
  })
})

describe('reports', () => {
  it('most wished-for products, with the date range', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/wishlist': { body: { data: [{ product_id: 9, name: 'Mascara', sku: 'BEA-1', thumbnail_url: 'x', customers: 12, in_stock: false, availability: 'out_of_stock' }], meta: {} } },
    })
    const report = await (await admin('reports/wishlist?from=2026-11-01&to=2026-11-18&limit=10&evil=1')).json()
    expect(toApi(calls).at(-1).search).toBe('?from=2026-11-01&to=2026-11-18&limit=10')
    expect(report).toEqual({ products: [{ productId: 9, name: 'Mascara', sku: 'BEA-1', customers: 12, inStock: false }], live: true })
  })

  it('reward points issued and spent by period, and the outstanding liability', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/reports/rewards': {
        body: {
          data: { totals: { issued: 1200, spent: 500, returned: 100, reversed: 20, adjusted: -30 }, series: [{ period: '2026-11-17', issued: 1200, spent: 500 }], outstanding_points: 9000, outstanding_value: '90.00', point_value: '0.0100' },
        },
      },
    })
    const report = await (await admin('reports/rewards?from=2026-11-01&to=2026-11-18&groupBy=week')).json()
    expect(toApi(calls).at(-1).search).toBe('?from=2026-11-01&to=2026-11-18&group_by=week')
    expect(report).toEqual({
      totals: { issued: 1200, spent: 500, returned: 100, reversed: 20, adjusted: -30 },
      series: [{ period: '2026-11-17', issued: 1200, spent: 500 }],
      outstandingPoints: 9000,
      outstandingValue: 90,
      pointValue: 0.01,
      live: true,
    })
    expect((await admin('reports/rewards/x')).status).toBe(404)
  })
})

const BDT = { id: 1, code: 'BDT', symbol: '৳', rate: '110.50000000', decimals: 2, enabled: true, position: 1, updated_at: '2026-09-01T00:00:00Z', stale: true }

describe('display currencies', () => {
  it('lists them with the base currency and whether each rate is stale', async () => {
    fakeLaravel({ 'GET /api/admin/v1/currencies': { body: { data: [BDT], meta: { base: 'USD' } } } })
    expect(await (await admin('currencies')).json()).toEqual({
      base: 'USD',
      currencies: [{ id: 1, code: 'BDT', symbol: '৳', rate: 110.5, decimals: 2, enabled: true, position: 1, updatedAt: '2026-09-01T00:00:00Z', stale: true }],
      live: true,
    })
  })

  it('adds one (code upper-cased, rate as a plain decimal string), edits, and reorders', async () => {
    const calls = fakeLaravel({
      'POST /api/admin/v1/currencies': { status: 201, body: { data: { ...BDT, id: 3, code: 'INR', symbol: '₹', rate: '0.00000010', enabled: false, stale: false } } },
      'PATCH /api/admin/v1/currencies/1': { body: { data: { ...BDT, rate: '111.00000000', stale: false } } },
      'POST /api/admin/v1/currencies/reorder': { body: { data: [{ ...BDT, id: 2, code: 'EUR' }, BDT] } },
    })
    const created = await admin('currencies', { method: 'POST', body: { code: ' inr ', symbol: '₹', rate: 0.0000001, decimals: 2, enabled: false } })
    expect(created.status).toBe(201)
    expect((await created.json()).currency).toMatchObject({ id: 3, code: 'INR', rate: 0.0000001 })
    expect(sent(toApi(calls).at(-1))).toEqual({ code: 'INR', symbol: '₹', rate: '0.0000001', decimals: 2, enabled: false })

    expect((await (await admin('currencies/1', { method: 'PATCH', body: { rate: 111 } })).json()).currency).toMatchObject({ rate: 111, stale: false })
    expect(sent(toApi(calls).at(-1))).toEqual({ rate: '111' })

    const reordered = await (await admin('currencies/reorder', { method: 'POST', body: { ids: [2, 1] } })).json()
    expect(reordered.currencies.map((currency) => currency.code)).toEqual(['EUR', 'BDT'])
    expect(reordered.base).toBe('USD')
    expect(sent(toApi(calls).at(-1))).toEqual({ ids: [2, 1] })
  })

  it('checks the fields here first, and passes the API errors on', async () => {
    fakeLaravel({ 'PATCH /api/admin/v1/currencies/1': { status: 422, body: { message: 'Invalid.', errors: { rate: ['Enter a rate before turning this currency on.'] } } } })
    const bad = await admin('currencies', { method: 'POST', body: { code: 'TAKA', symbol: '', rate: -1, decimals: 4, enabled: 'yes' } })
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(['code', 'decimals', 'enabled', 'rate', 'symbol'])
    expect((await (await admin('currencies/1', { method: 'PATCH', body: { code: 'EUR' } })).json()).errors).toHaveProperty('code')
    expect((await admin('currencies/reorder', { method: 'POST', body: { ids: [1, 1] } })).status).toBe(422)
    expect((await (await admin('currencies/1', { method: 'PATCH', body: { enabled: true } })).json()).errors).toEqual({ rate: ['Enter a rate before turning this currency on.'] })
    expect((await admin('currencies/abc', { method: 'PATCH', body: {} })).status).toBe(404)
  })
})

const PRODUCT = {
  id: 3, name: 'Tee', status: 'active', price: '20.00', stock_quantity: 5,
  specifications: [{ label: 'Material', value: 'Cotton' }],
  links: { related: [{ id: 4, name: 'Socks', sku: 'SOX', image: 'https://cdn.example/s.webp', status: 'active' }], upsell: [], crosssell: [{ id: 5, name: 'Cap', sku: null, image: null, status: 'draft' }] },
}

describe('products: specifications and links', () => {
  it('maps both, and sends only what changed (ids per type, trimmed rows)', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/products/3': { body: { data: PRODUCT } },
      'PATCH /api/admin/v1/products/3': { body: { data: PRODUCT } },
    })
    expect(await (await admin('products/3')).json()).toMatchObject({
      specifications: [{ label: 'Material', value: 'Cotton' }],
      links: { related: [{ id: 4, name: 'Socks', sku: 'SOX', image: 'https://cdn.example/s.webp', status: 'active' }], upsell: [], crosssell: [{ id: 5, name: 'Cap', sku: null, image: null, status: 'draft' }] },
    })
    await admin('products/3', { method: 'PUT', body: { specifications: [{ label: ' Fit ', value: ' Regular ' }], links: { upsell: [7, 8] } } })
    expect(sent(toApi(calls).at(-1))).toEqual({ specifications: [{ label: 'Fit', value: 'Regular' }], links: { upsell: [7, 8] } })
  })

  it('refuses bad rows and lists here, and passes the API field errors on', async () => {
    fakeLaravel({ 'PATCH /api/admin/v1/products/3': { status: 422, body: { message: 'Invalid.', errors: { 'links.related.0': ["A product can't be linked to itself."], 'specifications.1.label': ['This label is used twice.'] } } } })
    const twice = await admin('products/3', { method: 'PUT', body: { specifications: [{ label: 'Size', value: 'M' }, { label: 'size', value: 'L' }] } })
    expect((await twice.json()).errors).toEqual({ specifications: ['Each label once: "size" is there twice.'] })
    const tooMany = await admin('products/3', { method: 'PUT', body: { links: { related: Array.from({ length: 21 }, (_, index) => index + 10) } } })
    expect((await tooMany.json()).errors).toEqual({ links: ['Link up to 20 products of each kind.'] })
    expect((await (await admin('products/3', { method: 'PUT', body: { links: { similar: [1] } } })).json()).errors).toHaveProperty('links')
    const refused = await admin('products/3', { method: 'PUT', body: { links: { related: [3] } } })
    expect((await refused.json()).errors).toEqual({ 'links.related.0': ["A product can't be linked to itself."], 'specifications.1.label': ['This label is used twice.'] })
  })
})

describe('duplicate a product', () => {
  it('posts to the API and answers where the draft copy is', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/products/3/duplicate': { status: 201, body: { data: { id: 44, name: 'Tee (copy)', sku: 'TEE-COPY', status: 'draft' } } } })
    const response = await admin('products/3/duplicate', { method: 'POST', body: {} })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ product: { id: 44, name: 'Tee (copy)', sku: 'TEE-COPY', status: 'draft' }, live: true })
    expect(toApi(calls).map((entry) => `${entry.method} ${entry.path}`)).toEqual(['POST /api/admin/v1/products/3/duplicate'])
  })

  it('refuses a malformed address before any call, and passes a refusal on', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/products/9/duplicate': { status: 403, body: { message: 'Not allowed.', code: 'permission_denied', permission: 'products.edit' } } })
    expect((await admin('products/abc/duplicate', { method: 'POST', body: {} })).status).toBe(404)
    expect(toApi(calls)).toEqual([])
    const refused = await admin('products/9/duplicate', { method: 'POST', body: {} })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ code: 'permission_denied', permission: 'products.edit' })
  })
})

const ORDER = {
  number: 'BN-100001', status: 'processing', payment_status: 'paid', payment_method: 'card', email: 'x@example.com', items: [],
  totals: { item_count: 1, subtotal: '50.00', discount: '0.00', shipping: '0.00', tax: '0.00', total: '50.00', reward_points: '5.00', gift_card: '0.00', amount_due: '45.00' },
  reward_points: { spent: 500, amount: '5.00', earned: 45 },
  history: [],
}

describe('orders, refunds, credit memos, and the customer grid', () => {
  it('shows points spent and earned on the order (null when there are none)', async () => {
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: ORDER } } })
    expect((await (await admin('orders/BN-100001')).json()).rewardPoints).toEqual({ spent: 500, amount: 5, earned: 45 })
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100001': { body: { data: { ...ORDER, reward_points: null } } } })
    expect((await (await admin('orders/BN-100001')).json()).rewardPoints).toBeNull()
  })

  it('adds what can go back as points, and the credit memo split', async () => {
    fakeLaravel({
      'GET /api/admin/v1/orders/BN-100001/refundable': { body: { data: { items: [], shipping_refundable: '0.00', max_total: '50.00', reward_points_refundable: '5.00', reward_points: { spent: 500, earned: 45, reversed: 0 } } } },
      'GET /api/admin/v1/credit-memos/CM-100001': {
        body: { data: { number: 'CM-100001', total: '20.00', gift_card_refund: '0.00', other_refund: '15.00', reward_points_refund: '5.00', reward_points_returned: 500, reward_points_reversed: 18, items: [] } },
      },
    })
    expect(await (await admin('orders/BN-100001/refundable')).json()).toMatchObject({ maxTotal: 50, rewardPointsRefundable: 5, rewardPoints: { spent: 500, earned: 45, reversed: 0 } })
    expect(await (await admin('credit-memos/CM-100001')).json()).toMatchObject({ total: 20, otherRefund: 15, rewardPointsRefund: 5, rewardPointsReturned: 500, rewardPointsReversed: 18 })
  })

  it("carries each customer's points balance in the grid", async () => {
    fakeLaravel({ 'GET /api/admin/v1/customers': { body: { data: [{ id: 5, first_name: 'Ava', last_name: 'Khan', email: 'ava@example.com', reward_points: 1200 }], meta: { total: 1 } } } })
    expect((await (await admin('customers')).json()).customers[0]).toMatchObject({ id: 5, rewardPoints: 1200 })
  })
})

describe('Settings → Reward points', () => {
  it('reads the decimals as numbers and sends them back as the API writes them', async () => {
    const SETTINGS = { rewards: { enabled: false, earn_rate: '1.00', point_value: '0.0100', min_redeem: 100, max_percent: 50, signup_bonus: 0, review_bonus: 0 } }
    const calls = fakeLaravel({ 'GET /api/admin/v1/settings': { body: { data: SETTINGS } }, 'PATCH /api/admin/v1/settings': { body: { data: SETTINGS } } })
    expect((await (await admin('settings')).json()).rewards).toEqual({ enabled: false, earnRate: 1, pointValue: 0.01, minRedeem: 100, maxPercent: 50, signupBonus: 0, reviewBonus: 0 })
    await admin('settings', { method: 'PATCH', body: { rewards: { enabled: true, earnRate: 1.5, pointValue: 0.005, minRedeem: 0, maxPercent: 100, signupBonus: 50, reviewBonus: 10 } } })
    expect(sent(toApi(calls).at(-1))).toEqual({ rewards: { enabled: true, earn_rate: '1.50', point_value: '0.0050', min_redeem: 0, max_percent: 100, signup_bonus: 50, review_bonus: 10 } })
    const bad = await admin('settings', { method: 'PATCH', body: { rewards: { earnRate: -1, pointValue: 0, maxPercent: 0, minRedeem: 1.5 } } })
    expect(Object.keys((await bad.json()).errors).sort()).toEqual(['rewards.earnRate', 'rewards.maxPercent', 'rewards.minRedeem', 'rewards.pointValue'])
  })
})
