// Phase 10 extras, end to end in a real browser: better search, PDF documents, PayPal, shipping table
// rates, gift cards, and visitor statistics with cookie consent. Nothing reaches PayPal or Google.
//
// The suite starts its own servers and stops them at the end (also on failure and Ctrl+C):
//   - a stand-in for PayPal's REST API on http://127.0.0.1:12121 (what PayPalGateway calls: OAuth token,
//     create order, capture, get order, refund, verify-webhook-signature), recording every request, and
//     its "approve page" on https://127.0.0.1:12122 (the storefront only follows https payment links; a
//     throwaway self-signed certificate is made with openssl, and the browser is told to accept it)
//   - a second Laravel API on :8011 with PayPal switched on through the process environment
//     (PAYPAL_CLIENT_ID/SECRET, PAYPAL_MODE=sandbox, PAYPAL_WEBHOOK_ID, PAYPAL_API_URL = the stand-in,
//     STOREFRONT_URL), which wins over backend/.env, so the usual API on :8000 keeps PayPal off
//   - a second storefront dev server on :5181 pointed at it (BUYNEST_LARAVEL_URL) and built with
//     VITE_ANALYTICS=ga4, so the cookie banner may appear once a measurement id is set
// Both APIs share the dev database. No .env file is changed.
//
// Google Analytics: the measurement id is set through the admin settings API only for the consent
// checks (and put back to empty at the end). Every browser request to googletagmanager.com,
// google-analytics.com, or analytics.google.com is answered by Playwright (page.route) with a small
// fake gtag.js that reports what it was asked to send to a fake "collect" endpoint, which is recorded.
//
// Left behind on purpose: orders, invoices, credit memos (like the other suites). Removed: table rates,
// test products, the PayPal webhook events and notifications; test gift cards are disabled (they can't
// be deleted); the measurement id is cleared; stock is put back.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PAYPAL_PORT = 12121
const APPROVE_PORT = 12122
const API_PORT = 8011
const STORE_PORT = 5181
const PORTS = [PAYPAL_PORT, APPROVE_PORT, API_PORT, STORE_PORT]
const API = `http://127.0.0.1:${API_PORT}`
const STORE = `http://localhost:${STORE_PORT}`
const APPROVE = `https://127.0.0.1:${APPROVE_PORT}`
const CLIENT_ID = 'e2e-paypal-client'
const CLIENT_SECRET = 'e2e-paypal-secret'
const WEBHOOK_ID = 'WH-E2E-LOCAL'
const ACCESS_TOKEN = 'A21-e2e-access-token'
const GA_ID = 'G-E2ETEST01'
const BACKEND = join(import.meta.dirname, '..', 'backend')
const FRONTEND = join(import.meta.dirname, '..', 'frontend')

// lib.mjs reads these when it loads: this suite's storefront and API, not the usual ones.
process.env.BASE_URL = STORE
process.env.LARAVEL_URL = API
const lib = await import('./lib.mjs')
const { ADMIN_USER, BASE, LARAVEL, SHOPPER, SHOPPER_2, adminSignIn, axeViolations, clearSavedCart, preserveStock, reporter, sidewaysOverflow, storefrontSignIn, visible, watchErrors } = lib

const report = reporter('extras: search, PDFs, PayPal (stand-in), table rates, gift cards, consent and GA4 (fake)')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const run = Date.now().toString(36)
let sequence = 0
const nextId = (prefix) => `${prefix}${run.toUpperCase()}${(++sequence).toString(36).toUpperCase().padStart(4, '0')}`

// ---------------------------------------------------------------- PayPal stand-in
/*
 * Just enough of PayPal's REST API for PayPalGateway, answering in PayPal's shapes.
 * `paypal` is shared with the checks: they read what was sent and set what the next answer is.
 */
const paypal = {
  tokens: 0, // OAuth token requests
  orders: new Map(), // PayPal order id → { id, body, headers, amount, custom_id, status, capture }
  created: [], // the order ids, in order
  captures: [], // { id, headers }
  refunds: [], // { captureId, body, headers, answer }
  verifications: [], // the verify-webhook-signature bodies
  verdict: 'SUCCESS', // what verify-webhook-signature answers
  refuseRefund: null, // the description PayPal gives for the next refund it refuses
  unauthorized: 0,
}
const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Paypal-Debug-Id': nextId('dbg') })
  res.end(JSON.stringify(body))
}
const paypalError = (res, status, name, issue, description) => sendJson(res, status, { name, message: 'The requested action could not be performed.', debug_id: nextId('dbg'), details: [{ issue, description }] })
const orderAnswer = (order) => ({
  id: order.id,
  intent: 'CAPTURE',
  status: order.status,
  purchase_units: [
    {
      reference_id: order.body.purchase_units?.[0]?.reference_id ?? 'default',
      custom_id: order.custom_id,
      amount: order.amount,
      ...(order.capture && { payments: { captures: [order.capture] } }),
    },
  ],
  links: [
    { rel: 'self', href: `http://127.0.0.1:${PAYPAL_PORT}/v2/checkout/orders/${order.id}`, method: 'GET' },
    ...(order.status === 'PAYER_ACTION_REQUIRED' ? [{ rel: 'payer-action', href: `${APPROVE}/checkoutnow?token=${order.id}`, method: 'GET' }] : []),
  ],
})

const paypalApi = createHttpServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  const path = new URL(req.url, 'http://stand-in').pathname
  const headers = { requestId: req.headers['paypal-request-id'] ?? null, authorization: req.headers.authorization ?? null }

  if (req.method === 'POST' && path === '/v1/oauth2/token') {
    const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
    if (headers.authorization !== basic || !/grant_type=client_credentials/.test(raw)) return sendJson(res, 401, { error: 'invalid_client', error_description: 'Client Authentication failed' })
    paypal.tokens++
    return sendJson(res, 200, { scope: 'https://uri.paypal.com/services/payments', access_token: ACCESS_TOKEN, token_type: 'Bearer', app_id: 'APP-E2E', expires_in: 32400, nonce: nextId('n') })
  }
  if (headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
    paypal.unauthorized++
    return sendJson(res, 401, { error: 'invalid_token', error_description: 'Token signature verification failed' })
  }
  const body = raw ? JSON.parse(raw) : null

  if (req.method === 'POST' && path === '/v2/checkout/orders') {
    const unit = body?.purchase_units?.[0] ?? {}
    const order = { id: nextId('PP'), body, headers, amount: unit.amount, custom_id: unit.custom_id, status: 'PAYER_ACTION_REQUIRED', capture: null }
    paypal.orders.set(order.id, order)
    paypal.created.push(order.id)
    return sendJson(res, 200, orderAnswer(order))
  }
  const capture = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/)
  if (req.method === 'POST' && capture) {
    const order = paypal.orders.get(decodeURIComponent(capture[1]))
    paypal.captures.push({ id: decodeURIComponent(capture[1]), headers })
    if (!order) return paypalError(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
    if (order.capture) return paypalError(res, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_CAPTURED', 'Order already captured.')
    if (order.status !== 'APPROVED') return paypalError(res, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_NOT_APPROVED', 'Payer has not yet approved the Order for payment.')
    order.status = 'COMPLETED'
    order.capture = { id: nextId('CAP'), status: 'COMPLETED', amount: order.amount, custom_id: order.custom_id, final_capture: true, create_time: new Date().toISOString() }
    return sendJson(res, 201, orderAnswer(order))
  }
  const get = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/)
  if (req.method === 'GET' && get) {
    const order = paypal.orders.get(decodeURIComponent(get[1]))
    return order ? sendJson(res, 200, orderAnswer(order)) : paypalError(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
  }
  const refund = path.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/)
  if (req.method === 'POST' && refund) {
    const captureId = decodeURIComponent(refund[1])
    if (paypal.refuseRefund) {
      const description = paypal.refuseRefund
      paypal.refuseRefund = null
      paypal.refunds.push({ captureId, body, headers, answer: null })
      return paypalError(res, 422, 'UNPROCESSABLE_ENTITY', 'REFUND_NOT_ALLOWED', description)
    }
    const answer = { id: nextId('RF'), status: 'COMPLETED', amount: body?.amount, links: [{ rel: 'up', href: `http://127.0.0.1:${PAYPAL_PORT}/v2/payments/captures/${captureId}`, method: 'GET' }] }
    paypal.refunds.push({ captureId, body, headers, answer })
    return sendJson(res, 201, answer)
  }
  if (req.method === 'POST' && path === '/v1/notifications/verify-webhook-signature') {
    paypal.verifications.push(body)
    return sendJson(res, 200, { verification_status: paypal.verdict })
  }
  return paypalError(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', `No stand-in for ${req.method} ${path}.`)
})

// The stand-in approve page: Approve → the order's return_url (+ token, PayerID), Cancel → its cancel_url (+ token).
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
const approvePageHandler = (req, res) => {
  const url = new URL(req.url, APPROVE)
  const order = paypal.orders.get(url.searchParams.get('token') ?? '')
  if (url.pathname !== '/checkoutnow' || !order) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('No such PayPal order.')
  }
  const context = order.body.payment_source?.paypal?.experience_context ?? {}
  const withToken = (target, extra = '') => `${target}${target.includes('?') ? '&' : '?'}token=${encodeURIComponent(order.id)}${extra}`
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PayPal stand-in</title></head>
<body><main><h1>PayPal stand-in</h1><p data-order="${escapeHtml(order.id)}">Pay $${escapeHtml(order.amount?.value)} ${escapeHtml(order.amount?.currency_code)} for ${escapeHtml(order.custom_id)}</p>
<button type="button" id="approve">Approve</button> <button type="button" id="cancel">Cancel</button></main>
<script>
document.getElementById('approve').onclick = async () => { await fetch('/approve?token=${encodeURIComponent(order.id)}', { method: 'POST' }); location.assign(${JSON.stringify(withToken(context.return_url ?? '/', '&PayerID=E2EPAYER'))}) }
document.getElementById('cancel').onclick = () => location.assign(${JSON.stringify(withToken(context.cancel_url ?? '/'))})
</script></body></html>`)
}
const approveServerHandler = (req, res) => {
  const url = new URL(req.url, APPROVE)
  if (req.method === 'POST' && url.pathname === '/approve') {
    const order = paypal.orders.get(url.searchParams.get('token') ?? '')
    if (order && order.status === 'PAYER_ACTION_REQUIRED') order.status = 'APPROVED'
    res.writeHead(204)
    return res.end()
  }
  return approvePageHandler(req, res)
}

// ---------------------------------------------------------------- Fake Google Analytics (browser-side only)
const GOOGLE_HOSTS = /(^|\.)googletagmanager\.com$|(^|\.)google-analytics\.com$|(^|\.)analytics\.google\.com$/
// What gtag.js would do, reduced to: report every command in the data layer (now and later) to "collect".
const FAKE_GTAG = `(function () {
  var id = new URL(document.currentScript.src).searchParams.get('id')
  function send(command) {
    var args = Array.prototype.slice.call(command)
    if (args[0] === 'js') return
    fetch('https://region1.google-analytics.com/g/collect?tid=' + encodeURIComponent(id) + '&cmd=' + encodeURIComponent(args[0]) + '&en=' + encodeURIComponent(String(args[1])), { method: 'POST', mode: 'no-cors', keepalive: true, body: JSON.stringify(args) })
  }
  var layer = (window.dataLayer = window.dataLayer || [])
  for (var i = 0; i < layer.length; i++) send(layer[i])
  var push = layer.push
  layer.push = function () {
    for (var j = 0; j < arguments.length; j++) send(arguments[j])
    return push.apply(layer, arguments)
  }
})()`
/** Routes every Google request of a browser context to the fake; returns the list of what was requested. */
async function fakeGoogle(context) {
  const seen = []
  await context.route(
    (url) => GOOGLE_HOSTS.test(url.hostname),
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      seen.push({ url: request.url(), host: url.hostname, path: url.pathname, cmd: url.searchParams.get('cmd'), en: url.searchParams.get('en'), body: request.postData() ?? '', page: request.frame()?.url?.() ?? '' })
      if (url.hostname.endsWith('googletagmanager.com') && url.pathname === '/gtag/js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_GTAG })
      return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' })
    },
  )
  return seen
}

// ---------------------------------------------------------------- Servers this suite starts and stops
const children = []
const servers = []
let certDir = null
let stopped = false
const portOpen = (port, host = '127.0.0.1') =>
  new Promise((resolve) => {
    const socket = connect(port, host)
    socket.setTimeout(1000)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
/** A child in its own process group, so stopping it stops what it started (php -S workers, esbuild). */
function start(name, command, args, options) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.output = ''
  const keep = (chunk) => {
    child.output = (child.output + chunk.toString()).slice(-4000)
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  child.name = name
  children.push(child)
  return child
}
const killGroup = (child, signal) => {
  try {
    process.kill(-child.pid, signal)
  } catch {
    // Already gone.
  }
}
const alive = (child) => {
  try {
    process.kill(-child.pid, 0)
    return true
  } catch {
    return false
  }
}
async function stopAll() {
  if (stopped) return
  stopped = true
  for (const child of children) killGroup(child, 'SIGTERM')
  for (let wait = 0; wait < 30 && children.some(alive); wait++) await new Promise((resolve) => setTimeout(resolve, 200))
  for (const child of children.filter(alive)) killGroup(child, 'SIGKILL')
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        }),
    ),
  )
  if (certDir) rmSync(certDir, { recursive: true, force: true })
}
process.on('exit', () => children.forEach((child) => killGroup(child, 'SIGKILL')))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n(${signal}: stopping the servers this suite started)`)
    await cleanup().catch(() => {})
    await stopAll()
    process.exit(130)
  })
}
async function waitFor(url, child, { tries = 120 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (child && child.exitCode !== null) throw new Error(`${child.name} exited: ${child.output.slice(-500)}`)
    if (await fetch(url, { headers: { Accept: 'application/json' } }).then(() => true, () => false)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url} did not start${child ? `: ${child.output.slice(-500)}` : ''}`)
}

// ---------------------------------------------------------------- Helpers
const api = async (path, { method = 'GET', token, body, raw = false } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Accept: raw ? 'application/pdf, application/json' : 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    })
    if (response.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, (Number(response.headers.get('retry-after')) || 5) * 1000))
      continue
    }
    if (raw) return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) }
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}
/** Runs PHP in the backend (local development only): reads and cleanup without an endpoint. */
function tinker(code) {
  const result = spawnSync('php', ['artisan', 'tinker', `--execute=${code}`], { cwd: BACKEND, encoding: 'utf8', timeout: 60_000 })
  if (result.status !== 0) throw new Error(`tinker failed: ${(result.stderr || result.stdout).trim().slice(0, 200)}`)
  return result.stdout.trim()
}
/** Every email to `email` after the id `after`, newest last (the test inbox only shows the latest one over HTTP). */
function mailsTo(email, after = 0) {
  const out = tinker(`echo json_encode(App\\Models\\DevMail::where('to', '${email.toLowerCase()}')->where('id', '>', ${Number(after)})->orderBy('id')->get(['id', 'subject', 'text']));`)
  try {
    return JSON.parse(out.slice(out.indexOf('[')))
  } catch {
    return []
  }
}
async function waitForMail(email, match, { after = 0, tries = 20 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const found = mailsTo(email, after).filter((mail) => match.test(mail.subject))
    if (found.length) return found.at(-1)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}
const lastMailId = (email) => mailsTo(email).at(-1)?.id ?? 0
const cents = (value) => Math.round(Number(value) * 100)
const money = (value) => `$${Number(value).toFixed(2)}`
const CODE_PATTERN = /\b[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}\b/

const DRESS = 166 // Tartan Dress ($39.99, minimum order 1, plenty of stock)
const made = { products: [], rates: [], giftCards: new Set(), orders: new Set(), notificationLinks: new Set() }
const buyerEmail = `gc.buyer.${run}@example.com`
const recipientEmail = `gc.recipient.${run}@example.com`
const recipientName = `Robin ${run}`
const gaGuestEmail = `ga.guest.${run}@example.com`
const paypalGuestEmail = `pp.guest.${run}@example.com`

let browser
let restoreStock = async () => 0
let owner
let gaSet = false
const errors = []
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const cardOf = async (id) => (await admin$(`/gift-cards/${id}`)).body?.data

// ---------------------------------------------------------------- Start
try {
  for (const port of PORTS) {
    if (await portOpen(port)) throw new Error(`port ${port} is already in use: stop whatever runs there (an earlier run?)`)
  }
  certDir = mkdtempSync(join(tmpdir(), 'buynest-e2e-paypal-'))
  const cert = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { encoding: 'utf8' })
  if (cert.status !== 0) throw new Error(`openssl could not make a test certificate: ${cert.stderr.slice(0, 200)}`)
  const approvePage = createHttpsServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, approveServerHandler)
  servers.push(paypalApi, approvePage)
  await new Promise((resolve) => paypalApi.listen(PAYPAL_PORT, '127.0.0.1', resolve))
  await new Promise((resolve) => approvePage.listen(APPROVE_PORT, '127.0.0.1', resolve))

  const laravel = start(`Laravel API (:${API_PORT})`, 'php', ['artisan', 'serve', '--host=127.0.0.1', `--port=${API_PORT}`, '--no-reload'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PAYPAL_CLIENT_ID: CLIENT_ID,
      PAYPAL_CLIENT_SECRET: CLIENT_SECRET,
      PAYPAL_MODE: 'sandbox',
      PAYPAL_WEBHOOK_ID: WEBHOOK_ID,
      PAYPAL_API_URL: `http://127.0.0.1:${PAYPAL_PORT}`,
      STOREFRONT_URL: STORE,
      APP_URL: API,
      PHP_CLI_SERVER_WORKERS: '4',
    },
  })
  await waitFor(`${API}/api/v1/store`, laravel)
  const store = start(`storefront (:${STORE_PORT})`, process.execPath, [join(FRONTEND, 'node_modules/vite/bin/vite.js'), '--port', String(STORE_PORT), '--strictPort'], {
    cwd: FRONTEND,
    env: { ...process.env, BUYNEST_LARAVEL_URL: API, VITE_ANALYTICS: 'ga4' },
  })
  await waitFor(`${STORE}/api/catalog/store`, store)

  // ---------- The isolated setup really is isolated ----------
  const apiStore = (await api('/api/v1/store')).body?.data
  log(apiStore?.paypal_payments === 'paypal', `API on :${API_PORT} has PayPal on (paypal_payments "${apiStore?.paypal_payments}")`)
  const usualStore = await fetch('http://127.0.0.1:8000/api/v1/store').then((r) => r.json(), () => null)
  log(!usualStore || usualStore.data?.paypal_payments === 'manual', `the usual API on :8000 keeps PayPal off (paypal_payments "${usualStore?.data?.paypal_payments ?? 'not running'}")`)
  const storeSettings = await fetch(`${STORE}/api/catalog/store`).then((r) => r.json(), () => null)
  const storePaypal = storeSettings?.data?.paypal_payments ?? storeSettings?.data?.paypalPayments ?? storeSettings?.paypal_payments
  log(storePaypal === 'paypal', `storefront on :${STORE_PORT} talks to :${API_PORT} (its /api/catalog/store says paypal_payments "${storePaypal}")`)

  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  restoreStock = await preserveStock()
  browser = await lib.launch()
  await runChecks()
} catch (error) {
  log(false, `suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  await cleanup().catch((error) => log(false, `cleanup failed: ${error.message.split('\n')[0]}`))
  await browser?.close().catch(() => {})
  await stopAll()
  const stillOpen = []
  for (const port of PORTS) if (await portOpen(port)) stillOpen.push(port)
  log(stillOpen.length === 0, `every server this suite started is stopped (ports ${PORTS.join(', ')} closed${stillOpen.length ? `; still open: ${stillOpen.join(', ')}` : ''})`)
  log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
  report.done()
}

// ---------------------------------------------------------------- Checks
async function runChecks() {
  const axe = async (page, name) => {
    const violations = await axeViolations(page)
    log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
  }
  const phone = async (page, name, prepare) => {
    const size = page.viewportSize()
    await page.setViewportSize({ width: 390, height: 844 })
    if (prepare) await prepare()
    await page.waitForTimeout(300)
    const overflow = await sidewaysOverflow(page)
    log(overflow <= 0, `390px: ${name} fits (overflow ${overflow}px)`)
    await page.setViewportSize(size)
  }
  /** One part of the suite: a failure is reported and the next part still runs. */
  async function part(name, body) {
    try {
      await body()
    } catch (error) {
      log(false, `${name} stopped early: ${error.message.split('\n')[0]}`)
    }
  }
  async function newPage(viewport = { width: 1280, height: 900 }) {
    // ignoreHTTPSErrors: the stand-in approve page's certificate is self-signed.
    const context = await browser.newContext({ viewport, bypassCSP: true, ignoreHTTPSErrors: true, acceptDownloads: true })
    context.setDefaultTimeout(15000)
    return watchErrors(await context.newPage(), errors)
  }
  async function adminPage() {
    const admin = await newPage({ width: 1440, height: 900 })
    await adminSignIn(admin, ADMIN_USER)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    return admin
  }
  async function closeMiniCart(page) {
    const miniCart = page.getByRole('dialog', { name: /Your cart/ })
    if (await visible(miniCart, 3000)) {
      await page.keyboard.press('Escape')
      await miniCart.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }
  async function addProduct(page, id, quantity = 1) {
    await page.goto(`${BASE}/products/${id}`, { waitUntil: 'networkidle' })
    const details = page.locator('.product-details')
    for (let more = 1; more < quantity; more++) await details.getByRole('button', { name: 'Increase quantity' }).click()
    await details.getByRole('button', { name: /add to cart/i }).first().click()
    await closeMiniCart(page)
  }
  /** Fills what is still empty at checkout (contact, then the shipping or billing address). */
  async function fillCheckout(page, { email, country, prefix = 'shipping', first = 'Zelda', last = 'Quint' } = {}) {
    await page.locator('[name="email"]').waitFor()
    if (email) await page.locator('[name="email"]').fill(email)
    const phoneField = page.locator('[name="phone"]')
    if (!(await phoneField.inputValue())) await phoneField.fill('+1 555 010 2030')
    const fields = { firstName: first, lastName: last, line1: '77 Privacy Lane', city: 'Nowhereville', state: 'Oregon', postalCode: '29112' }
    for (const [name, value] of Object.entries(fields)) {
      const input = page.locator(`[name="${prefix}.${name}"]`)
      if ((await input.count()) > 0 && !(await input.inputValue())) await input.fill(value)
    }
    if (country) await page.locator(`[name="${prefix}.country"]`).selectOption(country)
  }
  const placeButton = (page) => page.getByRole('button', { name: /^Place order · |^Continue to PayPal$/ })
  async function placeOrder(page) {
    const button = placeButton(page)
    await button.waitFor({ timeout: 20000 })
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking prices/.test(b.textContent)), null, { timeout: 20000 }).catch(() => {})
    await button.click()
    await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 })
    const number = new URL(page.url()).pathname.split('/').pop()
    made.orders.add(number)
    return number
  }
  /** Waits for a download started by `click` and returns { name, bytes }. */
  async function download(page, click) {
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()])
    const path = await file.path()
    return { name: file.suggestedFilename(), bytes: path ? readFileSync(path) : Buffer.alloc(0) }
  }
  const isPdf = (file) => file.bytes.subarray(0, 4).toString('latin1') === '%PDF'
  const hero = (page, text) => page.locator('.order-page__hero h1').filter({ hasText: text })
  const delivery = (page) => page.locator('fieldset').filter({ has: page.locator('legend', { hasText: /^Delivery$/ }) })
  /** The delivery choices the checkout shows: { Standard: "$6.50", ... }. */
  const deliveryPrices = async (page) =>
    Object.fromEntries(
      await delivery(page)
        .locator('.choice-card')
        .evaluateAll((cards) => cards.map((card) => [card.querySelector('.choice-card__label')?.textContent.trim(), card.querySelector('.choice-card__aside')?.textContent.trim()])),
    )
  /** Waits until the delivery step shows what `expected` describes (the server reprices after each change). */
  async function waitForDelivery(page, expected) {
    let prices = {}
    for (let attempt = 0; attempt < 40; attempt++) {
      prices = await deliveryPrices(page)
      if (JSON.stringify(prices) === JSON.stringify(expected)) return prices
      await page.waitForTimeout(250)
    }
    return prices
  }

  // A simple test product (800 g, $9) for the table rates and gift card orders.
  const boxName = `E2E Rate Box ${run}`
  const box = await admin$('/products', {
    method: 'POST',
    body: { name: boxName, category: 'home-decoration', price: 9, stock_quantity: 50, status: 'active', sku: `E2E-RATE-${run}`.toUpperCase(), brand: 'NestWorks', weight: 800 },
  })
  const BOX = box.body?.data?.id
  if (BOX) made.products.push(BOX)
  log(box.status === 201 && box.body?.data?.weight === 800, `a test product weighing 800 g at $9.00 (#${BOX}, weight ${box.body?.data?.weight})`)

  // ---------- 1. Search: typo correction, exact SKU, suggestions ----------
  await part('search', async () => {
    const page = await newPage()
    const terms = async (term) => ((await admin$(`/search-terms?search=${encodeURIComponent(term)}&per_page=100`)).body?.data ?? []).find((item) => item.term === term)
    const titles = () => page.locator('.product-card__title').allInnerTexts()

    // Suggestions are not search terms.
    const suggestTerm = `zq${run}`
    const ihponeBefore = (await terms('ihpone'))?.hits ?? 0
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const search = page.getByRole('combobox').first()
    const suggestRequests = []
    page.on('request', (request) => {
      if (/suggest=1|suggest%3D1/.test(request.url())) suggestRequests.push(request.url())
    })
    await search.fill('ihpone')
    const suggestions = page.getByRole('listbox', { name: 'Search suggestions' }).first()
    log(await visible(suggestions), 'search box: suggestions appear for "ihpone"')
    log(await visible(suggestions.getByText(/iPhone/i).first(), 5000), 'the suggestions are corrected to iPhone products')
    await search.fill(suggestTerm)
    await page.waitForTimeout(1200)
    await search.fill('')
    log(suggestRequests.length > 0, `the box asked for suggestions (${suggestRequests.length} requests)`)
    log(!(await terms(suggestTerm)) && ((await terms('ihpone'))?.hits ?? 0) === ihponeBefore, `suggestions record no search terms ("ihpone" still ${ihponeBefore} hits, "${suggestTerm}" not recorded)`)

    // A typo: corrected, iPhones first.
    await page.goto(`${BASE}/products?q=ihpone`, { waitUntil: 'networkidle' })
    const correction = page.locator('.listing__correction')
    log(await visible(correction), 'results page for "ihpone": a correction note')
    log(/Showing results for iphone\./.test(await correction.innerText()), `"${(await correction.innerText()).replace(/\s+/g, ' ')}"`)
    await page.locator('.product-card').first().waitFor()
    const typoTitles = await titles()
    log(typoTitles.length > 0 && typoTitles.slice(0, 3).every((title) => /iphone/i.test(title)), `iPhone results first (${typoTitles.slice(0, 3).join(' | ')})`)
    log(await visible(page.getByRole('heading', { name: 'Results for "iphone"', level: 1 })), 'the heading names the corrected word')
    await axe(page, 'search results with a correction')
    await page.getByRole('link', { name: 'Search instead for ihpone' }).click()
    await page.waitForURL(/exact=1/)
    await page.waitForLoadState('networkidle')
    const exactUrl = new URL(page.url())
    log(exactUrl.searchParams.get('q') === 'ihpone' && exactUrl.searchParams.get('exact') === '1', `"Search instead for" asks for the exact word (${exactUrl.search})`)
    log(!(await visible(correction, 2000)) && (await visible(page.getByRole('heading', { name: 'Results for "ihpone"', level: 1 }))), 'no correction on the exact search')
    const exactTitles = await titles()
    log(!exactTitles.some((title) => /iphone/i.test(title)), `the exact word finds no iPhones (${exactTitles.length} results)`)

    // A real search (the results page) is recorded, unlike the suggestions for the same word.
    await page.goto(`${BASE}/products?q=${suggestTerm}`, { waitUntil: 'networkidle' })
    log((await terms(suggestTerm))?.hits === 1, `the results page records what the shopper typed ("${suggestTerm}": ${(await terms(suggestTerm))?.hits} hit)`)

    // An exact SKU ranks first.
    const sku = 'SMA-APP-IPH-122'
    await page.goto(`${BASE}/products?q=${sku}`, { waitUntil: 'networkidle' })
    await page.locator('.product-card').first().waitFor()
    const skuTitles = await titles()
    log(skuTitles[0] === 'iPhone 6', `the exact SKU ${sku} ranks its product first ("${skuTitles[0]}")`)
    await page.context().close()
  })

  // ---------- 2. Shipping table rates ----------
  await part('shipping table rates', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    await admin.getByRole('link', { name: 'Table rates', exact: true }).click()
    await admin.getByRole('heading', { name: 'Shipping table rates', level: 1 }).waitFor()
    log(true, 'Settings → Table rates opens the table rates page')
    const before = (await admin$('/shipping-rates')).body?.data ?? []
    log(before.length === 0, `no table rates before the suite (${before.length})`)

    async function addRate(method, values) {
      await admin.getByRole('button', { name: new RegExp(`^Add an? ${method} rate$`, 'i') }).click()
      const dialog = admin.getByRole('dialog')
      await dialog.waitFor()
      for (const [label, value] of Object.entries(values)) await dialog.getByLabel(label, { exact: true }).fill(value)
      return dialog
    }
    // Express: Canada only, up to 2 kg, $30.
    let dialog = await addRate('express', { Country: 'Canada', 'Weight from (g)': '0', 'Weight up to (g)': '2000', 'Price (USD)': '30' })
    await axe(admin, 'admin add-rate dialog')
    await dialog.getByRole('button', { name: 'Add rate' }).click()
    await dialog.waitFor({ state: 'hidden' })
    // Standard, any country, by order value.
    dialog = await addRate('standard', { Country: '*', 'Order value from (USD)': '0', 'Order value up to (USD)': '20', 'Price (USD)': '6.50' })
    await dialog.getByRole('button', { name: 'Add rate' }).click()
    await dialog.waitFor({ state: 'hidden' })
    dialog = await addRate('standard', { Country: '*', 'Order value from (USD)': '20', 'Price (USD)': '3.25' })
    await dialog.getByRole('button', { name: 'Add rate' }).click()
    await dialog.waitFor({ state: 'hidden' })
    const rows = (await admin$('/shipping-rates')).body?.data ?? []
    for (const row of rows) made.rates.push(row.id)
    const express = rows.find((row) => row.method === 'express')
    const standard = rows.filter((row) => row.method === 'standard')
    log(rows.length === 3 && express?.country === 'Canada' && express?.max_weight_grams === 2000 && express?.price === '30.00', `express rate saved: ${express?.country}, ${express?.min_weight_grams}–${express?.max_weight_grams} g, $${express?.price}`)
    log(standard.length === 2 && standard.every((row) => row.country === '*') && standard[0]?.max_subtotal === '20.00' && standard[1]?.max_subtotal === null && standard[1]?.price === '3.25', `standard rates saved: * $0–20 → $${standard[0]?.price}, * $20+ → $${standard[1]?.price}`)
    log(await visible(admin.getByRole('table', { name: /Express rates/ })), 'the page lists the express rate')
    log(await visible(admin.getByText(/No table rates: Next day keeps its flat price/)), 'Next day keeps its flat price (no rows)')
    await axe(admin, 'admin table rates')

    // Check a cart: the admin's own answer.
    const check = admin.locator('section[aria-labelledby="rates-check"]')
    async function checkCart(country, weight, subtotal) {
      await check.getByLabel('Country').fill(country)
      await check.getByLabel('Cart weight (g)').fill(String(weight))
      await check.getByLabel('Order value (USD)').fill(String(subtotal))
      await check.getByRole('button', { name: 'Check prices' }).click()
      await check.locator('table caption').filter({ hasText: `${weight.toLocaleString('en-US')} g` }).waitFor()
      return Object.fromEntries(await check.locator('tbody tr').evaluateAll((rows) => rows.map((row) => [row.querySelector('th').textContent.trim(), row.querySelector('td').textContent.trim()])))
    }
    const light = await checkCart('Canada', 800, 9)
    log(light.Standard === '$6.50' && light.Express === '$30.00' && light['Next day'] === '$24.99', `Check a cart (Canada, 800 g, $9): ${JSON.stringify(light)}`)
    await axe(admin, 'admin check a cart (result)')
    const heavy = await checkCart('Canada', 2400, 27)
    log(heavy.Standard === '$3.25' && heavy.Express === 'Not offered' && heavy['Next day'] === '$24.99', `Check a cart (Canada, 2400 g, $27): ${JSON.stringify(heavy)}`)
    const usa = await checkCart('United States', 800, 9)
    log(usa.Express === 'Not offered' && usa.Standard === '$6.50', `Check a cart (United States, 800 g, $9): ${JSON.stringify(usa)}`)
    await phone(admin, 'admin table rates')

    // The store's delivery step offers exactly those prices.
    const shop = await newPage()
    await addProduct(shop, BOX)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(shop, { email: `rates.${run}@example.com`, country: 'United States' })
    const usPrices = await waitForDelivery(shop, { Standard: '$6.50', 'Next day': '$24.99' })
    log(JSON.stringify(usPrices) === JSON.stringify({ Standard: '$6.50', 'Next day': '$24.99' }), `store, United States, 1 × 800 g: ${JSON.stringify(usPrices)} (no Express)`)
    await shop.locator('[name="shipping.country"]').selectOption('Canada')
    const caPrices = await waitForDelivery(shop, { Standard: '$6.50', Express: '$30.00', 'Next day': '$24.99' })
    log(JSON.stringify(caPrices) === JSON.stringify({ Standard: '$6.50', Express: '$30.00', 'Next day': '$24.99' }), `store, Canada, 1 × 800 g ($9): ${JSON.stringify(caPrices)}`)
    await delivery(shop).locator('.choice-card').filter({ hasText: 'Express' }).click()
    log(await visible(shop.locator('.cart-summary').getByText('$30.00').first(), 5000), 'choosing Express puts $30.00 in the summary')
    await addProduct(shop, BOX, 2)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(shop, { country: 'Canada' })
    const heavyPrices = await waitForDelivery(shop, { Standard: '$3.25', 'Next day': '$24.99' })
    log(JSON.stringify(heavyPrices) === JSON.stringify({ Standard: '$3.25', 'Next day': '$24.99' }), `store, Canada, 3 × 800 g ($27): ${JSON.stringify(heavyPrices)} (Express hidden)`)
    await shop.context().close()

    // Delete one rate in the page; the rest through the API.
    await admin.getByRole('button', { name: 'Delete express rate 1' }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await admin.getByRole('dialog').waitFor({ state: 'hidden' })
    const afterDelete = (await admin$('/shipping-rates')).body?.data ?? []
    log(!afterDelete.some((row) => row.method === 'express') && (await visible(admin.getByText(/No table rates: Express keeps its flat price/))), 'Delete removes the express rate (Express back to its flat price)')
    for (const id of made.rates.splice(0)) if (afterDelete.some((row) => row.id === id)) await admin$(`/shipping-rates/${id}`, { method: 'DELETE' })
    log(((await admin$('/shipping-rates')).body?.data ?? []).length === 0, 'the test rates are deleted')
    await admin.context().close()
  })

  // ---------- 3. Gift cards: product, purchase, issue, redeem, refund, balance, admin ----------
  let gift = null // { id, code, last4 }
  let fullCoverOrder = null // SHOPPER's order paid in full by the gift card (invoiced at once)
  let giftPurchaseOrder = null // the guest's gift card purchase (invoiced in the admin)
  let partialOrder = null // SHOPPER's order paid partly by the card (refunded in the admin)
  let GIFT = null
  await part('gift cards', async () => {
    const admin = await adminPage()
    log(await visible(admin.getByRole('link', { name: 'Gift cards' })), 'admin menu: Gift cards')

    // A gift card product: Draft, then Active.
    const productName = `E2E Gift Card ${run}`
    await admin.goto(`${BASE}/admin/products/new`, { waitUntil: 'networkidle' })
    await admin.getByLabel('Name').fill(productName)
    await admin.getByLabel('Brand').fill('NestWorks')
    await admin.getByLabel('Category').selectOption('home-decoration')
    await admin.getByLabel('Price (USD)').fill('50')
    await admin.getByLabel('Units in stock').fill('0')
    await admin.getByLabel('Status').selectOption('draft')
    await admin.getByLabel('Product type').selectOption('gift_card')
    await admin.getByLabel('Amount choices (USD)').fill('25, 50, 100')
    await axe(admin, 'admin product form (gift card)')
    await admin.getByRole('button', { name: 'Add product' }).click()
    await admin.waitForURL(/\/admin\/products\/\d+$/, { timeout: 15000 })
    GIFT = Number(admin.url().split('/').pop())
    if (Number.isInteger(GIFT)) made.products.push(GIFT)
    const draft = (await admin$(`/products/${GIFT}`)).body?.data
    log(draft?.status === 'draft' && draft?.type === 'gift_card' && JSON.stringify(draft?.gift_card?.amounts) === JSON.stringify(['25.00', '50.00', '100.00']), `gift card product created as a Draft (#${GIFT}, ${draft?.type}, amounts ${JSON.stringify(draft?.gift_card?.amounts)})`)
    const hidden = await api(`/api/v1/products/${GIFT}`)
    log(hidden.status === 404, `the Draft isn't in the store (${hidden.status})`)
    await admin.getByLabel('Status').selectOption('active')
    await admin.getByRole('button', { name: 'Save changes' }).click()
    log(await visible(admin.getByRole('status').filter({ hasText: 'It is live in the store.' })), 'set Active: "It is live in the store."')

    // A guest buys a $50 card, cash on delivery.
    const shop = await newPage()
    await shop.goto(`${BASE}/products/${GIFT}`, { waitUntil: 'networkidle' })
    const form = shop.locator('form.gift-card-form')
    log(await visible(form), 'the store shows the gift card form on the product page')
    log(!(await visible(shop.getByText(/out of stock/i), 1500)), 'a gift card is never "out of stock" (stock 0)')
    await form.getByRole('button', { name: /Add to cart/ }).click()
    log(await visible(form.getByText("Enter the recipient's name.")), 'Add to cart without a recipient: "Enter the recipient\'s name."')
    await axe(shop, 'gift card product page (with errors)')
    await phone(shop, 'the gift card product page')
    await form.getByRole('radio', { name: '$50.00' }).check()
    await form.getByLabel("Recipient's name").fill(recipientName)
    await form.getByLabel("Recipient's email").fill(recipientEmail)
    await form.getByLabel('Message (optional)').fill('Happy birthday from the e2e suite')
    await form.getByRole('button', { name: 'Add to cart · $50.00' }).click()
    await closeMiniCart(shop)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    log(await visible(shop.getByText("Gift cards are sent by email, so there's no delivery address or shipping charge.")), 'checkout for gift cards only: no delivery address or shipping')
    log((await delivery(shop).count()) === 0, 'no delivery choices')
    await fillCheckout(shop, { email: buyerEmail, prefix: 'billing', country: 'United States' })
    await shop.getByRole('radio', { name: /Cash on delivery/ }).check()
    log(await visible(shop.getByRole('button', { name: 'Place order · $50.00' })), 'Place order · $50.00 (no shipping, no tax)')
    giftPurchaseOrder = await placeOrder(shop)
    const placed = await orderOf(giftPurchaseOrder)
    const line = placed?.items?.[0]
    log(placed?.totals?.total === '50.00' && (placed?.shipping_method?.id ?? placed?.shipping_method) === 'none' && line?.gift_card?.recipient_email === recipientEmail, `gift card order ${giftPurchaseOrder}: $${placed?.totals?.total}, shipping "${placed?.shipping_method?.id ?? placed?.shipping_method}", for ${line?.gift_card?.recipient_email}`)
    log((placed?.gift_cards_issued ?? []).length === 0 && !(await waitForMail(recipientEmail, /gift card/i, { tries: 2 })), 'no card is issued before the order is paid')
    await shop.context().close()

    // The admin invoices it: the card is issued and emailed.
    const buyerBefore = lastMailId(buyerEmail)
    await admin.goto(`${BASE}/admin/orders/${giftPurchaseOrder}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Invoice', exact: true }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
    await admin.getByRole('dialog').waitFor({ state: 'hidden' })
    let issued = []
    for (let attempt = 0; attempt < 20 && issued.length === 0; attempt++) {
      issued = (await orderOf(giftPurchaseOrder))?.gift_cards_issued ?? []
      if (!issued.length) await admin.waitForTimeout(250)
    }
    log(issued.length === 1 && issued[0].amount === '50.00' && issued[0].recipient_email === recipientEmail, `invoiced: one $50 card issued (ending ${issued[0]?.last4})`)
    if (issued[0]) made.giftCards.add(issued[0].id)
    const received = await waitForMail(recipientEmail, /gift card/i)
    const code = received?.text.match(CODE_PATTERN)?.[0] ?? null
    log(Boolean(code) && code.replace(/-/g, '').endsWith(issued[0]?.last4 ?? '?') && /50\.00/.test(received?.text ?? ''), `the recipient's email has the code and amount ("${received?.subject}", code …${code?.slice(-4)})`)
    const copy = await waitForMail(buyerEmail, /gift card was sent/i, { after: buyerBefore })
    log(Boolean(copy) && !CODE_PATTERN.test(copy.text) && copy.text.includes(issued[0]?.last4 ?? '?') && copy.text.includes(recipientEmail), `the buyer's copy has no code, only the last 4 ("${copy?.subject}")`)
    gift = { id: issued[0]?.id, code, last4: issued[0]?.last4 }
    await axe(admin, 'admin order with an issued gift card')

    if (!gift.code) throw new Error('no gift card code to redeem')

    // Redeem: a partial cover (card + cash on delivery).
    const customer = await newPage()
    await storefrontSignIn(customer, SHOPPER)
    await addProduct(customer, DRESS, 2)
    await customer.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(customer)
    await customer.getByRole('radio', { name: /Cash on delivery/ }).check()
    const redeem = customer.locator('.gift-card-redeem')
    await redeem.getByLabel('Gift card').fill('ABCD-EFGH-JKMN-PQRS')
    await redeem.getByRole('button', { name: 'Apply' }).click()
    log(await visible(redeem.getByText("This gift card code isn't valid.")), 'checkout: an unknown code gets "This gift card code isn\'t valid."')
    await redeem.getByLabel('Gift card').fill(gift.code.toLowerCase().replace(/-/g, ' '))
    await redeem.getByRole('button', { name: 'Apply' }).click()
    log(await visible(redeem.getByText(new RegExp(`Gift card •••• ${gift.last4} — pays \\$50\\.00`)), 20000), 'checkout: the card (typed in lower case with spaces) pays $50.00')
    await customer.getByText(/Your gift card pays \$50\.00; the remaining/).waitFor()
    log(await visible(customer.getByRole('radio', { name: /Cash on delivery/ })), 'partial cover: the other payment is still asked for')
    await axe(customer, 'checkout with a gift card (partial)')
    await phone(customer, 'checkout with a gift card')
    partialOrder = await placeOrder(customer)
    const partial = await orderOf(partialOrder)
    log(partial?.totals?.gift_card === '50.00' && cents(partial?.totals?.amount_due) === cents(partial?.totals?.total) - 5000 && partial?.payment_method === 'cod', `order ${partialOrder}: card $${partial?.totals?.gift_card}, still due $${partial?.totals?.amount_due} by ${partial?.payment_method}`)
    log((await cardOf(gift.id))?.balance === '0.00', `the card's balance is taken at once (${(await cardOf(gift.id))?.balance})`)

    // Refund: money goes back to the card first.
    await admin.goto(`${BASE}/admin/orders/${partialOrder}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Invoice', exact: true }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
    await admin.getByRole('dialog').waitFor({ state: 'hidden' })
    await admin.getByRole('button', { name: 'Refund', exact: true }).waitFor()
    await admin.getByRole('button', { name: 'Refund', exact: true }).click()
    let refund = admin.getByRole('dialog')
    log(await visible(refund.getByText(/Money goes back to the gift card first/)), 'the refund dialog says the gift card is refunded first')
    await refund.getByLabel(/Quantity of .* to refund/).first().fill('1')
    const split = refund.locator('.refund-split')
    const refundButton = refund.getByRole('button', { name: /^Refund \$/ })
    await refundButton.waitFor()
    const refundTotal = (await refundButton.innerText()).match(/\$[\d,.]+/)?.[0]
    await split.waitFor()
    const splitText = (await split.innerText()).replace(/\s+/g, ' ')
    log(splitText.includes(`Back to the gift card ending ${gift.last4} ${refundTotal}`) && /\$0\.00/.test(splitText), `the split: ${refundTotal} back to the card, $0.00 by the other method ("${splitText}")`)
    await axe(admin, 'admin refund dialog with the gift card split')
    await refund.getByRole('button', { name: /^Refund \$/ }).click()
    await refund.waitFor({ state: 'hidden' })
    const memo = (await orderOf(partialOrder))?.credit_memos?.[0]
    log(memo?.gift_card_refund === memo?.total && cents(memo?.total) > 0 && memo?.other_refund === '0.00', `credit memo ${memo?.number}: $${memo?.gift_card_refund} of $${memo?.total} to the card, $${memo?.other_refund} otherwise`)
    const refilled = (await cardOf(gift.id))?.balance
    log(refilled === memo?.total, `the card has $${refilled} again`)

    // Redeem: a full cover (payment method "gift card", nothing else to pay).
    await addProduct(customer, BOX)
    await customer.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(customer)
    await redeem.getByLabel('Gift card').fill(gift.code)
    await redeem.getByRole('button', { name: 'Apply' }).click()
    log(await visible(customer.getByText('Your gift card pays for the whole order: no other payment is needed.'), 20000), 'full cover: "no other payment is needed"')
    log((await customer.getByRole('radio', { name: /Cash on delivery/ }).count()) === 0, 'no payment choices are shown')
    log(await visible(customer.getByRole('button', { name: 'Place order · $0.00' })), 'Place order · $0.00')
    await axe(customer, 'checkout with a gift card (full cover)')
    fullCoverOrder = await placeOrder(customer)
    const full = await orderOf(fullCoverOrder)
    log(full?.payment_method === 'gift_card' && full?.payment_status === 'paid' && full?.status === 'processing' && full?.invoices?.length === 1, `order ${fullCoverOrder}: paid by gift card at once (${full?.payment_method}, ${full?.payment_status}, ${full?.status}, ${full?.invoices?.length} invoice)`)
    const remaining = (await cardOf(gift.id))?.balance
    log(cents(remaining) === cents(refilled) - cents(full?.totals?.total), `the card has $${remaining} left ($${refilled} − $${full?.totals?.total})`)
    await customer.context().close()

    // The balance page.
    const balance = await newPage()
    await balance.goto(`${BASE}/gift-cards/balance`, { waitUntil: 'networkidle' })
    await balance.getByLabel('Gift card code').fill(gift.code)
    await balance.getByRole('button', { name: 'Check balance' }).click()
    log(await visible(balance.getByText(`Balance: ${money(remaining)}. It never expires.`)), `balance page: "Balance: ${money(remaining)}. It never expires."`)
    await axe(balance, 'gift card balance page')
    await phone(balance, 'the gift card balance page')
    await balance.getByLabel('Gift card code').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ')
    await balance.getByRole('button', { name: 'Check balance' }).click()
    log(await visible(balance.getByRole('alert').filter({ hasText: "This gift card code isn't valid." })), 'an unknown code gets the generic "This gift card code isn\'t valid."')

    // The admin: list, detail, adjust, disable.
    await admin.goto(`${BASE}/admin/gift-cards`, { waitUntil: 'networkidle' })
    await admin.getByLabel('Search gift cards').fill(recipientEmail)
    await admin.getByRole('button', { name: 'Search' }).click()
    const row = admin.locator('tbody tr').filter({ hasText: recipientEmail })
    await row.first().waitFor()
    log((await row.count()) === 1 && (await row.innerText()).includes(`Gift card ending ${gift.last4}`) && (await row.innerText()).includes(money(remaining)), 'admin list: the card, found by the recipient email, with its balance')
    await axe(admin, 'admin gift cards list')
    await phone(admin, 'the admin gift cards list')
    await row.getByRole('link', { name: `Gift card ending ${gift.last4}` }).click()
    await admin.getByRole('heading', { name: `Gift card ending ${gift.last4}`, level: 1 }).waitFor()
    const history = admin.getByRole('region', { name: 'Balance changes' })
    log((await history.innerText()).includes(partialOrder) && (await history.innerText()).includes(fullCoverOrder), 'detail: the history lists both orders')
    await axe(admin, 'admin gift card detail')
    await phone(admin, 'the admin gift card detail')
    await admin.getByRole('button', { name: 'Adjust balance' }).click()
    const adjust = admin.getByRole('dialog')
    await adjust.getByLabel('Amount (USD)').fill('-1.00')
    await adjust.getByLabel('Reason').fill(`e2e adjustment ${run}`)
    await axe(admin, 'admin adjust dialog')
    await adjust.getByRole('button', { name: 'Save adjustment' }).click()
    const after = money(Number(remaining) - 1)
    log(await visible(admin.getByText(`Balance reduced by $1.00. Gift card ending ${gift.last4} now has ${after}.`)), `adjust −$1.00: "now has ${after}"`)
    log((await cardOf(gift.id))?.transactions?.[0]?.note === `e2e adjustment ${run}`, 'the adjustment is in the history with its reason')
    await admin.getByRole('button', { name: 'Disable' }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Disable' }).click()
    await admin.getByRole('dialog').waitFor({ state: 'hidden' })
    await admin.getByRole('button', { name: 'Adjust balance' }).waitFor({ state: 'hidden' }).catch(() => {}) // the page refetches the card
    log((await cardOf(gift.id))?.status === 'disabled' && !(await admin.getByRole('button', { name: 'Adjust balance' }).isVisible()), 'Disable: the card is disabled (no more adjustments)')
    await balance.getByLabel('Gift card code').fill(gift.code)
    await balance.getByRole('button', { name: 'Check balance' }).click()
    log(await visible(balance.getByRole('alert').filter({ hasText: "This gift card code isn't valid." })), 'a disabled card gets the same generic message')
    await balance.context().close()
    await admin.context().close()
  })

  // ---------- 4. PDF invoices and credit memos ----------
  await part('PDF documents', async () => {
    // The customer, from the order page.
    if (fullCoverOrder) {
      const page = await newPage()
      await storefrontSignIn(page, SHOPPER)
      await page.goto(`${BASE}/account/orders/${fullCoverOrder}`, { waitUntil: 'networkidle' })
      const invoice = (await orderOf(fullCoverOrder))?.invoices?.[0]?.number
      const button = page.getByRole('button', { name: `Download PDF of invoice ${invoice}` })
      await button.waitFor()
      const file = await download(page, () => button.click())
      log(isPdf(file) && file.name === `${invoice}.pdf`, `customer order page: "Download PDF" saves ${file.name} (${file.bytes.length} bytes, starts %PDF: ${isPdf(file)})`)
      await axe(page, 'account order page with Download PDF')
      await page.context().close()
    } else log(false, 'customer PDF skipped: no gift-card-paid order')

    // A guest, with the order email, from the tracking page.
    if (giftPurchaseOrder) {
      const invoice = (await orderOf(giftPurchaseOrder))?.invoices?.[0]?.number
      const page = await newPage()
      await page.goto(`${BASE}/track-order`, { waitUntil: 'networkidle' })
      await page.getByLabel('Order number').fill(giftPurchaseOrder)
      await page.getByLabel('Email').fill(buyerEmail.toUpperCase())
      await page.getByRole('button', { name: 'Find my order' }).click()
      const button = page.getByRole('button', { name: `Download PDF of invoice ${invoice}` })
      await button.waitFor()
      const file = await download(page, () => button.click())
      log(isPdf(file) && file.name === `${invoice}.pdf`, `guest tracking page (email in capitals): "Download PDF" saves ${file.name} (starts %PDF: ${isPdf(file)})`)
      const wrong = await page.evaluate(
        async ([number, inv]) => {
          const response = await fetch(`/api/shop/orders/${number}/invoices/${inv}.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/pdf, application/json' }, body: JSON.stringify({ email: 'someone.else@example.com' }) })
          return { status: response.status, type: response.headers.get('content-type') }
        },
        [giftPurchaseOrder, invoice],
      )
      log(wrong.status === 404 && !/pdf/.test(wrong.type ?? ''), `a wrong email through the store is refused (${wrong.status}, ${wrong.type})`)
      const direct = await api(`/api/v1/orders/${giftPurchaseOrder}/invoices/${invoice}.pdf?email=someone.else%40example.com`)
      log(direct.status === 404 && direct.body?.message === "We couldn't find an order with that number and email.", `…and by the API ("${direct.body?.message}")`)
      const headers = await api(`/api/v1/orders/${giftPurchaseOrder}/invoices/${invoice}.pdf?email=${encodeURIComponent(buyerEmail)}`, { raw: true })
      log(headers.status === 200 && headers.headers.get('content-type') === 'application/pdf' && headers.headers.get('content-disposition') === `attachment; filename="${invoice}.pdf"` && /no-store/.test(headers.headers.get('cache-control') ?? ''), `API answer: application/pdf, attachment "${invoice}.pdf", ${headers.headers.get('cache-control')}`)
      await page.goto(`${BASE}/track-order`, { waitUntil: 'networkidle' })
      await page.getByLabel('Order number').fill(giftPurchaseOrder)
      await page.getByLabel('Email').fill('someone.else@example.com')
      await page.getByRole('button', { name: 'Find my order' }).click()
      log(await visible(page.getByText(/couldn't find an order/i)), 'tracking with a wrong email shows no order (so no PDF)')
      await page.context().close()
    } else log(false, 'guest PDF skipped: no gift card purchase order')

    // The admin: invoice and credit memo.
    const admin = await adminPage()
    const invoice = fullCoverOrder ? (await orderOf(fullCoverOrder))?.invoices?.[0]?.number : null
    const memo = partialOrder ? (await orderOf(partialOrder))?.credit_memos?.[0]?.number : null
    if (invoice) {
      await admin.goto(`${BASE}/admin/invoices/${invoice}`, { waitUntil: 'networkidle' })
      const link = admin.getByRole('link', { name: `Download PDF of invoice ${invoice}` })
      await link.waitFor()
      const file = await download(admin, () => link.click())
      log(isPdf(file) && file.name === `${invoice}.pdf`, `admin invoice page: Download PDF saves ${file.name} (starts %PDF: ${isPdf(file)})`)
      await axe(admin, 'admin invoice page')
    }
    if (memo) {
      await admin.goto(`${BASE}/admin/credit-memos/${memo}`, { waitUntil: 'networkidle' })
      const link = admin.getByRole('link', { name: `Download PDF of credit memo ${memo}` })
      await link.waitFor()
      const file = await download(admin, () => link.click())
      log(isPdf(file) && file.name === `${memo}.pdf`, `admin credit memo page: Download PDF saves ${file.name} (starts %PDF: ${isPdf(file)})`)
    }
    if (!invoice || !memo) log(false, `admin PDFs skipped: invoice ${invoice}, credit memo ${memo}`)
    const unknown = await admin$('/invoices/INV-0.pdf')
    log(unknown.status === 404 && unknown.body?.message === 'Invoice not found.', `admin: an unknown invoice PDF → 404 "${unknown.body?.message}"`)
    await admin.context().close()
    // The dev inbox keeps subject, text, and List-Unsubscribe only, not attachments: the PDF attached to the
    // invoice email is checked by the backend tests (DocumentPdfTest), not here.
    console.log('(note: the test inbox does not record attachments, so the invoice email\'s PDF attachment is not checked in the browser)')
  })

  // ---------- 5. PayPal ----------
  let paypalPaid = null // { number, captureId }
  await part('PayPal', async () => {
    const page = await newPage()
    await storefrontSignIn(page, SHOPPER)
    await addProduct(page, DRESS)
    await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(page)
    await page.getByRole('radio', { name: /^PayPal/ }).check()
    const go = page.getByRole('button', { name: 'Continue to PayPal' })
    log(await visible(go), 'checkout with PayPal: the button reads "Continue to PayPal"')
    log(await visible(page.getByText(/Next you'll approve the payment on PayPal's site/)), "checkout explains the shopper approves on PayPal's site")
    await axe(page, 'checkout (PayPal on)')
    const tokensBefore = paypal.tokens
    await go.click()
    await page.waitForURL((url) => url.href.startsWith(`${APPROVE}/checkoutnow?token=`), { timeout: 20000 })
    const ppId = new URL(page.url()).searchParams.get('token')
    const sent = paypal.orders.get(ppId)
    const number = sent?.custom_id
    made.orders.add(number)
    const order = await orderOf(number)
    log(Boolean(sent && order), `placing the order sends the browser to the stand-in approve page (${number}, PayPal order ${ppId})`)
    log(paypal.tokens > tokensBefore || paypal.tokens > 0, `an OAuth token was asked for with the client id and secret (${paypal.tokens} token requests)`)
    log(order?.status === 'pending_payment' && order?.payment_status === 'unpaid', `the order waits for its payment (${order?.status}, ${order?.payment_status})`)
    const unit = sent?.body?.purchase_units?.[0] ?? {}
    const context = sent?.body?.payment_source?.paypal?.experience_context ?? {}
    log(sent?.body?.intent === 'CAPTURE' && unit.amount?.value === order?.totals?.total && unit.amount?.currency_code === 'USD', `PayPal order: intent CAPTURE, $${unit.amount?.value} ${unit.amount?.currency_code} (order total $${order?.totals?.total})`)
    log(unit.custom_id === number && /BN-/.test(unit.description ?? ''), `custom_id ${unit.custom_id}, "${unit.description}"`)
    log(context.return_url === `${STORE}/order-confirmation/${number}?payment=success&provider=paypal` && context.cancel_url === `${STORE}/order-confirmation/${number}?payment=cancelled&provider=paypal`, `return and cancel URLs back to the store (${context.return_url})`)
    log(context.user_action === 'PAY_NOW' && context.shipping_preference === 'NO_SHIPPING', 'PAY_NOW, NO_SHIPPING')
    log(new RegExp(`^order-${order?.id}-paypal-1$`).test(sent?.headers.requestId ?? '') && paypal.unauthorized === 0, `PayPal-Request-Id "${sent?.headers.requestId}", every call with the Bearer token`)

    await page.getByRole('button', { name: 'Approve' }).click()
    await page.waitForURL((url) => url.pathname === `/order-confirmation/${number}` && url.searchParams.get('token') === ppId)
    log(await visible(hero(page, 'Payment received — thank you'), 25000), 'back from PayPal: the store captures and shows "Payment received — thank you"')
    const capture = paypal.captures.find((item) => item.id === ppId)
    log(Boolean(capture) && capture.headers.requestId === `capture-${ppId}`, `the API captured it (POST /v2/checkout/orders/${ppId}/capture, request id ${capture?.headers.requestId})`)
    const paid = await orderOf(number)
    const captureId = paypal.orders.get(ppId)?.capture?.id
    log(paid?.payment_status === 'paid' && paid?.status === 'processing' && paid?.invoices?.length === 1 && /PayPal/.test(paid?.invoices?.[0]?.note ?? ''), `paid and invoiced ("${paid?.invoices?.[0]?.note}")`)
    log(paid?.payment?.provider === 'paypal' && paid?.payment?.reference === captureId && paid?.payment?.dashboard_url === `https://www.sandbox.paypal.com/activity/payment/${captureId}`, `payment: paypal, capture ${paid?.payment?.reference}, ${paid?.payment?.dashboard_url}`)
    await axe(page, 'confirmation (PayPal paid)')
    paypalPaid = { number, captureId }
    await page.context().close()

    // Webhooks: a FAILURE verification is refused; a verified duplicate does nothing.
    const event = (id) => JSON.stringify({ id, event_version: '1.0', create_time: new Date().toISOString(), resource_type: 'capture', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: captureId, status: 'COMPLETED', amount: { value: paid?.totals?.total, currency_code: 'USD' }, custom_id: number } })
    const headers = { 'Content-Type': 'application/json', 'PayPal-Transmission-Id': nextId('tx'), 'PayPal-Transmission-Time': new Date().toISOString(), 'PayPal-Transmission-Sig': 'e2e-signature', 'PayPal-Cert-Url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-e2e', 'PayPal-Auth-Algo': 'SHA256withRSA' }
    paypal.verdict = 'FAILURE'
    const refused = await fetch(`${BASE}/api/payments/paypal/webhook`, { method: 'POST', headers, body: event(`WH-E2E-${run}-1`) })
    const refusedBody = await refused.json().catch(() => null)
    const verification = paypal.verifications.at(-1)
    log(refused.status === 400 && refusedBody?.message === 'Invalid PayPal signature.', `a webhook PayPal answers FAILURE for, through the store: ${refused.status} "${refusedBody?.message}"`)
    log(verification?.webhook_id === WEBHOOK_ID && verification?.transmission_id === headers['PayPal-Transmission-Id'] && verification?.webhook_event?.id === `WH-E2E-${run}-1`, 'the API asked PayPal to verify it with the webhook id and the forwarded headers')
    paypal.verdict = 'SUCCESS'
    const first = await fetch(`${API}/api/v1/payments/paypal/webhook`, { method: 'POST', headers, body: event(`WH-E2E-${run}-2`) }).then((r) => r.json())
    const again = await fetch(`${API}/api/v1/payments/paypal/webhook`, { method: 'POST', headers, body: event(`WH-E2E-${run}-2`) }).then((r) => r.json())
    log(first?.result === 'already_paid' && again?.result === 'duplicate' && (await orderOf(number))?.invoices?.length === 1, `a verified completed-capture event for the paid order: "${first?.result}", the same again: "${again?.result}" (still one invoice)`)

    // Cancel on PayPal → Pay now.
    const guest = await newPage()
    await addProduct(guest, DRESS)
    await guest.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(guest, { email: paypalGuestEmail })
    await guest.getByRole('radio', { name: /^PayPal/ }).check()
    await guest.getByRole('button', { name: 'Continue to PayPal' }).click()
    await guest.waitForURL((url) => url.href.startsWith(`${APPROVE}/checkoutnow?token=`), { timeout: 20000 })
    const secondId = new URL(guest.url()).searchParams.get('token')
    const guestNumber = paypal.orders.get(secondId)?.custom_id
    made.orders.add(guestNumber)
    await guest.getByRole('button', { name: 'Cancel' }).click()
    await guest.waitForURL((url) => url.pathname === `/order-confirmation/${guestNumber}` && url.searchParams.get('payment') === 'cancelled')
    log(await visible(hero(guest, 'Payment not completed')), `guest Cancel on PayPal (${guestNumber}): "Payment not completed"`)
    const payNow = guest.getByRole('button', { name: 'Pay now' })
    log(await visible(payNow), '"Pay now" is offered')
    log(paypal.captures.every((item) => item.id !== secondId) && (await orderOf(guestNumber))?.payment_status === 'unpaid', 'nothing was captured')
    await axe(guest, 'confirmation (PayPal cancelled)')
    await payNow.click()
    await guest.waitForURL((url) => url.href.startsWith(`${APPROVE}/checkoutnow?token=`), { timeout: 20000 })
    log(new URL(guest.url()).searchParams.get('token') === secondId, 'Pay now goes back to the approve page of the still-open PayPal order')
    await guest.context().close()

    // The admin: PayPal, Sandbox, capture id; refused refund, then a refund through PayPal.
    const admin = await adminPage()
    const row = (label) => admin.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
    await admin.goto(`${BASE}/admin/orders/${number}`, { waitUntil: 'networkidle' })
    await row('Paid through').waitFor()
    log(/PayPal/.test(await row('Paid through').innerText()) && (await row('Paid through').getByText('Sandbox').isVisible()), `admin order ${number}: paid through PayPal, "Sandbox"`)
    const reference = row('Capture ID').getByRole('link')
    log((await row('Capture ID').innerText()).includes(captureId) && (await reference.getAttribute('href')) === `https://www.sandbox.paypal.com/activity/payment/${captureId}`, `Capture ID ${captureId} links to the PayPal sandbox dashboard`)
    await axe(admin, 'admin order (PayPal payment)')
    paypal.refuseRefund = 'The stand-in refuses this refund (e2e).'
    await admin.getByRole('button', { name: 'Refund', exact: true }).click()
    let dialog = admin.getByRole('dialog')
    log(await visible(dialog.getByText(/goes back through PayPal/)), 'the refund dialog says the money goes back through PayPal')
    await dialog.getByLabel(/Quantity of .* to refund/).first().fill('1')
    await dialog.getByRole('button', { name: /^Refund \$/ }).click()
    log(await visible(dialog.getByText('PayPal refused the refund: The stand-in refuses this refund (e2e).')), "a refused refund shows PayPal's message")
    const unchanged = await orderOf(number)
    log(paypal.refunds.at(-1)?.answer === null && unchanged?.credit_memos?.length === 0 && unchanged?.payment_status === 'paid', `…and nothing is saved (${unchanged?.credit_memos?.length} credit memos)`)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'hidden' })
    const refundsBefore = paypal.refunds.length
    await admin.getByRole('button', { name: 'Refund', exact: true }).click()
    dialog = admin.getByRole('dialog')
    await dialog.getByLabel(/Quantity of .* to refund/).first().fill('1')
    await dialog.getByRole('button', { name: /^Refund \$/ }).click()
    log(await visible(admin.getByText(/PayPal is returning the money to the customer/)), 'the refund succeeds: "PayPal is returning the money to the customer"')
    const refunded = await orderOf(number)
    const memo = refunded?.credit_memos?.[0]
    const call = paypal.refunds.slice(refundsBefore)[0]
    log(call?.captureId === captureId && call?.body?.amount?.value === memo?.total && call?.body?.amount?.currency_code === 'USD', `the stand-in got POST /v2/payments/captures/${call?.captureId}/refund for $${call?.body?.amount?.value} (memo $${memo?.total})`)
    log(/^memo-order-\d+-1-\d+$/.test(call?.headers.requestId ?? '') && memo?.refund_reference === call?.answer?.id, `request id ${call?.headers.requestId}; the credit memo keeps PayPal's refund id (${memo?.refund_reference})`)
    await admin.context().close()
  })

  // ---------- 6. Cookie consent and GA4 (fake Google) ----------
  await part('consent and GA4', async () => {
    const set = await admin$('/settings', { method: 'PATCH', body: { analytics: { ga4_measurement_id: GA_ID } } })
    gaSet = true
    log(set.status === 200 && (await api('/api/v1/store')).body?.data?.ga4_measurement_id === GA_ID, `measurement id ${GA_ID} set in the admin settings (GET /store answers it)`)
    const csp = await import(pathToFileURL(join(FRONTEND, 'vite.config.js')).href).then((module) => module.buildContentSecurityPolicy, () => null)
    if (csp) {
      const on = csp({ analytics: 'ga4' })
      const off = csp({})
      log(/script-src[^;]*https:\/\/www\.googletagmanager\.com/.test(on) && /connect-src[^;]*https:\/\/\*\.google-analytics\.com/.test(on) && !/googletagmanager|google-analytics/.test(off), 'the built CSP allows Google only with VITE_ANALYTICS=ga4')
    } else log(false, 'could not load buildContentSecurityPolicy from vite.config.js')

    const page = await newPage()
    // First visit to this store's dev server after many other pages: under a full run its first
    // "network idle" can take longer than the 15 s default (seen once in run-all, never alone).
    page.setDefaultNavigationTimeout(45000)
    const seen = await fakeGoogle(page.context())
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const banner = page.locator('section.cookie-consent')
    log(await visible(banner), 'the cookie banner appears')
    log(await visible(banner.getByRole('heading', { name: 'Cookies and visitor statistics' })), 'with its heading')
    await axe(page, 'home with the cookie banner')
    await phone(page, 'the cookie banner')
    await page.goto(`${BASE}/products/${DRESS}`, { waitUntil: 'networkidle' })
    log(seen.length === 0 && (await page.locator('script[src*="googletagmanager"]').count()) === 0, `before a choice nothing goes to Google (${seen.length} requests, no gtag script)`)
    await banner.getByRole('button', { name: 'Reject' }).click()
    await banner.waitFor({ state: 'hidden' })
    await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' })
    const consent = (await page.context().cookies()).find((cookie) => cookie.name === 'buynest_consent')
    log(consent?.value === 'v1.statistics=denied' && consent.expires * 1000 - Date.now() > 170 * 86400_000, `Reject: kept in the buynest_consent cookie (${consent?.value}, ${Math.round((consent?.expires * 1000 - Date.now()) / 86400_000)} days)`)
    log(!(await visible(banner, 1500)) && seen.length === 0, `after Reject: no banner on reload, still nothing to Google (${seen.length})`)

    // The footer's "Cookie settings" reopens it; Statistics starts off.
    await page.getByRole('button', { name: 'Cookie settings' }).click()
    log(await visible(banner), 'the footer\'s "Cookie settings" reopens the banner')
    log(await page.evaluate(() => document.activeElement?.textContent === 'Cookies and visitor statistics'), 'focus moves to its heading')
    const statistics = banner.getByLabel('Statistics')
    log((await statistics.count()) === 1 && !(await statistics.isChecked()), 'Settings: "Statistics" is off')
    await axe(page, 'cookie settings')
    await statistics.check()
    await banner.getByRole('button', { name: 'Save choices' }).click()
    await banner.waitFor({ state: 'hidden' })
    const loaded = async (event) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (seen.some((item) => item.cmd === 'event' && item.en === event)) return true
        await page.waitForTimeout(250)
      }
      return false
    }
    log(await loaded('page_view'), 'statistics on: gtag.js loads (from the fake) and a page_view is sent')
    const script = seen.find((item) => item.path === '/gtag/js')
    log(script?.url === `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`, `gtag.js asked for with the measurement id (${script?.url})`)
    const commands = seen.filter((item) => item.cmd === 'consent').map((item) => JSON.parse(item.body))
    log(commands[0]?.[1] === 'default' && commands[0]?.[2]?.analytics_storage === 'denied' && commands[0]?.[2]?.ad_storage === 'denied' && commands[1]?.[1] === 'update' && commands[1]?.[2]?.analytics_storage === 'granted' && !('ad_storage' in (commands[1]?.[2] ?? {})), 'Consent Mode v2: everything denied by default, then only analytics_storage granted')

    // The shopping events.
    await page.goto(`${BASE}/products/${DRESS}`, { waitUntil: 'networkidle' })
    log(await loaded('view_item'), 'view_item on the product page')
    await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
    await closeMiniCart(page)
    log(await loaded('add_to_cart'), 'add_to_cart')
    await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    log(await loaded('begin_checkout'), 'begin_checkout')
    await fillCheckout(page, { email: gaGuestEmail })
    await page.getByRole('radio', { name: /Cash on delivery/ }).check()
    const gaOrder = await placeOrder(page)
    log(await loaded('purchase'), `purchase on the confirmation page (${gaOrder})`)
    const purchase = JSON.parse(seen.find((item) => item.en === 'purchase')?.body ?? '[]')[2] ?? {}
    const placedTotal = (await orderOf(gaOrder))?.totals?.total
    log(purchase.transaction_id === gaOrder && purchase.currency === 'USD' && purchase.value === Number(placedTotal) && purchase.items?.[0]?.item_id === String(DRESS), `purchase: ${purchase.transaction_id}, ${purchase.value} ${purchase.currency}, item ${purchase.items?.[0]?.item_id}`)
    const views = seen.filter((item) => item.en === 'page_view').map((item) => JSON.parse(item.body)[2])
    log(views.length >= 3 && views.every((view) => !String(view?.page_location ?? '').includes('?')), `page_view sends paths without query strings (${views.length} page views)`)
    const everything = seen.map((item) => `${item.url}\n${item.body}`).join('\n').toLowerCase()
    const personal = [gaGuestEmail, 'zelda', 'quint', 'privacy lane', 'nowhereville', '29112', '555 010 2030', '@']
    const leaked = personal.filter((value) => everything.includes(value.toLowerCase()))
    log(leaked.length === 0, `no email, name, phone, or address in anything sent to Google (${seen.length} requests checked${leaked.length ? `; found ${leaked.join(', ')}` : ''})`)
    await axe(page, 'confirmation with statistics on')

    // The admin is never tracked (same browser, consent given).
    const before = seen.length
    await adminSignIn(page, ADMIN_USER)
    await page.getByRole('heading', { name: 'Overview' }).waitFor()
    await page.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' })
    await page.goto(`${BASE}/admin/gift-cards`, { waitUntil: 'networkidle' })
    log(seen.length === before && (await page.locator('script[src*="googletagmanager"]').count()) === 0 && !(await visible(page.locator('section.cookie-consent'), 1000)), `the admin sends nothing to Google and shows no banner (${seen.length - before} requests)`)
    await page.context().close()

    // A new visitor: Settings → Accept all.
    const other = await newPage()
    const seen2 = await fakeGoogle(other.context())
    await other.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const banner2 = other.locator('section.cookie-consent')
    await banner2.getByRole('button', { name: 'Settings' }).click()
    log(!(await banner2.getByLabel('Statistics').isChecked()) && (await other.evaluate(() => document.activeElement?.type === 'checkbox')), 'another visitor: Settings shows Statistics off, with the focus on it')
    log(seen2.length === 0, 'nothing sent while choosing')
    await banner2.getByRole('button', { name: 'Accept all' }).click()
    let accepted = false
    for (let attempt = 0; attempt < 40 && !accepted; attempt++) {
      accepted = seen2.some((item) => item.path === '/gtag/js') && seen2.some((item) => item.en === 'page_view')
      if (!accepted) await other.waitForTimeout(250)
    }
    log(accepted, 'Accept all: gtag.js loads and a page_view is sent')
    await other.context().close()
  })
}

// ---------------------------------------------------------------- Cleanup
async function cleanup() {
  if (!owner) return
  const problems = []
  const attempt = async (name, body) => {
    try {
      await body()
    } catch (error) {
      problems.push(`${name}: ${error.message.split('\n')[0]}`)
    }
  }
  await attempt('measurement id', async () => {
    if (gaSet || (await api('/api/v1/store')).body?.data?.ga4_measurement_id) await admin$('/settings', { method: 'PATCH', body: { analytics: { ga4_measurement_id: null } } })
  })
  await attempt('table rates', async () => {
    for (const id of made.rates) await admin$(`/shipping-rates/${id}`, { method: 'DELETE' })
  })
  await attempt('gift cards', async () => {
    const found = (await admin$(`/gift-cards?search=${encodeURIComponent(run)}&per_page=100`)).body?.data ?? []
    for (const card of found) made.giftCards.add(card.id)
    for (const id of made.giftCards) {
      if ((await admin$(`/gift-cards/${id}`)).body?.data?.status === 'active') await admin$(`/gift-cards/${id}`, { method: 'PATCH', body: { status: 'disabled' } })
    }
  })
  const numbers = [...made.orders].filter(Boolean)
  await attempt('unpaid PayPal orders', async () => {
    for (const number of numbers) {
      const order = (await admin$(`/orders/${number}`)).body?.data
      if (order?.status === 'pending_payment') await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
    }
  })
  await attempt('products', async () => {
    // Deleted products keep their category for past orders; parked as Drafts first, like catalog.mjs.
    for (const id of made.products) {
      await admin$(`/products/${id}`, { method: 'PATCH', body: { status: 'draft' } })
      await admin$(`/products/${id}`, { method: 'DELETE' })
    }
  })
  await attempt('webhook events, notifications, PayPal token', () => {
    const links = numbers.map((number) => `'/orders/${number}'`).join(',') || "''"
    tinker(
      `$ids = App\\Models\\AdminNotification::where('type', 'payment_problem')->whereIn('link', [${links}])->pluck('id');` +
        ` DB::table('admin_notification_reads')->whereIn('notification_id', $ids)->delete(); App\\Models\\AdminNotification::whereIn('id', $ids)->delete();` +
        ` DB::table('payment_events')->where('provider', 'paypal')->where('id', 'like', 'WH-E2E-${run}-%')->delete();` +
        ` Cache::forget('buynest.paypal.token.'.hash('sha256', 'http://127.0.0.1:${PAYPAL_PORT}|${CLIENT_ID}'));`,
    )
  })
  await attempt('search terms', async () => {
    for (const term of (await admin$(`/search-terms?search=${encodeURIComponent(run)}&per_page=100`)).body?.data ?? []) await admin$(`/search-terms/${term.id}`, { method: 'DELETE' })
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  const leftRates = (await admin$('/shipping-rates')).body?.data?.filter((row) => made.rates.includes(row.id)) ?? []
  const leftProducts = ((await admin$(`/products?search=${encodeURIComponent(run)}`)).body?.data ?? []).length
  const leftCards = ((await admin$(`/gift-cards?search=${encodeURIComponent(run)}&status=active`)).body?.data ?? []).length
  const ga = (await api('/api/v1/store')).body?.data?.ga4_measurement_id
  log(
    problems.length === 0 && leftRates.length === 0 && leftProducts === 0 && leftCards === 0 && ga === null,
    `cleanup: measurement id empty, table rates deleted, test gift cards disabled, test products removed, unpaid PayPal orders cancelled, webhook events and notifications removed, stock put back (orders stay)${problems.length || leftRates.length || leftProducts || leftCards || ga ? ` — left: ${[...problems, `${leftRates.length} rates`, `${leftProducts} products`, `${leftCards} active cards`, `ga ${ga}`].join('; ')}` : ''}`,
  )
}
