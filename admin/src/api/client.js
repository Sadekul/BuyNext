/*
 * The admin app's only connection to the network: BuyNest's admin service
 * at /api/admin, on this same address. The browser sends the HttpOnly admin
 * session cookies by itself; this code never sees a token.
 */

const TIMEOUT_MS = 15_000

/** A failed request. `status` 0 = network/timeout; `fieldErrors` = 422 messages per field. */
export class ApiError extends Error {
  constructor(message, { status = 0, data = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = status === 422 && data?.errors && typeof data.errors === 'object' ? data.errors : null
    // 403 permission_denied (admin roles): which permission the role lacks.
    this.code = typeof data?.code === 'string' ? data.code : null
    this.permission = typeof data?.permission === 'string' ? data.permission : null
    // CSV import refused because of row errors: the API's report, rows and all.
    this.report = data?.report && typeof data.report === 'object' ? data.report : null
  }
}

const STATUS_MESSAGES = {
  401: 'Please sign in to continue.',
  403: 'This account does not have admin access.',
  404: 'That item was not found.',
  413: 'The upload is too large.',
  422: 'Please check the highlighted fields.',
}

async function send(path, { method = 'GET', body, params, signal, keepalive = false, timeout: timeoutMs = TIMEOUT_MS } = {}) {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  // Uploads (FormData) go as multipart: the browser writes the Content-Type with its boundary.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  let response
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined && !isForm && { 'Content-Type': 'application/json' }) },
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      keepalive,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    if (error.name === 'TimeoutError') throw new ApiError('The server took too long to respond. Please try again.')
    throw new ApiError('Network error. Check your connection and try again.')
  }

  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json().catch(() => null) : null
  if (!response.ok) {
    const fallback = response.status >= 500 ? 'The server had a problem. Please try again.' : 'The request failed.'
    throw new ApiError(data?.message ?? STATUS_MESSAGES[response.status] ?? fallback, { status: response.status, data })
  }
  return data
}

// One session renewal at a time, shared by every request that hit a 401.
let renewal = null
function renewSession() {
  renewal ??= send('/api/admin/auth/refresh', { method: 'POST', body: {} }).finally(() => {
    renewal = null
  })
  return renewal
}

/**
 * A request that needs the session. On 401 it renews the session once and
 * retries; if renewal fails, the original 401 is thrown (the app then shows
 * the sign-in page).
 */
export async function request(path, options) {
  try {
    return await send(path, options)
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401) || path.startsWith('/api/admin/auth/')) throw error
    try {
      await renewSession()
    } catch {
      throw error
    }
    return send(path, options)
  }
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
}
