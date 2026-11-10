/*
 * Shared plumbing for BuyNest's server-side services (sign-in and admin):
 * JSON responses, cookies, request bodies, and calls to DummyJSON.
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

/** Calls DummyJSON. Resolves to { status, data }; network failures become a 502. */
export async function upstream(path, { method = 'GET', token, body } = {}) {
  try {
    const response = await fetch(`${UPSTREAM}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
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
