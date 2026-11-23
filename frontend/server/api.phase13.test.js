// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'
import { languageHeaders, requestLanguage, serverMessage } from './i18n'

// Phase 13 (docs/backend/PHASE13_CONTRACT.md §2): the sign-in service forwards the shopper's language
// (the `buynest_lang` cookie) to the API as Accept-Language, the public catalog takes it from the URL
// (`?lang=bn`, cached per language), admin calls stay English, and its own messages are translated.
const SITE = 'https://shop.example'

function fakeLaravel(routes) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ path: pathname, init })
    const route = routes[`${init.method ?? 'GET'} ${pathname}`] ?? { status: 404, body: { message: 'Not found' } }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  return calls
}
const request = (path, { method = 'GET', headers = {}, body } = {}) => handleApiRequest(new Request(`${SITE}${path}`, { method, headers, body }))

beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNTS_BACKEND', 'laravel')
  vi.stubEnv('VITE_API_PROVIDER', 'laravel')
  vi.stubEnv('BUYNEST_LARAVEL_URL', 'http://laravel.test')
  vi.stubEnv('BUYNEST_BFF_KEY', 'shared-secret')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the language helpers', () => {
  const withCookie = (cookie) => new Request(SITE, { headers: { cookie } })
  it('reads only en/bn from the buynest_lang cookie', () => {
    expect(requestLanguage(withCookie('a=1; buynest_lang=bn'))).toBe('bn')
    expect(requestLanguage(withCookie('buynest_lang=en'))).toBe('en')
    expect(requestLanguage(withCookie('buynest_lang=fr'))).toBeNull()
    expect(requestLanguage(new Request(SITE))).toBeNull()
  })

  it('sends Accept-Language for store calls only, and an explicit language wins', () => {
    const bangla = withCookie('buynest_lang=bn')
    expect(languageHeaders(bangla, '/api/v1/cart/validate')).toEqual({ 'Accept-Language': 'bn' })
    expect(languageHeaders(bangla, '/api/admin/v1/products')).toEqual({})
    expect(languageHeaders(new Request(SITE), '/api/v1/me')).toEqual({})
    expect(languageHeaders(bangla, '/api/v1/products', 'en')).toEqual({ 'Accept-Language': 'en' })
  })

  it('translates its own messages', () => {
    expect(serverMessage(withCookie('buynest_lang=bn'), 'signIn')).toBe('চালিয়ে যেতে সাইন ইন করুন।')
    expect(serverMessage(new Request(SITE), 'signIn')).toBe('Please sign in to continue.')
  })
})

describe('forwarding the language', () => {
  it('a store call carries Accept-Language from the cookie', async () => {
    const calls = fakeLaravel({ 'POST /api/v1/cart/validate': { body: { data: { lines: [], totals: {} } } } })
    await request('/api/shop/cart/validate', { method: 'POST', headers: { cookie: 'buynest_lang=bn', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: SITE }, body: JSON.stringify({ items: [] }) })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0].init.headers['Accept-Language']).toBe('bn')
  })

  it('the catalog takes its language from the URL, never the cookie alone', async () => {
    const calls = fakeLaravel({ 'GET /api/v1/products/1': { body: { data: { id: 1, name: 'মাসকারা' } } } })
    await request('/api/catalog/products/1?lang=bn')
    await request('/api/catalog/products/1', { headers: { cookie: 'buynest_lang=bn' } })
    expect(calls.map((call) => call.init.headers['Accept-Language'])).toEqual(['bn', 'en'])
  })

  it('answers "please sign in" in Bangla', async () => {
    fakeLaravel({})
    const response = await request('/api/shop/orders', { headers: { cookie: 'buynest_lang=bn' } })
    expect(response.status).toBe(401)
    expect((await response.json()).message).toBe('চালিয়ে যেতে সাইন ইন করুন।')
  })
})
