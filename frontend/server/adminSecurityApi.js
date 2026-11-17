import { clientIp, json, laravel, readBody, readCookies } from './http.js'
import { adminProfile } from './accounts/laravel.js'
import { ADMIN, sessionCookies } from './session.js'
import { adminUser } from './shop/adminSystem.js'
import { camelPath } from './shop/laravel.js'

/*
 * Phase 9 admin routes (docs/backend/PHASE9_CONTRACT.md §1, §3, §7 and the
 * implementation notes), BuyNest's Laravel API only.
 *
 * TWO-STEP SIGN-IN. The tokens never reach the browser: like every admin
 * sign-in they go into the HttpOnly admin cookies (session.js ADMIN). The only
 * token the browser sees is the sign-in *challenge*, which is not a session:
 * it works for 5 minutes, once, only together with a code, and is burned
 * after 5 wrong codes (all enforced by the API).
 *
 *   POST /api/admin/auth/login        { email, password, remember }
 *        → the admin (cookies set), as before
 *        → { twoFactorRequired: true, challenge, expiresAt }         two-step on: no cookies yet
 *        → the admin + twoFactorSetupRequired: true (cookies set)    the store requires two-step and this
 *          admin has none: a limited session that only reaches GET me and the enrolment routes
 *   POST /api/admin/auth/two-factor   { challenge, code | recoveryCode, remember } → the admin (cookies set)
 *   POST   /api/admin/me/two-factor                 → { secret, otpauthUrl, qrSvg } (not on until confirmed)
 *   POST   /api/admin/me/two-factor/confirm         { code } → { recoveryCodes, admin } (a limited
 *                                                     session is replaced by a full one: new cookies)
 *   POST   /api/admin/me/two-factor/recovery-codes  { password } → { recoveryCodes }
 *   DELETE /api/admin/me/two-factor                 { password, code } → { ok, message, admin }
 *   POST   /api/admin/admins/:id/two-factor/reset   → { ok, message, admin } (Owner + admins.manage)
 *
 * BACKUPS (backups.view, the Owner by default):
 *   GET    /api/admin/backups                → { backups: [{ name, size, createdAt }], keepDays, schedule, timezone,
 *                                               disk, running, lastRun }
 *   POST   /api/admin/backups                → 201 { backup: run, message } ("Back up now", waits for it)
 *   POST   /api/admin/backups/:name/download → { url, expiresAt }: a link to the route below, valid 5 minutes
 *   GET    /api/admin/backups/:name/file?expires&signature → the .sql.gz file, streamed from the API's signed
 *                                               download (which needs the admin session AND the signature)
 *
 * STOCK ALERTS (reports.view):
 *   GET    /api/admin/reports/stock-alerts?q&limit&skip → { products: [...], total, waitingTotal,
 *                                               notifiedLast30Days, limit, skip }
 */

const realAccounts = () => process.env.VITE_ACCOUNTS_BACKEND === 'laravel'
const realData = () => process.env.VITE_API_PROVIDER === 'laravel' && realAccounts()
const LIVE_ONLY = 'This needs the BuyNest backend.'
const liveOnly = () => json({ message: LIVE_ONLY }, 404)
const invalid = (errors) => json({ message: 'Please check the highlighted fields.', errors }, 422)

const FIELD_NAMES = { recovery_code: 'recoveryCode' }

/** An API error → the body the browser may see (message, field errors in app names, code, permission). */
function failedBody({ data }) {
  const body = { message: typeof data?.message === 'string' ? data.message : 'The request failed.' }
  if (data?.errors && typeof data.errors === 'object') {
    body.errors = Object.fromEntries(Object.entries(data.errors).map(([field, messages]) => [FIELD_NAMES[field] ?? camelPath(field), messages]))
  }
  if (typeof data?.code === 'string') body.code = data.code
  if (typeof data?.permission === 'string') body.permission = data.permission
  return body
}
const passOn = (result) => json(failedBody(result), result.status >= 400 ? result.status : 502)

const str = (value) => (typeof value === 'string' ? value : undefined)
const tokensOf = (tokens) => ({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token })
const hasTokens = (tokens) => typeof tokens?.access_token === 'string' && typeof tokens?.refresh_token === 'string'

// ---- shapes the browser sends ----

/** "123 456" → "123456"; anything that isn't 6 digits → null. */
export const sixDigits = (value) => (typeof value === 'string' && /^\d{6}$/.test(value.replace(/\s+/g, '')) ? value.replace(/\s+/g, '') : null)
/** Recovery codes look like "abcde-12345"; typed in any case, the dash optional. */
export const recoveryCode = (value) => (typeof value === 'string' && /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(value.trim()) ? value.trim().toLowerCase() : null)
/** The sign-in challenge: a random token from the API (64 characters today). */
export const isChallenge = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(value)
/** buynest-YYYYMMDD-HHMMSS.sql.gz, nothing else. */
export const isBackupName = (value) => typeof value === 'string' && /^buynest-\d{8}-\d{6}\.sql\.gz$/.test(value)
/** The signed download's query string as the API wrote it: ?expires=…&signature=… (either order), nothing else. */
export const isSignedQuery = (search) => /^\?(expires=\d{1,12}&signature=[a-f0-9]{64}|signature=[a-f0-9]{64}&expires=\d{1,12})$/.test(search ?? '')

// ---- sign-in (no session needed: these create one) ----

/** A sign-in style answer → the admin's profile with the session cookies, or the second step. */
function signInAnswer(result, remember) {
  if (result.status !== 200) return passOn(result)
  const data = result.data?.data ?? {}
  if (data.two_factor_required === true) {
    if (!isChallenge(data.challenge)) return json({ message: 'The sign-in failed. Please try again.' }, 502)
    return json({ twoFactorRequired: true, challenge: data.challenge, expiresAt: str(data.expires_at) ?? null })
  }
  if (!data.admin || !hasTokens(data.tokens)) return json({ message: 'The sign-in failed. Please try again.' }, 502)
  const profile = adminProfile(data.admin)
  // A limited session (tokens.scope "two_factor_setup"): the admin app shows only the setup screen.
  const limited = data.two_factor_setup_required === true || data.tokens.scope === 'two_factor_setup'
  return json({ ...profile, ...(limited && { twoFactorSetupRequired: true }) }, 200, sessionCookies(tokensOf(data.tokens), remember, ADMIN))
}

export const TWO_STEP_SESSION_ROUTES = {
  /** BuyNest accounts' admin sign-in: the password step (replaces the plain one in adminApi.js). */
  async 'POST login'(request) {
    const body = await readBody(request)
    const remember = body.remember === true
    const result = await laravel('/api/admin/v1/auth/login', { method: 'POST', request, body: { email: str(body.email), password: str(body.password), remember } })
    return signInAnswer(result, remember)
  },

  /** The second step: a code from the authenticator app, or a recovery code. */
  async 'POST two-factor'(request) {
    if (!realAccounts()) return json({ message: 'Not found.' }, 404)
    const body = await readBody(request)
    const remember = body.remember === true
    if (!isChallenge(body.challenge)) return invalid({ challenge: ['This sign-in has expired. Please sign in again.'] })
    const usesRecovery = body.recoveryCode !== undefined && body.code === undefined
    const code = usesRecovery ? null : sixDigits(body.code)
    const recovery = usesRecovery ? recoveryCode(body.recoveryCode) : null
    if (!usesRecovery && !code) return invalid({ code: ['Enter the 6-digit code from your authenticator app.'] })
    if (usesRecovery && !recovery) return invalid({ recoveryCode: ["That recovery code isn't right or was already used."] })
    const result = await laravel('/api/admin/v1/auth/two-factor', {
      method: 'POST',
      request,
      body: { challenge: body.challenge, ...(code ? { code } : { recovery_code: recovery }), remember },
    })
    return signInAnswer(result, remember)
  },
}

// ---- signed-in routes ----

const call = (path, ctx, options = {}) => laravel(`/api/admin/v1${path}`, { token: ctx.token, request: ctx.request, ...options })
const live = (handler) => (ctx) => (realData() ? handler(ctx) : liveOnly())
const accountsOnly = (handler) => (ctx) => (realAccounts() ? handler(ctx) : liveOnly())

function enrolment(data) {
  return {
    secret: str(data?.secret) ?? '',
    otpauthUrl: str(data?.otpauth_url) ?? '',
    // The server's own SVG; the admin app shows it as an <img>, which never runs scripts.
    qrSvg: typeof data?.qr_svg === 'string' && data.qr_svg.trimStart().startsWith('<') ? data.qr_svg : null,
  }
}
const codesOf = (data) => (Array.isArray(data?.recovery_codes) ? data.recovery_codes.filter((code) => typeof code === 'string') : [])

const SECURITY_ROUTES = {
  'POST me/two-factor': accountsOnly(async (ctx) => {
    const result = await call('/me/two-factor', ctx, { method: 'POST', body: {} })
    return result.status === 200 ? json(enrolment(result.data?.data)) : passOn(result)
  }),

  'POST me/two-factor/confirm': accountsOnly(async (ctx) => {
    const code = sixDigits((await readBody(ctx.request)).code)
    if (!code) return invalid({ code: ['Enter the 6-digit code your app shows now.'] })
    const result = await call('/me/two-factor/confirm', ctx, { method: 'POST', body: { code } })
    if (result.status !== 200) return passOn(result)
    const data = result.data?.data ?? {}
    const answer = { recoveryCodes: codesOf(data), ...(data.admin && { admin: adminProfile(data.admin) }) }
    // Confirmed with the limited setup session: the API signed it out and gave a full pair. Same "remember" as before.
    if (!hasTokens(data.tokens)) return json(answer)
    const remember = readCookies(ctx.request)[ADMIN.remember] === '1'
    return json(answer, 200, sessionCookies(tokensOf(data.tokens), remember, ADMIN))
  }),

  'POST me/two-factor/recovery-codes': accountsOnly(async (ctx) => {
    const { password } = await readBody(ctx.request)
    if (typeof password !== 'string' || !password || password.length > 200) return invalid({ password: ['Enter your password.'] })
    const result = await call('/me/two-factor/recovery-codes', ctx, { method: 'POST', body: { password } })
    return result.status === 200 ? json({ recoveryCodes: codesOf(result.data?.data) }) : passOn(result)
  }),

  'DELETE me/two-factor': accountsOnly(async (ctx) => {
    const body = await readBody(ctx.request)
    const errors = {}
    if (typeof body.password !== 'string' || !body.password || body.password.length > 200) errors.password = ['Enter your password.']
    // A current 6-digit code, or a recovery code.
    const code = sixDigits(body.code) ?? recoveryCode(body.code)
    if (!code) errors.code = ['Enter the 6-digit code your app shows now.']
    if (Object.keys(errors).length > 0) return invalid(errors)
    const result = await call('/me/two-factor', ctx, { method: 'DELETE', body: { password: body.password, code } })
    if (result.status !== 200) return passOn(result)
    return json({ ok: true, message: str(result.data?.message) ?? 'Two-step sign-in is off.', ...(result.data?.data && { admin: adminProfile(result.data.data) }) })
  }),

  'POST admins/:id/two-factor/reset': live(async (ctx) => {
    const result = await call(`/admins/${ctx.id}/two-factor/reset`, ctx, { method: 'POST', body: {} })
    if (result.status !== 200) return passOn(result)
    return json({ ok: true, message: str(result.data?.message) ?? 'Two-step sign-in was reset.', ...(result.data?.data && { admin: adminUser(result.data.data) }), live: true })
  }),

  'GET backups': live(async (ctx) => {
    const result = await call('/backups', ctx)
    if (result.status !== 200) return passOn(result)
    const meta = result.data?.meta ?? {}
    return json({
      backups: (Array.isArray(result.data?.data) ? result.data.data : []).filter((row) => isBackupName(row?.name)).map(backupFile),
      keepDays: Number.isInteger(meta.keep_days) ? meta.keep_days : null,
      schedule: str(meta.schedule) ?? null,
      timezone: str(meta.timezone) ?? null,
      disk: str(meta.disk) ?? null,
      running: meta.running === true,
      lastRun: meta.last_run ? backupRun(meta.last_run) : null,
      live: true,
    })
  }),

  'POST backups': live(async (ctx) => {
    // The API makes the backup while the request waits (up to 5 minutes): longer than laravel()'s 15 seconds.
    const result = await postLong('/api/admin/v1/backups', ctx, 330_000)
    if (![200, 201].includes(result.status)) return passOn(result)
    const run = backupRun(result.data?.data ?? {})
    return json({ backup: run, message: run.status === 'ok' && run.name ? `Backup ${run.name} is ready.` : 'The backup was started.', live: true }, 201)
  }),

  'POST backups/:id/download': live(async (ctx) => {
    const result = await call(`/backups/${ctx.id}/link`, ctx, { method: 'POST', body: {} })
    if (result.status !== 200) return passOn(result)
    // The API's relative signed URL; the browser gets this service's address for it, same query.
    const signed = signedPath(result.data?.data?.url, ctx.id)
    if (!signed) return json({ message: 'The download link could not be made. Please try again.' }, 502)
    return json({ url: `/api/admin/backups/${ctx.id}/file${signed.search}`, expiresAt: str(result.data?.data?.expires_at) ?? null })
  }),

  'GET backups/:id/file': live(async (ctx) => {
    if (!isSignedQuery(ctx.url.search)) return json({ message: 'This download link has expired. Create a new one.' }, 403)
    // The query string goes on unchanged: the signature covers the path and the query.
    return streamFromLaravel(`/api/admin/v1/backups/${ctx.id}/download${ctx.url.search}`, ctx, ctx.id)
  }),

  'GET reports/stock-alerts': live(async (ctx) => {
    const { searchParams } = ctx.url
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') ?? '25', 10) || 25, 1), 100)
    const skip = Math.max(Number.parseInt(searchParams.get('skip') ?? '0', 10) || 0, 0)
    const params = new URLSearchParams({ limit: String(limit), skip: String(skip) })
    const q = searchParams.get('q')?.trim().slice(0, 100)
    if (q) params.set('q', q)
    const result = await call(`/reports/stock-alerts?${params}`, ctx)
    if (result.status !== 200) return passOn(result)
    const meta = result.data?.meta ?? {}
    return json({
      products: (Array.isArray(result.data?.data) ? result.data.data : []).map(stockAlertRow),
      total: meta.total ?? 0,
      waitingTotal: meta.waiting_total ?? 0,
      notifiedLast30Days: meta.notified_last_30_days ?? 0,
      limit,
      skip,
      live: true,
    })
  }),
}

// ---- answers → the admin app's shapes ----

const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : null)

export const backupFile = (raw) => ({ name: raw.name, size: count(raw.size_bytes), createdAt: str(raw.created_at) ?? null })

export function backupRun(raw) {
  return {
    id: raw.id ?? null,
    status: ['running', 'ok', 'failed'].includes(raw.status) ? raw.status : null,
    trigger: str(raw.trigger) ?? null,
    name: isBackupName(raw.file_name) ? raw.file_name : null,
    size: count(raw.size_bytes),
    error: str(raw.error) ?? null,
    startedAt: str(raw.started_at) ?? null,
    finishedAt: str(raw.finished_at) ?? null,
    adminName: str(raw.admin?.name) ?? null,
  }
}

export function stockAlertRow(raw) {
  const product = raw?.product ?? {}
  return {
    productId: product.id ?? null,
    name: str(product.name) ?? '',
    sku: str(product.sku) ?? null,
    status: str(product.status) ?? null,
    stock: product.stock_quantity ?? 0,
    thumbnail: str(product.thumbnail_url) ?? null,
    hasVariants: product.has_variants === true,
    waiting: raw?.waiting ?? 0,
    variants: (Array.isArray(raw?.variants) ? raw.variants : []).map((variant) => ({
      id: variant.id,
      sku: str(variant.sku) ?? null,
      label: str(variant.label) ?? '',
      stock: variant.stock_quantity ?? 0,
      waiting: variant.waiting ?? 0,
    })),
    oldestAt: str(raw?.oldest_at) ?? null,
    newestAt: str(raw?.newest_at) ?? null,
  }
}

/** The API's signed link → its path and query, only if it is this backup's download route. */
function signedPath(url, name) {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url, 'http://api.invalid')
    if (parsed.pathname !== `/api/admin/v1/backups/${name}/download` || !isSignedQuery(parsed.search)) return null
    return { search: parsed.search }
  } catch {
    return null
  }
}

/*
 * The backup file, passed through as a stream (backups can be large: never
 * held in memory). Same shared-key headers as http.js's laravel(): the key
 * comes from this server's environment, never from the browser.
 */
const laravelBase = () => (process.env.BUYNEST_LARAVEL_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
function bffHeaders(request) {
  const key = process.env.BUYNEST_BFF_KEY
  if (!key) return {}
  const ip = clientIp(request)
  return { 'X-BuyNest-Bff': key, ...(ip && { 'X-Client-IP': ip }) }
}

/** A POST with an empty JSON body and a long wait. Resolves to { status, data } like laravel(). */
async function postLong(path, ctx, timeout) {
  try {
    const response = await fetch(`${laravelBase()}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}`, ...bffHeaders(ctx.request) },
      body: '{}',
      signal: AbortSignal.timeout(timeout),
    })
    return { status: response.status, data: await response.json().catch(() => ({})) }
  } catch {
    return { status: 502, data: { message: 'The server could not be reached. Please try again.' } }
  }
}

async function streamFromLaravel(path, ctx, name) {
  let response
  try {
    response = await fetch(`${laravelBase()}${path}`, {
      headers: { Accept: 'application/gzip, application/json', Authorization: `Bearer ${ctx.token}`, ...bffHeaders(ctx.request) },
      signal: AbortSignal.timeout(300_000),
    })
  } catch {
    return json({ message: 'The server could not be reached. Please try again.' }, 502)
  }
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || type.includes('application/json') || !response.body) {
    const data = await response.json().catch(() => ({}))
    return passOn({ status: response.ok ? 502 : response.status, data })
  }
  const length = response.headers.get('content-length')
  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${name}"`,
      ...(length && /^\d+$/.test(length) && { 'Content-Length': length }),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/**
 * The phase 9 routes in adminApi.js's matcher: { route, id } for one of them,
 * null for a malformed address of theirs (404), undefined when not theirs.
 */
export function matchSecurityRoute(method, segments) {
  const [first, second, third, fourth, ...rest] = segments
  if (first === 'me' && second === 'two-factor') {
    if (fourth !== undefined || rest.length > 0) return null
    if (third === undefined) return { route: SECURITY_ROUTES[`${method} me/two-factor`] }
    return ['confirm', 'recovery-codes'].includes(third) ? { route: SECURITY_ROUTES[`${method} me/two-factor/${third}`] } : null
  }
  if (first === 'admins' && third === 'two-factor') {
    return /^\d{1,9}$/.test(second ?? '') && fourth === 'reset' && rest.length === 0 ? { route: SECURITY_ROUTES[`${method} admins/:id/two-factor/reset`], id: second } : null
  }
  if (first === 'backups') {
    if (second === undefined) return { route: SECURITY_ROUTES[`${method} backups`] }
    if (!isBackupName(second) || fourth !== undefined || !['download', 'file'].includes(third)) return null
    return { route: SECURITY_ROUTES[`${method} backups/:id/${third}`], id: second }
  }
  if (first === 'reports' && second === 'stock-alerts') return third === undefined ? { route: SECURITY_ROUTES[`${method} reports/stock-alerts`] } : null
  return undefined
}
