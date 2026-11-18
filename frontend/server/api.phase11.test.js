// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

/*
 * Phase 11 storefront services (docs/backend/PHASE11_CONTRACT.md): the
 * account's wishlist on the server (add, note, remove, merge, share), shared
 * wishlists, reward points (balance, cart pricing, orders), cart cross-sells,
 * and the catalog's compare list.
 */

const SITE = 'https://shop.example'

/** Fakes the Laravel API: "METHOD /path" → { status, body }. Records each call (path, search, init, parsed body). */
function fakeUpstream(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (input, init = {}) => {
    const url = new URL(input)
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ path: url.pathname, search: url.search, init, body })
    const route = routes[`${init.method ?? 'GET'} ${url.pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    const handled = typeof route === 'function' ? route(body) : route
    if (handled.status === 204) return new Response(null, { status: 204 })
    return new Response(JSON.stringify(handled.body), { status: handled.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}

const call = (path, { method = 'GET', body, cookie } = {}) =>
  handleApiRequest(
    new Request(`${SITE}/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-Real-IP': '203.0.113.7', ...(cookie && { Cookie: cookie }) },
      body: body && JSON.stringify(body),
    }),
  )
const SIGNED_IN = 'buynest_at=AT'

beforeEach(() => {
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  vi.stubEnv('BUYNEST_BFF_KEY', 'shared-key')
})
afterEach(() => vi.unstubAllEnvs())

// The API's product card, with a field the storefront must never see.
const CARD = {
  id: 7, name: 'Desk Lamp', slug: 'desk-lamp', sku: 'LAMP-1', brand: { id: 2, name: 'Lumo', slug: 'lumo', supplier_email: 'x@y.z' }, category: { id: 3, name: 'Home', slug: 'home' },
  price: '40.00', discount_percent: 10, sale_price: '36.00', price_rule: null, rating_average: '4.40', review_count: 12, stock_quantity: 8, availability: 'in_stock',
  min_order_quantity: 1, has_variants: false, thumbnail_url: 'https://cdn.example/lamp.webp', thumbnail_variants: { 320: 'https://cdn.example/lamp-320.webp', 9999: 'javascript:alert(1)' },
  tags: ['home'], weight: 900, type: 'simple', cost_price: '12.00',
}
const ITEM = { id: 31, product: CARD, variant: null, note: 'For the office', added_at: '2026-11-18T09:00:00Z' }

describe('the account wishlist (/api/shop/me/wishlist)', () => {
  it('needs a session', async () => {
    const calls = fakeUpstream({})
    expect((await call('shop/me/wishlist')).status).toBe(401)
    expect((await call('shop/wishlists/abc', {})).status).toBe(404) // not a token: never sent upstream
    expect(calls).toHaveLength(0)
  })

  it('lists the items with allow-listed product cards and whether the list is shared', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/me/wishlist': { body: { data: [ITEM], meta: { shared: true, shared_at: '2026-11-18T10:00:00Z', count: 1, limit: 100 } } } })
    const response = await call('shop/me/wishlist', { cookie: SIGNED_IN })
    expect(response.status).toBe(200)
    expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer AT', 'X-BuyNest-Bff': 'shared-key' })
    const body = await response.json()
    expect(body.shared).toBe(true)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 31, variant: null, note: 'For the office', addedAt: '2026-11-18T09:00:00Z' })
    const { product } = body.items[0]
    expect(product).toMatchObject({ id: 7, name: 'Desk Lamp', price: '40.00', sale_price: '36.00', brand: { id: 2, name: 'Lumo', slug: 'lumo' }, category: { name: 'Home', slug: 'home' } })
    expect(product).not.toHaveProperty('cost_price')
    expect(product.brand).not.toHaveProperty('supplier_email')
    expect(product.thumbnail_variants).toEqual({ 320: 'https://cdn.example/lamp-320.webp' })
  })

  it('adds an item (201, or 200 when it was there) and passes "wishlist full" on with its code', async () => {
    let count = 0
    const calls = fakeUpstream({
      'POST /api/v1/me/wishlist': () =>
        ++count === 1
          ? { status: 201, body: { data: ITEM } }
          : { status: 422, body: { message: 'Your wishlist is full (100 items). Remove something to add more.', code: 'wishlist_full', errors: { product_id: ['Your wishlist is full (100 items). Remove something to add more.'] } } },
    })
    const added = await call('shop/me/wishlist', { method: 'POST', cookie: SIGNED_IN, body: { productId: '7', variantId: 4, note: `  ${'x'.repeat(300)}  `, price: 1 } })
    expect(added.status).toBe(201)
    expect(calls[0].body).toEqual({ product_id: 7, variant_id: 4, note: 'x'.repeat(255) })
    expect((await added.json()).product.id).toBe(7)

    const full = await call('shop/me/wishlist', { method: 'POST', cookie: SIGNED_IN, body: { productId: 8 } })
    expect(full.status).toBe(422)
    expect(await full.json()).toMatchObject({ code: 'wishlist_full', errors: { productId: [expect.stringContaining('full')] } })
    expect(calls[1].body).toEqual({ product_id: 8 })
  })

  it('saves or clears a note, and removes an item (204 → { ok: true })', async () => {
    const calls = fakeUpstream({
      'PATCH /api/v1/me/wishlist/31': (body) => ({ body: { data: { ...ITEM, note: body.note } } }),
      'DELETE /api/v1/me/wishlist/31': { status: 204 },
      'DELETE /api/v1/me/wishlist/32': { status: 404, body: { message: 'Wishlist item not found.' } },
    })
    expect((await (await call('shop/me/wishlist/31', { method: 'PATCH', cookie: SIGNED_IN, body: { note: ' Size M ' } })).json()).note).toBe('Size M')
    expect((await (await call('shop/me/wishlist/31', { method: 'PATCH', cookie: SIGNED_IN, body: { note: '   ' } })).json()).note).toBeNull()
    expect(calls.map((entry) => entry.body)).toEqual([{ note: 'Size M' }, { note: null }])

    const removed = await call('shop/me/wishlist/31', { method: 'DELETE', cookie: SIGNED_IN })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ ok: true })
    const missing = await call('shop/me/wishlist/32', { method: 'DELETE', cookie: SIGNED_IN })
    expect(missing.status).toBe(404)
    expect((await call('shop/me/wishlist/abc', { method: 'DELETE', cookie: SIGNED_IN })).status).toBe(404)
  })

  it('merges the guest list once (ids only) and reports what was skipped', async () => {
    const calls = fakeUpstream({
      'POST /api/v1/me/wishlist/merge': {
        body: { data: [ITEM], meta: { shared: false, shared_at: null, count: 1, limit: 100, added: 1, skipped: [{ product_id: 99, variant_id: null, reason: 'unavailable' }] } },
      },
    })
    const response = await call('shop/me/wishlist/merge', { method: 'POST', cookie: SIGNED_IN, body: { items: [{ productId: 7, title: 'Desk Lamp' }, { productId: 99 }, { productId: 'nope' }] } })
    expect(calls[0].body).toEqual({ items: [{ product_id: 7 }, { product_id: 99 }] })
    expect(await response.json()).toMatchObject({ shared: false, items: [{ id: 31 }], skipped: [{ productId: 99, reason: 'unavailable' }] })
  })

  it('shares: a new link answers its token, an existing one answers null; stopping sharing', async () => {
    const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012-_9'
    const calls = fakeUpstream({
      'POST /api/v1/me/wishlist/share': (body) =>
        body.regenerate ? { status: 201, body: { data: { shared: true, token: TOKEN, shared_at: '2026-11-18T10:00:00Z' } } } : { status: 200, body: { data: { shared: true, token: null, shared_at: '2026-11-18T10:00:00Z' } } },
      'DELETE /api/v1/me/wishlist/share': { status: 204 },
    })
    expect(await (await call('shop/me/wishlist/share', { method: 'POST', cookie: SIGNED_IN, body: {} })).json()).toEqual({ shared: true, token: null, sharedAt: '2026-11-18T10:00:00Z' })
    const regenerated = await call('shop/me/wishlist/share', { method: 'POST', cookie: SIGNED_IN, body: { regenerate: true } })
    expect(regenerated.status).toBe(201)
    expect((await regenerated.json()).token).toBe(TOKEN)
    expect(calls.map((entry) => entry.body)).toEqual([{ regenerate: false }, { regenerate: true }])
    expect(await (await call('shop/me/wishlist/share', { method: 'DELETE', cookie: SIGNED_IN })).json()).toEqual({ ok: true })
  })
})

describe('a shared wishlist (/api/shop/wishlists/:token, no sign-in)', () => {
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012-_9'

  it('answers the first name and the items, nothing about the customer; never cached', async () => {
    const calls = fakeUpstream({
      [`GET /api/v1/wishlists/${TOKEN}`]: { body: { data: { owner_first_name: 'Nadia', email: 'nadia@example.com', customer_id: 5, items: [{ product: CARD, variant: { id: 4, label: 'Color: Black' }, note: 'Please!', added_at: '2026-11-18T09:00:00Z' }] } } },
    })
    const response = await call(`shop/wishlists/${TOKEN}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(calls[0].init.headers).not.toHaveProperty('Authorization')
    const body = await response.json()
    expect(Object.keys(body)).toEqual(['ownerFirstName', 'items'])
    expect(body.ownerFirstName).toBe('Nadia')
    expect(body.items).toEqual([{ product: expect.objectContaining({ id: 7, name: 'Desk Lamp' }), variantLabel: 'Color: Black', note: 'Please!' }])
  })

  it('a stopped or unknown link is a 404 with the API’s words', async () => {
    fakeUpstream({ [`GET /api/v1/wishlists/${TOKEN}`]: { status: 404, body: { message: "This wishlist isn't shared any more." } } })
    const response = await call(`shop/wishlists/${TOKEN}`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ message: "This wishlist isn't shared any more." })
  })
})

describe('reward points', () => {
  it('GET /api/shop/me/rewards: balance, value, and a page of history (no staff names)', async () => {
    const calls = fakeUpstream({
      'GET /api/v1/me/rewards': {
        body: {
          data: {
            enabled: true, balance: 1250, value: '12.50', point_value: '0.0100',
            transactions: [
              { id: 3, points: -500, balance_after: 1250, type: 'spend', order_number: 'BN-100004', note: null, created_at: '2026-11-18T09:00:00Z', admin_name: 'Sam (staff)' },
              { id: 2, points: 1750, balance_after: 1750, type: 'earn', order_number: 'BN-100001', note: null, created_at: '2026-11-10T09:00:00Z' },
            ],
          },
          links: { next: 'http://laravel.test/api/v1/me/rewards?page=2' },
          meta: { current_page: 2, per_page: 20, total: 22, last_page: 2 },
        },
      },
    })
    const response = await call('shop/me/rewards?page=2', { cookie: SIGNED_IN })
    expect(calls[0].search).toBe('?page=2')
    expect(await response.json()).toEqual({
      enabled: true, balance: 1250, value: 12.5, pointValue: 0.01, total: 22, page: 2, perPage: 20, lastPage: 2,
      transactions: [
        { id: 3, points: -500, balanceAfter: 1250, type: 'spend', orderNumber: 'BN-100004', note: null, createdAt: '2026-11-18T09:00:00Z' },
        { id: 2, points: 1750, balanceAfter: 1750, type: 'earn', orderNumber: 'BN-100001', note: null, createdAt: '2026-11-10T09:00:00Z' },
      ],
    })
    expect((await call('shop/me/rewards')).status).toBe(401)
  })

  const QUOTE = {
    lines: [], problems: [], coupon: null, coupon_error: null, applied_rules: [], shipping_options: [], shipping_required: true,
    gift_card: null, gift_card_error: null, reward_points_error: null,
    rewards: { enabled: true, balance: 1250, point_value: '0.0100', min_redeem: 100, max_points: 1000, earn_estimate: 15, applied_points: 500, applied_amount: '5.00' },
    cross_sells: [CARD, { ...CARD, id: 8, name: 'Bulb' }],
    totals: { item_count: 1, subtotal: '36.00', discount: '0.00', shipping: '0.00', tax: '0.00', total: '36.00', reward_points: '5.00', gift_card: '0.00', amount_due: '31.00' },
  }

  it('cart/validate sends the points (signed in only) and answers rewards, what they pay, and cross-sells', async () => {
    const calls = fakeUpstream({ 'POST /api/v1/cart/validate': { body: { data: QUOTE } } })
    const response = await call('shop/cart/validate', { method: 'POST', cookie: SIGNED_IN, body: { items: [{ productId: 7, quantity: 1 }], rewardPoints: '500' } })
    expect(calls[0].body).toMatchObject({ reward_points: 500 })
    const cart = await response.json()
    expect(cart.rewards).toEqual({ enabled: true, balance: 1250, pointValue: 0.01, minRedeem: 100, maxPoints: 1000, earnEstimate: 15, appliedPoints: 500, appliedAmount: 5 })
    expect(cart.rewardPoints).toEqual({ points: 500, amount: 5 })
    expect(cart.rewardPointsError).toBeNull()
    expect(cart.totals).toMatchObject({ total: 36, rewardPoints: 5, amountDue: 31 })
    expect(cart.crossSells.map((product) => product.id)).toEqual([7, 8])
    expect(cart.crossSells[0]).not.toHaveProperty('cost_price')

    // A guest's points are never sent (the API ignores them anyway).
    await call('shop/cart/validate', { method: 'POST', body: { items: [{ productId: 7, quantity: 1 }], rewardPoints: 500 } })
    expect(calls[1].body).not.toHaveProperty('reward_points')
  })

  it('an expired session prices the cart as a guest, without the points', async () => {
    let count = 0
    const calls = fakeUpstream({ 'POST /api/v1/cart/validate': () => (++count === 1 ? { status: 401, body: { message: 'Unauthenticated.' } } : { body: { data: { ...QUOTE, rewards: null } } }) })
    const cart = await (await call('shop/cart/validate', { method: 'POST', cookie: SIGNED_IN, body: { items: [{ productId: 7, quantity: 1 }], rewardPoints: 500 } })).json()
    expect(calls[0].body.reward_points).toBe(500)
    expect(calls[1].body).not.toHaveProperty('reward_points')
    expect(calls[1].init.headers).not.toHaveProperty('Authorization')
    expect(cart).toMatchObject({ rewards: null, rewardPoints: null })
  })

  it('orders send the points and answer what was spent and earned; a refused amount keeps its field', async () => {
    const order = {
      number: 'BN-100009', status: 'processing', payment_status: 'paid', payment_method: 'reward_points', shipping_method: { id: 'standard', label: 'Standard', eta: '3–5 days' },
      email: 'nadia@example.com', items: [], placed_at: '2026-11-18T10:00:00Z', totals: { ...QUOTE.totals, amount_due: '0.00' },
      reward_points: { spent: 500, amount: '5.00', earned: null },
    }
    let count = 0
    const calls = fakeUpstream({
      'POST /api/v1/orders': () =>
        ++count === 1 ? { status: 201, body: { data: order } } : { status: 422, body: { message: 'You have only 40 points.', errors: { reward_points: ['You have only 40 points.'] } } },
    })
    const placed = await call('shop/orders', { method: 'POST', cookie: SIGNED_IN, body: { items: [{ productId: 7, quantity: 1 }], paymentMethod: 'reward_points', rewardPoints: 500, email: 'nadia@example.com' } })
    expect(placed.status).toBe(201)
    expect(calls[0].body).toMatchObject({ payment_method: 'reward_points', reward_points: 500 })
    expect(await placed.json()).toMatchObject({ paymentMethod: 'reward_points', rewardPointsSpent: 500, rewardPointsAmount: 5, rewardPointsEarned: null, totals: { rewardPoints: 5, amountDue: 0 } })

    const refused = await call('shop/orders', { method: 'POST', cookie: SIGNED_IN, body: { items: [{ productId: 7, quantity: 1 }], rewardPoints: 500 } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ rewardPoints: ['You have only 40 points.'] })

    // A guest order never carries points.
    await call('shop/orders', { method: 'POST', body: { items: [{ productId: 7, quantity: 1 }], rewardPoints: 500 } })
    expect(calls[2].body).not.toHaveProperty('reward_points')
  })
})

describe('compare (GET /api/catalog/products/compare)', () => {
  it('forwards 2–4 numeric ids and passes the products on', async () => {
    const calls = fakeUpstream({ 'GET /api/v1/products/compare': { body: { data: [{ ...CARD, description_short: 'A lamp.', options: [], specifications: [{ label: 'Bulb', value: 'E27' }] }] } } })
    const response = await call('catalog/products/compare?ids=7,%208,9&secret=1')
    expect(response.status).toBe(200)
    expect(calls[0].search).toBe('?ids=7%2C8%2C9')
    expect((await response.json()).data[0].specifications).toEqual([{ label: 'Bulb', value: 'E27' }])
  })

  it('anything else is not found, without asking the API', async () => {
    const calls = fakeUpstream({})
    for (const query of ['', '?ids=', '?ids=1,2,3,4,5', '?ids=1,abc', '?ids=../admin']) {
      expect((await call(`catalog/products/compare${query}`)).status).toBe(404)
    }
    expect(calls).toHaveLength(0)
  })
})
