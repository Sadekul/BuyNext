import { laravel } from '../http.js'

/*
 * The newsletter with BuyNest's Laravel API (docs/backend/PHASE7_CONTRACT.md §3,
 * double opt-in). No sign-in needed: signed-in customers switch it on and off
 * in their account instead (PUT /api/auth/profile { newsletter }).
 *
 *   POST /api/v1/newsletter              { email, source } → 202 (the same answer for every address)
 *   POST /api/v1/newsletter/confirm      { token }         → 200 { message, data: { email, status } }
 *   POST /api/v1/newsletter/unsubscribe  { token }         → 200 { message, data: { email, status } }
 *
 * Only these fields go through, both ways. Resolves to
 * { ok: true, status, data } or { ok: false, status, body }.
 */

const SOURCES = ['footer', 'checkout']
const str = (value) => (typeof value === 'string' ? value : undefined)
// Tokens are short strings ("{id}.{hmac}" or a random string): anything else is refused here.
const token = (value) => {
  const text = str(value)?.trim()
  return text && /^[A-Za-z0-9._~-]{1,300}$/.test(text) ? text : null
}

function failed({ status, data }) {
  const body = { message: str(data?.message) ?? 'The request failed.' }
  if (data?.errors && typeof data.errors === 'object') {
    body.errors = Object.fromEntries(Object.entries(data.errors).filter(([field]) => ['email', 'token', 'source'].includes(field)))
  }
  return { ok: false, status, body }
}

const done = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data ?? {}) } : failed(result))
const fromStatus = (data) => ({
  message: str(data.message) ?? '',
  email: str(data.data?.email) ?? null,
  status: ['pending', 'subscribed', 'unsubscribed'].includes(data.data?.status) ? data.data.status : null,
})

/** A token that fails the format check gets the API's own wording, without asking it. */
const badToken = (message) => ({ ok: false, status: 422, body: { message, errors: { token: [message] } } })

export const laravelNewsletter = {
  async subscribe(body, request) {
    const email = str(body.email)?.trim().slice(0, 254)
    const source = SOURCES.includes(body.source) ? body.source : 'footer'
    const result = await laravel('/api/v1/newsletter', { method: 'POST', request, body: { email: email ?? '', source } })
    return done(result, [200, 201, 202], (data) => ({ message: str(data.message) ?? "Thanks! Check your inbox to confirm." }))
  },

  async confirm(body, request) {
    const value = token(body.token)
    if (!value) return badToken('This confirmation link is invalid or has expired. Subscribe again to get a new one.')
    return done(await laravel('/api/v1/newsletter/confirm', { method: 'POST', request, body: { token: value } }), [200], fromStatus)
  },

  async unsubscribe(body, request) {
    const value = token(body.token)
    if (!value) return badToken('This unsubscribe link is invalid.')
    return done(await laravel('/api/v1/newsletter/unsubscribe', { method: 'POST', request, body: { token: value } }), [200], fromStatus)
  },
}
