// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { bdMobile, validateSmsSettings, validateSmsTest } from './adminPhase20Api.js'
import { fieldName, orderPhase20, smsMessage, smsSettings, toSmsBody } from './shop/adminPhase20.js'

/*
 * Phase 20 admin routes and fields (adminPhase20Api.js, shop/adminPhase20.js):
 * SMS notifications for orders. The settings, providers, stats and template
 * defaults, a test send, the SMS log and a retry, and the order's texts.
 * Laravel is faked; shapes from docs/backend/PHASE20_CONTRACT.md §1 "Admin API".
 */

const SITE = 'https://shop.example'
const ME = { id: 1, name: 'Store Owner', email: 'admin@buynest.test', role: { id: 1, name: 'Owner' }, permissions: [] }

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const entry = { method: init.method ?? 'GET', path: pathname, search, body: init.body, headers: init.headers }
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

const EVENTS = ['order_placed', 'cod_confirm_request', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled']
const DEFAULTS = Object.fromEntries(EVENTS.map((event) => [event, { en: `{store}: ${event} {order}`, bn: `{store}: অর্ডার {order}` }]))
const API_SETTINGS = {
  sms_enabled: true,
  sms_provider: 'log',
  sms_events: ['order_placed', 'order_shipped'],
  sms_templates: { order_placed: { en: '{store}: thanks for order {order}', bn: '' } },
  sms_confirm_link: true,
}
const API_SMS = {
  data: {
    settings: API_SETTINGS,
    providers: [
      { key: 'log', label: 'Log (test mode)', configured: true },
      { key: 'ssl_wireless', label: 'SSL Wireless', configured: false, api_token: 'secret-token' },
      { key: 'bulksmsbd', label: 'BulkSMSBD', configured: true },
    ],
    stats: { sent_today: 4, failed_today: 1, sent_30d: 120 },
    defaults: { templates: DEFAULTS, variables: ['store', 'order', 'total', 'name', 'courier', 'tracking', 'tracking_url', 'confirm_url', 'order_url', 'Bad Name'] },
  },
}
const API_MESSAGE = {
  id: 31, order: { number: 'BN-100042' }, event: 'order_shipped', to: '+8801712345678', body: 'BuyNest: order BN-100042 is on its way', locale: 'en', segments: 1, encoding: 'gsm',
  provider: 'log', status: 'failed', error: 'Provider said: invalid sender', attempts: 2, sent_at: null, created_at: '2026-11-27T09:00:00Z',
}

describe('SMS settings', () => {
  it('reads the settings, providers, stats and defaults in the admin’s names, never a key', async () => {
    const calls = fakeLaravel({ 'GET /api/admin/v1/sms': { body: API_SMS } })
    const response = await admin('sms')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(toApi(calls)[0].path).toBe('/api/admin/v1/sms')
    expect(body.settings).toEqual({
      enabled: true,
      provider: 'log',
      events: ['order_placed', 'order_shipped'],
      templates: {
        order_placed: { en: '{store}: thanks for order {order}', bn: '' },
        cod_confirm_request: { en: '', bn: '' },
        order_confirmed: { en: '', bn: '' },
        order_shipped: { en: '', bn: '' },
        order_delivered: { en: '', bn: '' },
        order_cancelled: { en: '', bn: '' },
      },
      confirmLink: true,
    })
    expect(body.providers).toEqual([
      { key: 'log', label: 'Log (test mode)', configured: true },
      { key: 'ssl_wireless', label: 'SSL Wireless', configured: false },
      { key: 'bulksmsbd', label: 'BulkSMSBD', configured: true },
    ])
    expect(body.stats).toEqual({ sentToday: 4, failedToday: 1, sent30d: 120 })
    expect(body.defaults.templates.order_placed).toEqual(DEFAULTS.order_placed)
    expect(body.defaults.variables).toEqual(['store', 'order', 'total', 'name', 'courier', 'tracking', 'tracking_url', 'confirm_url', 'order_url'])
    expect(body.live).toBe(true)
    expect(JSON.stringify(body)).not.toContain('secret-token')
  })

  it('reads settings without the prefix too, and fills in the defaults', () => {
    expect(smsSettings({ enabled: false, provider: 'twilio', events: ['order_cancelled', 'spam', 'order_placed'], confirm_link: false })).toMatchObject({
      enabled: false, provider: 'log', events: ['order_placed', 'order_cancelled'], confirmLink: false,
    })
    expect(smsSettings(undefined)).toMatchObject({ enabled: false, provider: 'log', events: EVENTS, confirmLink: true })
    expect(smsSettings({ sms_templates: { order_placed: { en: 'x'.repeat(600) } } }).templates.order_placed.en).toHaveLength(480)
    // The API sends null for a template left at its default.
    expect(smsSettings({ sms_templates: { order_placed: { en: null, bn: null } } }).templates.order_placed).toEqual({ en: '', bn: '' })
  })

  it('saves partial settings under the API’s names, and checks them first', async () => {
    const calls = fakeLaravel({ 'PUT /api/admin/v1/sms/settings': (entry) => ({ body: { data: { ...API_SMS.data, settings: { ...API_SETTINGS, ...sent(entry) } } } }) })
    const response = await admin('sms/settings', { method: 'PUT', body: { enabled: false, provider: 'bulksmsbd', confirmLink: false } })
    expect(response.status).toBe(200)
    expect(sent(toApi(calls)[0])).toEqual({ sms_enabled: false, sms_provider: 'bulksmsbd', sms_confirm_link: false })
    expect((await response.json()).settings).toMatchObject({ enabled: false, provider: 'bulksmsbd', confirmLink: false })

    await admin('sms/settings', {
      method: 'PUT',
      body: { events: ['order_shipped', 'order_placed', 'order_placed'], templates: { order_placed: { en: 'Hi {name}', bn: 'হ্যালো {name}' }, order_shipped: { en: '   ', bn: null } } },
    })
    expect(sent(toApi(calls)[1])).toEqual({
      sms_events: ['order_placed', 'order_shipped'],
      sms_templates: { order_placed: { en: 'Hi {name}', bn: 'হ্যালো {name}' }, order_shipped: { en: '', bn: '' } },
    })

    const bad = await admin('sms/settings', { method: 'PUT', body: { enabled: true, events: [], provider: 'twilio', templates: { order_placed: { en: 'x'.repeat(481) } } } })
    expect(bad.status).toBe(422)
    expect((await bad.json()).errors).toEqual({
      events: ['Choose at least one text to send.'],
      provider: ['Choose a provider.'],
      'templates.order_placed.en': ['Keep the text to 480 characters.'],
    })
    expect(toApi(calls)).toHaveLength(2)
  })

  it('checks each setting', () => {
    expect(validateSmsSettings({}).errors).toBeDefined()
    expect(validateSmsSettings({ enabled: 'yes' }).errors.enabled).toEqual(['Choose on or off.'])
    expect(validateSmsSettings({ events: [] }).values).toEqual({ events: [] })
    expect(validateSmsSettings({ events: ['marketing'] }).errors.events).toEqual(['Choose the texts to send.'])
    expect(validateSmsSettings({ templates: { promo: { en: 'x' } } }).errors.templates).toBeDefined()
    expect(validateSmsSettings({ templates: { order_placed: { fr: 'x' } } }).errors['templates.order_placed']).toBeDefined()
    expect(validateSmsSettings({ templates: { order_placed: { en: 5 } } }).errors['templates.order_placed.en']).toBeDefined()
    expect(validateSmsSettings({ templates: [] }).errors.templates).toBeDefined()
    expect(validateSmsSettings({ templates: { order_placed: { bn: 'ক'.repeat(480) } } }).values.templates.order_placed.bn).toHaveLength(480)
    expect(validateSmsSettings({ confirmLink: 'on' }).errors.confirmLink).toBeDefined()
    expect(toSmsBody({ events: ['order_placed'], other: 1 })).toEqual({ sms_events: ['order_placed'] })
  })

  it('maps the API’s field errors to the form’s names', async () => {
    fakeLaravel({
      'PUT /api/admin/v1/sms/settings': {
        status: 422,
        body: {
          message: 'Invalid',
          errors: { sms_provider: ['SSL Wireless is not set up.'], 'sms_events.0': ['Unknown text.'], 'sms_templates.order_placed.bn': ['Keep the text to 480 characters.'] },
        },
      },
    })
    const response = await admin('sms/settings', { method: 'PUT', body: { provider: 'ssl_wireless' } })
    expect(response.status).toBe(422)
    expect((await response.json()).errors).toEqual({ provider: ['SSL Wireless is not set up.'], events: ['Unknown text.'], 'templates.order_placed.bn': ['Keep the text to 480 characters.'] })
    expect(fieldName('templates.order_shipped')).toBe('templates.order_shipped')
    expect(fieldName('sms_confirm_link')).toBe('confirmLink')
  })
})

describe('a test SMS', () => {
  it('sends to a Bangladeshi mobile in the +880 form, with the optional text', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/sms/test': (entry) => ({ status: 201, body: { data: { ...API_MESSAGE, id: 40, order: null, event: null, status: 'sent', error: null, to: sent(entry).to, sent_at: '2026-11-27T09:01:00Z' } } }) })
    const response = await admin('sms/test', { method: 'POST', body: { to: '01712-345 678', body: '  Hello from BuyNest  ' } })
    expect(response.status).toBe(201)
    expect(sent(toApi(calls)[0])).toEqual({ to: '+8801712345678', body: 'Hello from BuyNest' })
    expect((await response.json()).message).toMatchObject({ id: 40, order: null, event: null, to: '+8801712345678', status: 'sent', sentAt: '2026-11-27T09:01:00Z' })

    await admin('sms/test', { method: 'POST', body: { to: '+8801912345678', body: '' } })
    expect(sent(toApi(calls)[1])).toEqual({ to: '+8801912345678' })
  })

  it('refuses a number that isn’t a Bangladeshi mobile, and passes the API’s refusal on', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/sms/test': { status: 422, body: { message: 'Invalid', errors: { to: ['This number can’t get texts.'] } } } })
    const bad = await admin('sms/test', { method: 'POST', body: { to: '0212345678', body: 'x'.repeat(481) } })
    expect(bad.status).toBe(422)
    expect((await bad.json()).errors).toEqual({ to: ['Enter a Bangladeshi mobile number, like 01712345678.'], body: ['Keep the text to 480 characters.'] })
    expect(toApi(calls)).toHaveLength(0)

    const refused = await admin('sms/test', { method: 'POST', body: { to: '01712345678' } })
    expect(refused.status).toBe(422)
    expect((await refused.json()).errors).toEqual({ to: ['This number can’t get texts.'] })
  })

  it('reads the mobile forms staff type', () => {
    expect(bdMobile('01712345678')).toBe('+8801712345678')
    expect(bdMobile('8801712345678')).toBe('+8801712345678')
    expect(bdMobile('+880 1712 345678')).toBe('+8801712345678')
    expect(bdMobile('01212345678')).toBeNull()
    expect(bdMobile('+447700900123')).toBeNull()
    expect(bdMobile(1712345678)).toBeNull()
    expect(validateSmsTest({ to: '01812345678', body: null }).values).toEqual({ to: '+8801812345678' })
    expect(validateSmsTest({ to: '01812345678', body: 5 }).errors.body).toBeDefined()
  })
})

describe('the SMS log', () => {
  it('lists the texts with the filters, search and paging', async () => {
    const calls = fakeLaravel({
      'GET /api/admin/v1/sms/messages': {
        body: {
          data: [
            API_MESSAGE,
            { id: 30, order: null, event: null, to: '+8801812345678', body: 'BuyNest: টেস্ট', locale: 'bn', segments: 1, encoding: 'unicode', provider: 'log', status: 'sent', error: null, attempts: 1, sent_at: '2026-11-27T08:00:00Z', created_at: '2026-11-27T08:00:00Z' },
            { order: null, body: 'no id' },
          ],
          meta: { total: 41 },
        },
      },
    })
    const body = await (await admin('sms/messages?status=failed&event=order_shipped&q=%201712%20&limit=20&skip=20')).json()
    const [request] = toApi(calls)
    expect(Object.fromEntries(new URLSearchParams(request.search))).toEqual({ page: '2', per_page: '20', status: 'failed', event: 'order_shipped', search: '1712' })
    expect(body.total).toBe(41)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({
      id: 31, order: { number: 'BN-100042' }, event: 'order_shipped', to: '+8801712345678', body: 'BuyNest: order BN-100042 is on its way', locale: 'en', segments: 1, encoding: 'gsm',
      provider: 'log', status: 'failed', error: 'Provider said: invalid sender', attempts: 2, sentAt: null, createdAt: '2026-11-27T09:00:00Z',
    })
    expect(body.messages[1]).toMatchObject({ order: null, event: null, encoding: 'unicode', locale: 'bn', status: 'sent' })

    await admin('sms/messages?status=lost&event=marketing')
    const params = new URLSearchParams(toApi(calls)[1].search)
    expect(params.has('status')).toBe(false)
    expect(params.has('event')).toBe(false)
    await admin('sms/messages?event=test')
    expect(new URLSearchParams(toApi(calls)[2].search).get('event')).toBe('test')
    expect(smsMessage({ id: '7', status: 'odd', encoding: 'odd' })).toMatchObject({ id: 7, status: 'queued', encoding: 'gsm', segments: 1, attempts: 0 })
  })

  it('retries a failed text', async () => {
    const calls = fakeLaravel({ 'POST /api/admin/v1/sms/messages/31/retry': { body: { data: { ...API_MESSAGE, status: 'sent', error: null, attempts: 3, sent_at: '2026-11-27T09:10:00Z' } } } })
    const response = await admin('sms/messages/31/retry', { method: 'POST', body: {} })
    expect(response.status).toBe(200)
    expect(toApi(calls)[0]).toMatchObject({ method: 'POST', path: '/api/admin/v1/sms/messages/31/retry' })
    expect((await response.json()).message).toMatchObject({ id: 31, status: 'sent', attempts: 3 })

    expect((await admin('sms/messages/abc/retry', { method: 'POST', body: {} })).status).toBe(404)
    expect((await admin('sms/messages/31', { method: 'POST', body: {} })).status).toBe(404)
    expect((await admin('sms/messages/31/retry')).status).toBe(404)
  })

  it('passes the API’s permission refusal on, and needs the BuyNest backend', async () => {
    fakeLaravel({ 'POST /api/admin/v1/sms/messages/31/retry': { status: 403, body: { message: 'Forbidden', code: 'permission_denied', permission: 'orders.edit' } } })
    const refused = await admin('sms/messages/31/retry', { method: 'POST', body: {} })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ code: 'permission_denied', permission: 'orders.edit' })

    expect((await admin('sms/other')).status).toBe(404)
    expect((await admin('sms/settings/more', { method: 'PUT', body: {} })).status).toBe(404)
    expect((await admin('sms', { method: 'DELETE' })).status).toBe(404)

    vi.stubEnv('VITE_API_PROVIDER', 'dummyjson')
    const demo = await admin('sms')
    expect(demo.status).toBe(404)
    expect((await demo.json()).message).toMatch(/BuyNest backend/)
  })
})

describe('the order’s texts', () => {
  it('maps sms on the order, and old answers have none', () => {
    expect(
      orderPhase20({
        sms: [
          { id: 31, event: 'order_shipped', status: 'failed', to: '+8801712345678', sent_at: null, created_at: '2026-11-27T09:00:00Z', error: 'Timeout' },
          { event: 'order_placed', status: 'sent', to: '+8801712345678', sent_at: '2026-11-26T09:00:00Z', error: null },
        ],
      }),
    ).toEqual({
      sms: [
        { id: 31, event: 'order_shipped', status: 'failed', to: '+8801712345678', sentAt: null, createdAt: '2026-11-27T09:00:00Z', error: 'Timeout' },
        { id: null, event: 'order_placed', status: 'sent', to: '+8801712345678', sentAt: '2026-11-26T09:00:00Z', createdAt: null, error: null },
      ],
    })
    expect(orderPhase20({})).toEqual({})
  })

  it('rides on the order page', async () => {
    const ORDER = {
      number: 'BN-100042', status: 'processing', payment_status: 'unpaid', payment_method: 'cod', email: 'nadia@example.com', phone: '+8801712345678',
      currency: 'BDT', items: [], shipments: [], invoices: [], credit_memos: [], history: [], totals: { subtotal: '1000.00', total: '1060.00' },
      placed_at: '2026-11-26T09:00:00Z',
      sms: [{ id: 31, event: 'order_placed', status: 'sent', to: '+8801712345678', sent_at: '2026-11-26T09:00:00Z', error: null }],
    }
    fakeLaravel({ 'GET /api/admin/v1/orders/BN-100042': { body: { data: ORDER } } })
    const response = await admin('orders/BN-100042')
    expect(response.status).toBe(200)
    expect((await response.json()).sms).toEqual([{ id: 31, event: 'order_placed', status: 'sent', to: '+8801712345678', sentAt: '2026-11-26T09:00:00Z', createdAt: null, error: null }])
  })
})
