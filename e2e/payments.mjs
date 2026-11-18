// Phase 8: card payments through Stripe Checkout, end to end in a real browser, WITHOUT contacting Stripe.
//
// The suite starts its own servers and stops them at the end (also on failure and Ctrl+C):
//   - a stand-in for Stripe's API on http://127.0.0.1:12111 (what StripeGateway calls: checkout
//     sessions, session expire, refunds), recording every request, and its "payment page" on
//     https://127.0.0.1:12112 (the storefront only follows https payment links; a throwaway
//     self-signed certificate is made with openssl, and the browser is told to accept it)
//   - a second Laravel API on :8010 with Stripe switched on through the process environment
//     (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_API_URL = the stand-in, STOREFRONT_URL), which
//     wins over backend/.env, so the usual API on :8000 and the other suites keep Stripe off
//   - a second storefront dev server on :5180 pointed at it (BUYNEST_LARAVEL_URL in the process
//     environment wins over frontend/.env.local: vite.config.js only fills in names that are unset)
// Both APIs share the dev database. No .env file is changed.
//
// Webhooks are signed here the way Stripe signs them (HMAC-SHA256 of "{t}.{raw body}") and sent through
// the store's /api/payments/stripe/webhook, like Stripe would. Orders, invoices, and credit memos stay;
// the suite cancels its unpaid orders, puts stock back, and removes its notifications and webhook events.
import { spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STRIPE_PORT = 12111
const PAY_PAGE_PORT = 12112
const API_PORT = 8010
const STORE_PORT = 5180
const API = `http://127.0.0.1:${API_PORT}`
const STORE = `http://localhost:${STORE_PORT}`
const PAY_PAGE = `https://127.0.0.1:${PAY_PAGE_PORT}`
const SECRET_KEY = 'sk_test_e2e'
const WEBHOOK_SECRET = 'whsec_e2e_local'
const BACKEND = join(import.meta.dirname, '..', 'backend')
const FRONTEND = join(import.meta.dirname, '..', 'frontend')

// lib.mjs reads these when it loads: this suite's storefront and API, not the usual ones.
process.env.BASE_URL = STORE
process.env.LARAVEL_URL = API
const lib = await import('./lib.mjs')
const { ADMIN_USER, BASE, LARAVEL, SHOPPER, SHOPPER_2, adminSignIn, axeViolations, clearSavedCart, fillEmptyAddress, preserveStock, reporter, sidewaysOverflow, storefrontSignIn, visible, watchErrors } = lib

const report = reporter('payments: Stripe Checkout (stand-in), webhooks, Pay now, payment links, refunds')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

// ---------------------------------------------------------------- Stripe stand-in
/*
 * Just enough of Stripe's REST API for StripeGateway, answering in Stripe's shapes.
 * `standIn` is shared with the checks: they read what was sent and set what the next answer is.
 */
const standIn = {
  sessions: [], // { id, form, headers, answer }
  expired: [], // { id, headers }
  refunds: [], // { form, headers, answer }
  byKey: new Map(), // Idempotency-Key → answer (Stripe replays the first answer for the same key)
  failSessions: 0, // answer the next N session requests with an error (Stripe down)
  shortSession: false, // the next session closes in 90 s (so "Pay now" must open a new one)
  refuseRefund: null, // the error message for the next refund
  unauthorized: 0, // requests without the right Bearer key
}
let sequence = 0
const nextId = (prefix) => `${prefix}_test_e2e${Date.now().toString(36)}${(++sequence).toString(36)}`
const stripeError = (res, status, message, type = 'invalid_request_error') => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Request-Id': nextId('req') })
  res.end(JSON.stringify({ error: { type, message } }))
}
const answerJson = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Request-Id': nextId('req') })
  res.end(JSON.stringify(body))
}

const stripeApi = createHttpServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
  const headers = { authorization: req.headers.authorization ?? null, idempotencyKey: req.headers['idempotency-key'] ?? null, contentType: req.headers['content-type'] ?? null }
  const path = new URL(req.url, 'http://stand-in').pathname
  if (headers.authorization !== `Bearer ${SECRET_KEY}`) {
    standIn.unauthorized++
    return stripeError(res, 401, 'Invalid API Key provided.', 'authentication_error')
  }
  if (req.method !== 'POST') return stripeError(res, 404, `Unrecognized request URL (${req.method}: ${path}).`)

  if (path === '/checkout/sessions') {
    if (headers.idempotencyKey && standIn.byKey.has(headers.idempotencyKey)) return answerJson(res, standIn.byKey.get(headers.idempotencyKey))
    if (standIn.failSessions > 0) {
      standIn.failSessions--
      standIn.sessions.push({ id: null, form, headers, answer: null })
      return stripeError(res, 503, 'The Stripe stand-in is unavailable (e2e).', 'api_error')
    }
    const id = nextId('cs')
    const expiresAt = standIn.shortSession ? Math.floor(Date.now() / 1000) + 90 : Number(form.expires_at)
    standIn.shortSession = false
    const answer = {
      id,
      object: 'checkout.session',
      mode: form.mode,
      status: 'open',
      payment_status: 'unpaid',
      amount_total: Number(form['line_items[0][price_data][unit_amount]']) * Number(form['line_items[0][quantity]'] ?? 1),
      currency: form['line_items[0][price_data][currency]'],
      customer_email: form.customer_email ?? null,
      client_reference_id: form.client_reference_id ?? null,
      metadata: { order_number: form['metadata[order_number]'] },
      expires_at: expiresAt,
      success_url: form.success_url,
      cancel_url: form.cancel_url,
      payment_intent: null,
      livemode: false,
      url: `${PAY_PAGE}/pay/${id}`,
    }
    standIn.sessions.push({ id, form, headers, answer })
    if (headers.idempotencyKey) standIn.byKey.set(headers.idempotencyKey, answer)
    return answerJson(res, answer)
  }

  const expire = path.match(/^\/checkout\/sessions\/([^/]+)\/expire$/)
  if (expire) {
    const session = standIn.sessions.find((item) => item.id === decodeURIComponent(expire[1]))
    standIn.expired.push({ id: decodeURIComponent(expire[1]), headers })
    if (!session) return stripeError(res, 404, `No such checkout.session: '${expire[1]}'`)
    session.answer.status = 'expired'
    return answerJson(res, { ...session.answer, status: 'expired', url: null })
  }

  if (path === '/refunds') {
    if (standIn.refuseRefund) {
      const message = standIn.refuseRefund
      standIn.refuseRefund = null
      standIn.refunds.push({ form, headers, answer: null })
      return stripeError(res, 400, message)
    }
    const answer = { id: nextId('re'), object: 'refund', status: 'succeeded', amount: Number(form.amount), currency: 'usd', payment_intent: form.payment_intent, metadata: { order_number: form['metadata[order_number]'] } }
    standIn.refunds.push({ form, headers, answer })
    return answerJson(res, answer)
  }
  return stripeError(res, 404, `Unrecognized request URL (POST: ${path}).`)
})

// The stand-in "payment page": Pay → the session's success_url, Cancel → its cancel_url.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
const payPageHandler = (req, res) => {
  const id = decodeURIComponent(new URL(req.url, PAY_PAGE).pathname.match(/^\/pay\/([^/]+)$/)?.[1] ?? '')
  const session = standIn.sessions.find((item) => item.id === id)?.answer
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('No such payment page.')
  }
  const total = `$${(session.amount_total / 100).toFixed(2)}`
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stripe stand-in</title></head>
<body><main><h1>Stripe stand-in checkout</h1><p data-session="${escapeHtml(session.id)}">Pay ${escapeHtml(total)} for ${escapeHtml(session.client_reference_id)} (${escapeHtml(session.customer_email)})</p>
<button type="button" id="pay">Pay</button> <button type="button" id="cancel">Cancel</button></main>
<script>
document.getElementById('pay').onclick = () => location.assign(${JSON.stringify(session.success_url)})
document.getElementById('cancel').onclick = () => location.assign(${JSON.stringify(session.cancel_url)})
</script></body></html>`)
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
          server.closeAllConnections() // the browser's keep-alive connections
        }),
    ),
  )
  if (certDir) rmSync(certDir, { recursive: true, force: true })
}
// Ctrl+C or a crash: nothing keeps running.
process.on('exit', () => children.forEach((child) => killGroup(child, 'SIGKILL')))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n(${signal}: stopping the servers this suite started)`)
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
const api = async (path, { method = 'GET', token, body } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    })
    if (response.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, (Number(response.headers.get('retry-after')) || 5) * 1000))
      continue
    }
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}
/** Runs PHP in the backend (local development only): cleanup of rows without a delete endpoint. */
function tinker(code) {
  const run = spawnSync('php', ['artisan', 'tinker', `--execute=${code}`], { cwd: BACKEND, encoding: 'utf8', timeout: 60_000 })
  if (run.status !== 0) throw new Error(`tinker failed: ${(run.stderr || run.stdout).trim().slice(0, 200)}`)
  return run.stdout.trim()
}
async function latestMail(email, { after = 0, tries = 20 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const response = await fetch(`${API}/dev/mailbox/latest?to=${encodeURIComponent(email.toLowerCase())}`)
    if (response.ok) {
      const { data } = await response.json()
      if (data.id > after) return data
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}
const latestMailId = async (email) => (await latestMail(email, { tries: 1 }))?.id ?? 0
const cents = (value) => Math.round(Number(value) * 100)

const run = Date.now().toString(36)
let eventCount = 0
/** A Stripe event, as JSON text exactly as it will be signed and sent. */
const event = (type, session) => JSON.stringify({ id: `evt_e2e_${run}_${++eventCount}`, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: session } })
const paidSession = (session, { amount = session.amount_total, intent = `pi_e2e_${run}_${eventCount + 1}` } = {}) => ({
  ...session,
  status: 'complete',
  payment_status: 'paid',
  amount_total: amount,
  payment_intent: intent,
  url: null,
})
const signatureFor = (body, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`
/** Sends a webhook like Stripe: through the store's service (default) or straight to the API (to read its `result`). */
async function webhook(body, { via = 'store', signature = signatureFor(body) } = {}) {
  const url = via === 'store' ? `${BASE}/api/payments/stripe/webhook` : `${API}/api/v1/payments/stripe/webhook`
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature && { 'Stripe-Signature': signature }) }, body })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const DRESS = 166 // Tartan Dress: minimum order 1, plenty of stock
const guestEmail = `guest.pay.${run}@example.com`
const guest2Email = `guest.link.${run}@example.com`
const madeOrders = new Set()
const eventIds = () => `evt_e2e_${run}_%`

// ---------------------------------------------------------------- Start
let browser
let restoreStock = async () => 0
let owner
const errors = []
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const stockOf = async (id) => (await admin$(`/products/${id}`)).body?.data?.stock_quantity

try {
  for (const port of [STRIPE_PORT, PAY_PAGE_PORT, API_PORT, STORE_PORT]) {
    if (await portOpen(port)) throw new Error(`port ${port} is already in use: stop whatever runs there (an earlier run?)`)
  }
  certDir = mkdtempSync(join(tmpdir(), 'buynest-e2e-stripe-'))
  const cert = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { encoding: 'utf8' })
  if (cert.status !== 0) throw new Error(`openssl could not make a test certificate: ${cert.stderr.slice(0, 200)}`)
  const payPage = createHttpsServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, payPageHandler)
  servers.push(stripeApi, payPage)
  await new Promise((resolve) => stripeApi.listen(STRIPE_PORT, '127.0.0.1', resolve))
  await new Promise((resolve) => payPage.listen(PAY_PAGE_PORT, '127.0.0.1', resolve))

  const laravel = start('Laravel API (:8010)', 'php', ['artisan', 'serve', '--host=127.0.0.1', `--port=${API_PORT}`, '--no-reload'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      STRIPE_SECRET_KEY: SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_API_URL: `http://127.0.0.1:${STRIPE_PORT}`,
      STRIPE_CURRENCY: 'usd',
      STOREFRONT_URL: STORE,
      APP_URL: API,
      PHP_CLI_SERVER_WORKERS: '4',
    },
  })
  await waitFor(`${API}/api/v1/store`, laravel)
  const store = start('storefront (:5180)', process.execPath, [join(FRONTEND, 'node_modules/vite/bin/vite.js'), '--port', String(STORE_PORT), '--strictPort'], {
    cwd: FRONTEND,
    env: { ...process.env, BUYNEST_LARAVEL_URL: API },
  })
  await waitFor(`${STORE}/api/catalog/store`, store)

  // ---------- The isolated setup really is isolated ----------
  const apiStore = (await api('/api/v1/store')).body?.data
  log(apiStore?.card_payments === 'stripe', `API on :${API_PORT} has Stripe on (card_payments "${apiStore?.card_payments}")`)
  const usualStore = await fetch('http://127.0.0.1:8000/api/v1/store').then((r) => r.json(), () => null)
  log(!usualStore || usualStore.data?.card_payments === 'manual', `the usual API on :8000 keeps Stripe off (card_payments "${usualStore?.data?.card_payments ?? 'not running'}")`)
  const storeSettings = await fetch(`${STORE}/api/catalog/store`).then((r) => r.json(), () => null)
  const storeCard = storeSettings?.data?.card_payments ?? storeSettings?.data?.cardPayments ?? storeSettings?.card_payments ?? storeSettings?.cardPayments
  log(storeCard === 'stripe', `storefront on :${STORE_PORT} talks to :${API_PORT} (its /api/catalog/store says card_payments "${storeCard}")`)

  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
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
  for (const port of [STRIPE_PORT, PAY_PAGE_PORT, API_PORT, STORE_PORT]) if (await portOpen(port)) stillOpen.push(port)
  log(stillOpen.length === 0, `every server this suite started is stopped (ports ${[STRIPE_PORT, PAY_PAGE_PORT, API_PORT, STORE_PORT].join(', ')} closed${stillOpen.length ? `; still open: ${stillOpen.join(', ')}` : ''})`)
  log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
  report.done()
}

// ---------------------------------------------------------------- Checks
async function runChecks() {
  const axe = async (page, name) => {
    const violations = await axeViolations(page)
    log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
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
    // ignoreHTTPSErrors: the stand-in payment page's certificate is self-signed.
    const context = await browser.newContext({ viewport, bypassCSP: true, ignoreHTTPSErrors: true })
    context.setDefaultTimeout(15000)
    return watchErrors(await context.newPage(), errors)
  }
  async function addDress(page) {
    await page.goto(`${BASE}/products/${DRESS}`, { waitUntil: 'networkidle' })
    await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
    const miniCart = page.getByRole('dialog')
    if (await visible(miniCart, 3000)) {
      await page.keyboard.press('Escape')
      await miniCart.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }
  /** Checkout with the card: fills what is empty and returns the place-order button. */
  async function cardCheckout(page, email) {
    await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await page.getByRole('radio', { name: /Credit or debit card/ }).check()
    if (email) await page.locator('[name="email"]').fill(email)
    const phone = page.locator('[name="phone"]')
    if (!(await phone.inputValue())) await phone.fill('+1 555 010 2030')
    for (const [name, value] of [['firstName', 'Pat'], ['lastName', 'Payer']]) {
      const input = page.locator(`[name="shipping.${name}"]`)
      if (!(await input.inputValue())) await input.fill(value)
    }
    await fillEmptyAddress(page)
    return page.getByRole('button', { name: 'Continue to secure payment' })
  }
  const toPayPage = (page) => page.waitForURL((url) => url.href.startsWith(`${PAY_PAGE}/pay/`), { timeout: 20000 })
  const sessionOn = (page) => decodeURIComponent(new URL(page.url()).pathname.split('/').pop())
  const recorded = (id) => standIn.sessions.find((item) => item.id === id)
  const hero = (page, text) => page.locator('.order-page__hero h1').filter({ hasText: text })
  const confirmationUrl = (number, outcome) => `${BASE}/order-confirmation/${number}?payment=${outcome}`

  let paidNumber = null // the customer's order paid through Stripe (refunded in the admin later)
  let paidIntent = null

  // ---------- 1. A customer pays by card ----------
  await part('customer card payment', async () => {
    const page = await newPage()
    await storefrontSignIn(page, SHOPPER)
    await addDress(page)
    const stockBefore = await stockOf(DRESS)
    const place = await cardCheckout(page)
    log(await visible(place), 'checkout with card: the button reads "Continue to secure payment"')
    log(await visible(page.getByText(/Next you'll pay on Stripe's secure payment page/)), "checkout explains the shopper pays on Stripe's page")
    await axe(page, 'checkout (card, Stripe on)')
    await place.click()
    await toPayPage(page)
    const sessionId = sessionOn(page)
    const sent = recorded(sessionId)
    const number = sent?.form.client_reference_id
    madeOrders.add(number)
    const order = await orderOf(number)
    log(Boolean(sent && order), `placing the order sends the browser to the stand-in payment page (${number}, ${sessionId})`)
    log(order?.status === 'pending_payment' && order?.payment_status === 'unpaid', `the order waits for its payment (${order?.status}, ${order?.payment_status})`)
    log((await stockOf(DRESS)) === stockBefore - 1, 'its stock is reserved while it waits')
    const form = sent?.form ?? {}
    log(Number(form['line_items[0][price_data][unit_amount]']) === cents(order?.totals?.total) && form['line_items[0][quantity]'] === '1', `session: the grand total in cents as one line (${form['line_items[0][price_data][unit_amount]']} = $${order?.totals?.total})`)
    log(form['line_items[0][price_data][currency]'] === 'usd', 'session: currency usd')
    log(form.client_reference_id === number && form['metadata[order_number]'] === number && form['payment_intent_data[metadata][order_number]'] === number, 'session: the order number in client_reference_id and metadata (also on the PaymentIntent)')
    log(form.customer_email === SHOPPER.email, `session: customer_email (${form.customer_email})`)
    log(form.success_url === confirmationUrl(number, 'success') && form.cancel_url === confirmationUrl(number, 'cancelled'), `session: success and cancel URLs back to the store (${form.success_url})`)
    const minutes = (Number(form.expires_at) - Date.now() / 1000) / 60
    log(minutes > 28 && minutes <= 31, `session: closes in 30 minutes (${minutes.toFixed(1)})`)
    log(new RegExp(`^order-${order?.id}-session-1$`).test(sent?.headers.idempotencyKey ?? '') && sent?.headers.authorization === `Bearer ${SECRET_KEY}` && /x-www-form-urlencoded/.test(sent?.headers.contentType ?? ''), `session request: form-encoded, Bearer key, Idempotency-Key "${sent?.headers.idempotencyKey}"`)
    log(/BuyNest order BN-/.test(form['line_items[0][price_data][product_data][name]'] ?? ''), `session line: "${form['line_items[0][price_data][product_data][name]']}"`)

    // Pay on the stand-in page → back on the store, waiting for Stripe's webhook
    await page.getByRole('button', { name: 'Pay' }).click()
    await page.waitForURL(confirmationUrl(number, 'success'))
    log(await visible(hero(page, 'Confirming your payment…')), 'back from paying: "Confirming your payment…"')
    const mailBefore = await latestMailId(SHOPPER.email)
    paidIntent = `pi_e2e_${run}_paid`
    const paidEvent = event('checkout.session.completed', paidSession(sent.answer, { intent: paidIntent }))
    const first = await webhook(paidEvent)
    log(first.status === 200, `a signed checkout.session.completed through the store's /api/payments/stripe/webhook → ${first.status}`)
    log(await visible(hero(page, 'Payment received — thank you'), 20000), 'the page turns to "Payment received — thank you" by itself')
    const paid = await orderOf(number)
    log(paid?.payment_status === 'paid' && paid?.status === 'processing', `the order is paid and processing (${paid?.status}, ${paid?.payment_status})`)
    log(paid?.invoices?.length === 1 && /Stripe/.test(paid?.invoices?.[0]?.note ?? ''), `one invoice, "${paid?.invoices?.[0]?.note}" (${paid?.invoices?.[0]?.number})`)
    log(paid?.payment?.provider === 'stripe' && paid?.payment?.reference === paidIntent && Boolean(paid?.payment?.paid_at), `payment: provider stripe, reference ${paid?.payment?.reference}, paid at ${paid?.payment?.paid_at}`)
    const mail = await latestMail(SHOPPER.email, { after: mailBefore })
    log(new RegExp(`Payment received for order ${number}`).test(mail?.subject ?? ''), `the invoice email is in the test inbox ("${mail?.subject}")`)
    const again = await webhook(paidEvent)
    const direct = await webhook(paidEvent, { via: 'api' })
    const afterDuplicate = await orderOf(number)
    const mailAfter = await latestMailId(SHOPPER.email)
    log(again.status === 200 && direct.body?.result === 'duplicate' && afterDuplicate?.invoices?.length === 1 && mailAfter === mail?.id, `the same event again: 200 and nothing happens (result "${direct.body?.result}", ${afterDuplicate?.invoices?.length} invoice, no new email)`)
    paidNumber = number

    await axe(page, 'confirmation (paid)')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload({ waitUntil: 'networkidle' })
    await hero(page, 'Payment received').first().waitFor()
    log((await sidewaysOverflow(page)) <= 0, `390px: the paid confirmation fits (overflow ${await sidewaysOverflow(page)}px)`)
    await page.context().close()
  })

  // ---------- 2. Signatures and amounts are checked ----------
  await part('webhook checks', async () => {
    // An unpaid order placed through the API (a guest, so no saved cart is touched).
    const placed = await api('/api/v1/orders', {
      method: 'POST',
      body: {
        items: [{ product_id: DRESS, quantity: 1 }],
        shipping_method: 'standard',
        payment_method: 'card',
        email: guest2Email,
        phone: '+1 555 010 2040',
        shipping_address: { first_name: 'Mia', last_name: 'Match', line1: '5 Check Lane', city: 'Springfield', state: 'Oregon', postal_code: '29112', country: 'United States' },
      },
    })
    const number = placed.body?.data?.number
    madeOrders.add(number)
    log(placed.status === 201 && /^https:\/\/127\.0\.0\.1:12112\/pay\//.test(placed.body?.data?.payment?.url ?? ''), `an API card order gets a payment page (${number}: ${placed.body?.data?.payment?.url})`)
    const session = standIn.sessions.findLast((item) => item.form.client_reference_id === number)?.answer
    const body = event('checkout.session.completed', paidSession(session))
    const wrongSecret = await webhook(body, { signature: signatureFor(body, 'whsec_not_the_secret') })
    const tampered = await webhook(body.replace(`"amount_total":${session.amount_total}`, '"amount_total":1'), { signature: signatureFor(body) })
    const missing = await webhook(body, { signature: null })
    const stale = await webhook(body, { signature: signatureFor(body, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 600) })
    log(wrongSecret.status === 400 && tampered.status === 400 && missing.status === 400 && stale.status === 400, `bad signatures → 400 (wrong secret ${wrongSecret.status}, changed body ${tampered.status}, missing ${missing.status}, 10 minutes old ${stale.status})`)
    log((await orderOf(number))?.payment_status === 'unpaid', 'nothing changed after the bad signatures')

    const mismatch = await webhook(event('checkout.session.completed', paidSession(session, { amount: session.amount_total - 100 })), { via: 'api' })
    const after = await orderOf(number)
    log(mismatch.status === 200 && mismatch.body?.result === 'amount_mismatch', `amount $1.00 short: 200, result "${mismatch.body?.result}"`)
    log(after?.payment_status === 'unpaid' && after?.status === 'pending_payment' && after?.invoices?.length === 0, `the order stays unpaid (${after?.status}, ${after?.payment_status}, ${after?.invoices?.length} invoices)`)
    const notes = (await admin$('/notifications?per_page=50')).body?.data ?? []
    const problem = notes.find((item) => item.link === `/orders/${number}` && item.type === 'payment_problem')
    log(problem?.severity === 'critical' && /mismatch/i.test(problem?.title ?? ''), `the admin gets a critical notification ("${problem?.title}", ${problem?.severity})`)
    const currency = await webhook(event('checkout.session.completed', { ...paidSession(session), currency: 'eur' }), { via: 'api' })
    log(currency.body?.result === 'amount_mismatch' && (await orderOf(number))?.payment_status === 'unpaid', `wrong currency (eur): result "${currency.body?.result}", still unpaid`)

    // Staff cancelling it closes its open payment page at Stripe.
    const expireCalls = standIn.expired.length
    const cancelled = await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
    const expire = standIn.expired.slice(expireCalls).find((item) => item.id === session.id)
    log(cancelled.status === 200 && Boolean(expire) && /^order-\d+-expire-/.test(expire?.headers.idempotencyKey ?? ''), `staff cancel → the stand-in got POST /checkout/sessions/${session.id}/expire (${expire?.headers.idempotencyKey})`)
    const late = await webhook(event('checkout.session.completed', paidSession(session)), { via: 'api' })
    const latePing = ((await admin$('/notifications?per_page=50')).body?.data ?? []).filter((item) => item.link === `/orders/${number}`)
    log(late.body?.result === 'cancelled_order' && (await orderOf(number))?.payment_status === 'unpaid', `a payment arriving after the cancel: not recorded (result "${late.body?.result}"; ${latePing.length} notifications for the order)`)
  })

  // ---------- 3. Cancel on the payment page, Pay now, then the page expires ----------
  await part('cancelled payment and expiry', async () => {
    const page = await newPage()
    await storefrontSignIn(page, SHOPPER)
    await addDress(page)
    const stockBefore = await stockOf(DRESS)
    standIn.shortSession = true // the first page closes in 90 s: "Pay now" must open a new one
    await (await cardCheckout(page)).click()
    await toPayPage(page)
    const firstSession = sessionOn(page)
    const number = recorded(firstSession)?.form.client_reference_id
    madeOrders.add(number)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForURL(confirmationUrl(number, 'cancelled'))
    log(await visible(hero(page, 'Payment not completed')), 'Cancel on the payment page: "Payment not completed"')
    const payNow = page.getByRole('button', { name: 'Pay now' })
    log(await visible(payNow), '"Pay now" is offered')
    await axe(page, 'confirmation (payment cancelled)')
    await page.setViewportSize({ width: 390, height: 844 })
    log((await sidewaysOverflow(page)) <= 0, `390px: the cancelled confirmation fits (overflow ${await sidewaysOverflow(page)}px)`)
    await page.setViewportSize({ width: 1280, height: 900 })
    await payNow.click()
    await toPayPage(page)
    const secondSession = sessionOn(page)
    const second = recorded(secondSession)
    log(secondSession !== firstSession && /-session-2$/.test(second?.headers.idempotencyKey ?? '') && second?.form.client_reference_id === number, `Pay now opens a new payment page (${secondSession}, ${second?.headers.idempotencyKey})`)
    log((await stockOf(DRESS)) === stockBefore - 1, 'the order still holds its stock')

    const mailBefore = await latestMailId(SHOPPER.email)
    const old = await webhook(event('checkout.session.expired', { ...recorded(firstSession).answer, status: 'expired' }), { via: 'api' })
    log(old.body?.result === 'superseded' && (await orderOf(number))?.status === 'pending_payment', `the old page expiring changes nothing (result "${old.body?.result}")`)
    const expiredBody = event('checkout.session.expired', { ...second.answer, status: 'expired' })
    const expired = await webhook(expiredBody)
    const cancelledOrder = await orderOf(number)
    log(expired.status === 200 && cancelledOrder?.status === 'cancelled' && cancelledOrder?.payment_status === 'unpaid', `the current page expiring (through the store) cancels the order (${cancelledOrder?.status})`)
    log((await stockOf(DRESS)) === stockBefore, `its stock is back (${await stockOf(DRESS)})`)
    const mail = await latestMail(SHOPPER.email, { after: mailBefore })
    log(new RegExp(`Payment not completed for order ${number}`).test(mail?.subject ?? ''), `the "payment not completed" email ("${mail?.subject}")`)
    const repeat = await webhook(event('checkout.session.expired', { ...second.answer, status: 'expired' }), { via: 'api' })
    log(repeat.body?.result === 'ignored' && (await stockOf(DRESS)) === stockBefore, `another expiry event for it: result "${repeat.body?.result}", restocked only once`)
    const history = cancelledOrder?.history ?? cancelledOrder?.status_history ?? []
    log(history.some((entry) => /secure payment page expired/i.test(entry.note ?? '')), 'the order history says the payment page expired')
    await page.goto(confirmationUrl(number, 'cancelled'), { waitUntil: 'networkidle' })
    log(!(await visible(page.getByRole('button', { name: 'Pay now' }), 3000)), 'the cancelled order no longer offers Pay now')
    log(!(await visible(page.getByText(/is confirmed\./), 1000)), 'the cancelled order is not called "confirmed"')
    await page.context().close()
  })

  // ---------- 4. A guest pays: the confirmation and tracking pages ----------
  await part('guest card payment', async () => {
    const page = await newPage()
    await addDress(page)
    await (await cardCheckout(page, guestEmail)).click()
    await toPayPage(page)
    const sessionId = sessionOn(page)
    const number = recorded(sessionId)?.form.client_reference_id
    madeOrders.add(number)
    log(recorded(sessionId)?.form.customer_email === guestEmail, `guest card order ${number}: on the payment page with the guest's email`)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForURL(confirmationUrl(number, 'cancelled'))
    log(await visible(hero(page, 'Payment not completed')), 'guest back from Cancel: "Payment not completed" (found with the email kept in this tab)')
    const sessionsBefore = standIn.sessions.length
    await page.getByRole('button', { name: 'Pay now' }).click()
    await toPayPage(page)
    log(sessionOn(page) === sessionId && standIn.sessions.length === sessionsBefore, 'guest Pay now on the confirmation page: the page still open is given back (no new session)')
    await page.context().close()

    // Another device: track the order with its number and email, and pay from there.
    const other = await newPage()
    await other.goto(`${BASE}/track-order`, { waitUntil: 'networkidle' })
    await other.getByLabel('Order number').fill(number)
    await other.getByLabel('Email').fill(guestEmail.toUpperCase())
    await other.getByRole('button', { name: 'Find my order' }).click()
    const payNow = other.getByRole('button', { name: 'Pay now' })
    log(await visible(payNow), 'tracking page (email in capitals): the unpaid card order offers Pay now')
    await payNow.click()
    await toPayPage(other)
    log(sessionOn(other) === sessionId, 'tracking Pay now opens the payment page with the order\'s email as proof')
    await other.getByRole('button', { name: 'Pay' }).click()
    await other.waitForURL(confirmationUrl(number, 'success'))
    log(await visible(hero(other, 'Confirming your payment…')), 'guest back from paying: "Confirming your payment…"')
    const mailBefore = await latestMailId(guestEmail)
    const sent = await webhook(event('checkout.session.completed', paidSession(recorded(sessionId).answer)))
    log(sent.status === 200 && (await visible(hero(other, 'Payment received — thank you'), 25000)), 'the guest page turns to "Payment received — thank you"')
    log(new RegExp(`Payment received for order ${number}`).test((await latestMail(guestEmail, { after: mailBefore }))?.subject ?? ''), 'the guest gets the invoice email')
    await other.setViewportSize({ width: 390, height: 844 })
    log((await sidewaysOverflow(other)) <= 0, `390px: the guest confirmation fits (overflow ${await sidewaysOverflow(other)}px)`)
    await other.goto(`${BASE}/track-order`, { waitUntil: 'networkidle' })
    await other.getByLabel('Order number').fill(number)
    await other.getByLabel('Email').fill(guestEmail)
    await other.getByRole('button', { name: 'Find my order' }).click()
    await other.locator('.track-order__result').waitFor()
    log((await visible(other.locator('.track-order__result').getByText('Paid').first(), 5000)) && !(await other.getByRole('button', { name: 'Pay now' }).isVisible()), 'tracking now shows it paid, without Pay now')
    await other.context().close()
  })

  // ---------- 5. The admin: payment details, payment links, refunds ----------
  await part('admin', async () => {
    const admin = await newPage({ width: 1440, height: 900 })
    await admin.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
    await adminSignIn(admin, ADMIN_USER)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    const row = (label) => admin.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')

    if (paidNumber) {
      await admin.goto(`${BASE}/admin/orders/${paidNumber}`, { waitUntil: 'networkidle' })
      await row('Paid through').waitFor()
      log(/Stripe/.test(await row('Paid through').innerText()) && (await row('Paid through').getByText('Test mode').isVisible()), `admin order ${paidNumber}: paid through Stripe, "Test mode"`)
      const reference = admin.getByRole('link', { name: new RegExp(paidIntent) })
      log((await reference.getAttribute('href')) === `https://dashboard.stripe.com/test/payments/${paidIntent}`, `the reference links to the Stripe test dashboard (${await reference.getAttribute('href')})`)
      log(await row('Paid at').locator('time').isVisible(), `paid at: ${await row('Paid at').innerText()}`)
      await axe(admin, 'admin order (Stripe payment)')

      // A refund Stripe refuses: the message is shown and nothing is saved.
      const stockBefore = await stockOf(DRESS)
      standIn.refuseRefund = 'The stand-in refuses this refund (e2e).'
      await admin.getByRole('button', { name: 'Refund', exact: true }).click()
      let dialog = admin.getByRole('dialog')
      log(await visible(dialog.getByText(/goes back to the customer's card through Stripe/)), 'the refund dialog says the money goes back to the card through Stripe')
      await dialog.getByLabel(/Quantity of .* to refund/).first().fill('1')
      await dialog.getByRole('button', { name: /^Refund \$/ }).click()
      log(await visible(dialog.getByText('Stripe refused the refund: The stand-in refuses this refund (e2e).')), "a refused refund shows Stripe's message")
      const refused = standIn.refunds.at(-1)
      const unchanged = await orderOf(paidNumber)
      log(refused?.answer === null && unchanged?.credit_memos?.length === 0 && unchanged?.payment_status === 'paid' && (await stockOf(DRESS)) === stockBefore, `…and nothing is saved (${unchanged?.credit_memos?.length} credit memos, ${unchanged?.payment_status})`)
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await dialog.waitFor({ state: 'hidden' })

      // The refund again, accepted this time.
      const refundsBefore = standIn.refunds.length
      await admin.getByRole('button', { name: 'Refund', exact: true }).click()
      dialog = admin.getByRole('dialog')
      await dialog.getByLabel(/Quantity of .* to refund/).first().fill('1')
      await dialog.getByRole('button', { name: /^Refund \$/ }).click()
      log(await visible(admin.getByText(/Stripe is returning the money to the customer's card/)), 'the refund succeeds: "Stripe is returning the money to the customer\'s card"')
      const refunded = await orderOf(paidNumber)
      const memo = refunded?.credit_memos?.[0]
      const call = standIn.refunds.slice(refundsBefore)[0]
      log(Boolean(call) && Number(call.form.amount) === cents(memo?.total) && call.form.payment_intent === paidIntent, `the stand-in got POST /refunds for the memo total (${call?.form.amount} cents = $${memo?.total}, ${call?.form.payment_intent})`)
      log(/^memo-order-\d+-1-\d+$/.test(call?.headers.idempotencyKey ?? ''), `refund Idempotency-Key "${call?.headers.idempotencyKey}"`)
      log(memo?.refund_reference === call?.answer?.id && refunded?.payment_status === 'partially_refunded', `the credit memo keeps Stripe's refund id (${memo?.number}: ${memo?.refund_reference}; ${refunded?.payment_status})`)
    } else {
      log(false, 'admin payment checks skipped: no Stripe-paid order')
    }

    // An admin-created card order while Stripe is down: no link yet → "Create payment link"
    standIn.failSessions = 1
    const made = await admin$('/orders', {
      method: 'POST',
      body: {
        guest: { email: `phone.order.${run}@example.com`, phone: '+1 555 010 2050', first_name: 'Lou', last_name: 'Link' },
        items: [{ product_id: DRESS, quantity: 1 }],
        shipping_address: { first_name: 'Lou', last_name: 'Link', line1: '9 Phone Road', city: 'Austin', state: 'Texas', postal_code: '73301', country: 'United States' },
        same_as_shipping: true,
        shipping_method: 'standard',
        payment_method: 'card',
        notify_customer: false,
      },
    })
    const number = made.body?.data?.number
    madeOrders.add(number)
    log(made.status === 201 && made.body?.data?.payment?.url === null && made.body?.data?.payment?.error === 'The Stripe stand-in is unavailable (e2e).', `admin card order while Stripe is down: created unpaid, payment error "${made.body?.data?.payment?.error}"`)
    await admin.goto(`${BASE}/admin/orders/${number}`, { waitUntil: 'networkidle' })
    await row('Payment link').waitFor()
    log(await visible(admin.getByText('No payment page is open for this order.')), 'the order page: "No payment page is open for this order."')
    const sessionsBefore = standIn.sessions.length
    await admin.getByRole('button', { name: 'Create payment link' }).click()
    const linkInput = admin.getByLabel(`Payment link for order ${number}`)
    await linkInput.waitFor()
    const link = await linkInput.inputValue()
    const created = standIn.sessions.slice(sessionsBefore)[0]
    log(link === created?.answer?.url && link.startsWith(`${PAY_PAGE}/pay/`), `Create payment link: a new link is shown (${link})`)
    const hours = (Number(created?.form.expires_at) - Date.now() / 1000) / 3600
    log(hours > 23.9 && hours <= 24.1 && /-session-2$/.test(created?.headers.idempotencyKey ?? ''), `the link stays open 24 hours (${hours.toFixed(2)} h; ${created?.headers.idempotencyKey}, the failed try counted)`)
    await axe(admin, 'admin order (payment link)')
    await admin.getByRole('button', { name: 'Copy link' }).click()
    log(await visible(admin.getByText('Payment link copied.')), '"Copy link": "Payment link copied."')
    log((await admin.evaluate(() => navigator.clipboard.readText())) === link, 'the clipboard holds the link')
    const audit = (await admin$(`/audit?action=order.payment_link_created&subject_type=order&subject_id=${made.body?.data?.id}`)).body?.data ?? []
    log(audit.some((entry) => entry.action === 'order.payment_link_created'), `audit: order.payment_link_created (${audit.length} entry)`)
    // Phone layout of the payment section
    await admin.setViewportSize({ width: 390, height: 844 })
    log((await sidewaysOverflow(admin)) <= 0, `390px: the admin order page with the payment link fits (overflow ${await sidewaysOverflow(admin)}px)`)
    await admin.context().close()
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
  const numbers = [...madeOrders].filter(Boolean)
  await attempt('unpaid test orders', async () => {
    for (const number of numbers) {
      const order = await orderOf(number)
      if (order?.status === 'pending_payment') await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
    }
  })
  await attempt('notifications and webhook events', () => {
    const links = numbers.map((number) => `'/orders/${number}'`).join(',') || "''"
    tinker(
      `$ids = App\\Models\\AdminNotification::where('type', 'payment_problem')->whereIn('link', [${links}])->pluck('id');` +
        ` DB::table('admin_notification_reads')->whereIn('notification_id', $ids)->delete(); App\\Models\\AdminNotification::whereIn('id', $ids)->delete();` +
        // Phase 10 (part B): stripe_events became payment_events (provider + id).
        ` DB::table('payment_events')->where('provider', 'stripe')->where('id', 'like', '${eventIds()}')->delete();`,
    )
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  const open = []
  for (const number of numbers) if ((await orderOf(number))?.status === 'pending_payment') open.push(number)
  const leftNotes = ((await admin$('/notifications?per_page=50')).body?.data ?? []).filter((item) => numbers.some((number) => item.link === `/orders/${number}`))
  log(
    open.length === 0 && leftNotes.length === 0 && problems.length === 0,
    `cleanup: unpaid test orders cancelled, notifications and webhook events removed, saved carts emptied, stock put back (orders, invoices, credit memos stay)${open.length || leftNotes.length || problems.length ? ` — left: ${[...open, ...leftNotes.map((item) => item.title), ...problems].join('; ')}` : ''}`,
  )
}
