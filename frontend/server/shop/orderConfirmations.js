import { laravel } from '../http.js'
import { serverMessage } from '../i18n.js'

/*
 * Phase 20 (docs/backend/PHASE20_CONTRACT.md §1 "One-tap confirmation link", §3):
 * the link in the cash on delivery confirmation text, /c/{token}. No sign-in:
 * the token is the proof, and it only ever reaches this one order.
 *
 *   GET  /api/v1/order-confirmations/{token}  → { data: { number, total, items_count, placed_at,
 *                                                status: pending|confirmed|cancelled|expired|not_waiting } }
 *                                                (never changes anything: SMS apps and link previews open links)
 *   POST /api/v1/order-confirmations/{token}  { action: confirm|cancel, reason? } → the same summary with the new status
 *                                                (a `message` next to `data` is passed on when the API sends one)
 * Expired / unknown links → 404 with the API's plain message; a cancel the
 * confirmation rules refuse (shipped, invoiced) → 422 with the API's text; too
 * many tries → 429 (the API's throttle:20,1, per visitor: http.js passes the
 * visitor's IP with the BFF key). Status codes and messages go through unchanged.
 *
 * The summary has no address, phone or name; only these keys go through.
 * Resolves to { ok: true, status, data } or { ok: false, status, body }.
 */

export const STATUSES = ['pending', 'confirmed', 'cancelled', 'expired', 'not_waiting']
const MAX_REASON = 500
const str = (value) => (typeof value === 'string' ? value : undefined)

/** 32+ random bytes, URL-safe (base64url or hex): anything else is refused here without asking the API. */
export const isConfirmationToken = (value) => /^[A-Za-z0-9_-]{16,128}$/.test(value ?? '')

const money = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** The API's summary → { number, total, itemsCount, placedAt, status }. */
export function fromConfirmation(raw = {}) {
  const data = raw && typeof raw === 'object' ? raw : {}
  return {
    number: str(data.number) ?? null,
    total: money(data.total),
    itemsCount: Number.isInteger(data.items_count) && data.items_count >= 0 ? data.items_count : null,
    placedAt: str(data.placed_at) ?? null,
    status: STATUSES.includes(data.status) ? data.status : 'not_waiting',
  }
}

function failed({ status, data }, request) {
  const body = { message: str(data?.message) ?? serverMessage(request, status === 404 ? 'orderLinkInvalid' : 'requestFailed') }
  if (data?.errors && typeof data.errors === 'object') {
    body.errors = Object.fromEntries(Object.entries(data.errors).filter(([field]) => ['action', 'reason', 'token'].includes(field)))
  }
  return { ok: false, status, body }
}

const invalidLink = (request) => ({ ok: false, status: 404, body: { message: serverMessage(request, 'orderLinkInvalid') } })
const path = (token) => `/api/v1/order-confirmations/${encodeURIComponent(token)}`

export const laravelOrderConfirmations = {
  async get(token, request) {
    if (!isConfirmationToken(token)) return invalidLink(request)
    const result = await laravel(path(token), { request })
    return result.status === 200 ? { ok: true, status: 200, data: fromConfirmation(result.data?.data) } : failed(result, request)
  },

  async respond(token, body, request) {
    if (!isConfirmationToken(token)) return invalidLink(request)
    const action = body.action === 'confirm' || body.action === 'cancel' ? body.action : str(body.action)?.slice(0, 20) ?? ''
    const reason = action === 'cancel' ? str(body.reason)?.trim().slice(0, MAX_REASON) : undefined
    const result = await laravel(path(token), { method: 'POST', request, body: { action, ...(reason && { reason }) } })
    if (result.status !== 200 && result.status !== 201) return failed(result, request)
    const message = str(result.data?.message)
    return { ok: true, status: 200, data: { ...fromConfirmation(result.data?.data), ...(message && { message }) } }
  },
}
