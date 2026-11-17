/*
 * Shared plumbing for BuyNest's server-side services (sign-in and admin):
 * JSON responses, cookies, request bodies, and calls to DummyJSON and to
 * BuyNest's Laravel API.
 * Web standard Request/Response only, so it runs on Node, Vercel, and Netlify.
 */

export const UPSTREAM = 'https://dummyjson.com'

export function json(body, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(body), { status, headers })
}

export function readCookies(request) {
  const cookies = {}
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return cookies
}

export async function readBody(request) {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  } catch {
    return {}
  }
}

async function callJson(url, { method = 'GET', token, body, headers = {} }) {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const data = await response.json().catch(() => ({}))
    return { status: response.status, data }
  } catch {
    return { status: 502, data: { message: 'The server could not be reached. Please try again.' } }
  }
}

/** Calls DummyJSON. Resolves to { status, data }; network failures become a 502. */
export const upstream = (path, options = {}) => callJson(`${UPSTREAM}${path}`, options)

/**
 * The visitor's IP address, from the header the host sets (Netlify, Vercel,
 * or the dev server in vite.config.js, which replaces any value the browser sent).
 */
export function clientIp(request) {
  const forwarded = request?.headers.get('x-nf-client-connection-ip') ?? request?.headers.get('x-real-ip') ?? request?.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0].trim() || null
}

/**
 * Calls BuyNest's Laravel API (server to server). Resolves to { status, data }.
 * Every call carries the shared key (BUYNEST_BFF_KEY = the backend's
 * BFF_SHARED_KEY) when it is set: in production the API only answers calls
 * that carry it. With the key it also passes on the visitor's IP, so the
 * API's rate limits count each visitor separately instead of everyone
 * together. The key always comes from this server's environment, never from
 * a header the browser (or Stripe) sent.
 */
const laravelBase = () => (process.env.BUYNEST_LARAVEL_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
function bffHeaders(request) {
  const key = process.env.BUYNEST_BFF_KEY
  if (!key) return {}
  const ip = clientIp(request)
  return { 'X-BuyNest-Bff': key, ...(ip && { 'X-Client-IP': ip }) }
}

export function laravel(path, { request, ...options } = {}) {
  return callJson(`${laravelBase()}${path}`, { ...options, headers: bffHeaders(request) })
}

/**
 * A GET to the Laravel API whose answer isn't JSON (the report CSV files).
 * Resolves to { status, contentType, disposition, text } on success, or
 * { status, data } (parsed JSON error) like laravel().
 */
export async function laravelFile(path, { token, request } = {}) {
  try {
    const response = await fetch(`${laravelBase()}${path}`, {
      headers: { Accept: 'text/csv, application/json', ...(token && { Authorization: `Bearer ${token}` }), ...bffHeaders(request) },
      signal: AbortSignal.timeout(30_000),
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || contentType.includes('application/json')) return { status: response.ok ? 502 : response.status, data: await response.json().catch(() => ({})) }
    return { status: response.status, contentType, disposition: response.headers.get('content-disposition'), text: await response.text() }
  } catch {
    return { status: 502, data: { message: 'The server could not be reached. Please try again.' } }
  }
}

/**
 * A multipart/form-data request's Content-Type, if it is one with a sane
 * boundary (forwarded to the API unchanged, so it can find the parts).
 */
export function multipartType(request) {
  const type = request.headers.get('content-type') ?? ''
  return /^multipart\/form-data;\s*boundary=("?)[A-Za-z0-9'()+_,./:=?-][A-Za-z0-9'()+_,./:=? -]{0,69}\1$/i.test(type) ? type : null
}

/**
 * The request body as bytes, but never more than `maxBytes`: a larger
 * Content-Length is refused before reading, and a body without one stops
 * being read as soon as it passes the cap. Resolves to { bytes } or { tooLarge: true }.
 */
export async function readLimitedBody(request, maxBytes) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true }
  if (!request.body) return { bytes: new Uint8Array(0) }
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return { tooLarge: true }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes }
}

/**
 * Sends an already-read multipart body to the Laravel API as it came (same
 * Content-Type and boundary). Resolves to { status, data } like laravel().
 */
export async function laravelMultipart(path, { token, request, contentType, bytes, timeout = 60_000 }) {
  try {
    const response = await fetch(`${laravelBase()}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': contentType, ...(token && { Authorization: `Bearer ${token}` }), ...bffHeaders(request) },
      body: bytes,
      signal: AbortSignal.timeout(timeout),
    })
    return { status: response.status, data: await response.json().catch(() => ({})) }
  } catch {
    return { status: 502, data: { message: 'The server could not be reached. Please try again.' } }
  }
}

/**
 * Sends a body to the Laravel API exactly as it came (the bytes are never
 * parsed or re-serialized), with only the listed extra headers. For the
 * Stripe webhook, whose signature covers the raw body. Resolves to
 * { status, data } like laravel(); network failures become a 502.
 */
export async function laravelRaw(path, { request, bytes, contentType, headers = {}, timeout = 15_000 }) {
  try {
    const response = await fetch(`${laravelBase()}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': contentType, ...headers, ...bffHeaders(request) },
      body: bytes,
      signal: AbortSignal.timeout(timeout),
    })
    return { status: response.status, data: await response.json().catch(() => ({})) }
  } catch {
    return { status: 502, data: { message: 'The server could not be reached. Please try again.' } }
  }
}

/** Copies only the listed keys that exist: the allow-list pattern for anything sent to the browser. */
export function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]))
}

/**
 * The profile fields the browser may see. DummyJSON's /auth/me also returns
 * the password, card, bank, SSN, IP, and device details: those never leave
 * the server.
 */
export function safeProfile(user) {
  return {
    ...pick(user, ['id', 'username', 'firstName', 'lastName', 'email', 'image', 'phone', 'role']),
    ...(user?.address && { address: pick(user.address, ['address', 'city', 'state', 'postalCode', 'country']) }),
  }
}
