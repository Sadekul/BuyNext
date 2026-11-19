// Phase 12, end to end in a real browser: taka (BDT) as the store currency, and bKash / Nagad / cards
// through SSLCommerz. Nothing reaches SSLCommerz (docs/backend/PHASE12_CONTRACT.md).
//
// The suite starts its own servers and stops them at the end (also on failure and Ctrl+C):
//   - a stand-in for SSLCommerz's API on http://127.0.0.1:12131 (what SslCommerzGateway calls: session
//     create, validation, transaction query, refund), recording every request, and its hosted "gateway
//     page" on https://127.0.0.1:12132 (the storefront only follows https payment links; a throwaway
//     self-signed certificate is made with openssl, and the browser is told to accept it). The page
//     sends the browser back like SSLCommerz does: a cross-site form POST to the store's
//     success/fail/cancel URL. The suite sends the IPNs itself, signed like SSLCommerz (verify_sign).
//   - a second Laravel API on :8012 with BUYNEST_CURRENCY=BDT and SSLCommerz switched on through the
//     process environment (SSLCOMMERZ_STORE_ID/STORE_PASSWORD, SSLCOMMERZ_MODE=sandbox,
//     SSLCOMMERZ_API_URL = the stand-in, STOREFRONT_URL), which wins over backend/.env, so the usual API
//     on :8000 stays in USD without SSLCommerz
//   - a second storefront dev server on :5182 pointed at it (BUYNEST_LARAVEL_URL)
// Both APIs share the dev database (whose prices are USD numbers: here they read as taka). No .env file
// is changed. `php artisan buynest:payments:expire-sslcommerz` and `buynest:currency:convert --dry-run`
// run with the same environment as the suite's API.
//
// Left behind on purpose: orders, invoices, credit memos (like the other suites). Removed or put back:
// the SSLCommerz switch in Settings → Checkout, the throwaway customer (its orders moved on first),
// the USD test gift card (disabled), notifications and payment events of the test orders, saved carts,
// stock. Unpaid test orders are cancelled.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SSL_PORT = 12131
const GATEWAY_PORT = 12132
const API_PORT = 8012
const STORE_PORT = 5182
const PORTS = [SSL_PORT, GATEWAY_PORT, API_PORT, STORE_PORT]
const API = `http://127.0.0.1:${API_PORT}`
const STORE = `http://localhost:${STORE_PORT}`
const GATEWAY = `https://127.0.0.1:${GATEWAY_PORT}`
const STORE_ID = 'buyne2etest'
const STORE_PASSWORD = 'buyne2etest@ssl'
const USUAL_API = 'http://127.0.0.1:8000'
const BACKEND = join(import.meta.dirname, '..', 'backend')
const FRONTEND = join(import.meta.dirname, '..', 'frontend')

// lib.mjs reads these when it loads: this suite's storefront and API, not the usual ones.
process.env.BASE_URL = STORE
process.env.LARAVEL_URL = API
const lib = await import('./lib.mjs')
const { ADMIN_USER, BASE, LARAVEL, SHOPPER, SHOPPER_2, adminSignIn, axeViolations, clearSavedCart, latestCode, preserveStock, reporter, sidewaysOverflow, storefrontSignIn, visible, watchErrors } = lib

const report = reporter('taka: BDT store currency, SSLCommerz (stand-in) with bKash / Nagad / cards')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const run = Date.now().toString(36)
const RUN = run.toUpperCase()
let sequence = 0
const nextId = (prefix) => `${prefix}${RUN}${(++sequence).toString(36).toUpperCase().padStart(4, '0')}`
const md5 = (text) => createHash('md5').update(text).digest('hex')

/** The API's environment: also used for the artisan commands, so they see the same store. */
const suiteEnv = {
  ...process.env,
  BUYNEST_CURRENCY: 'BDT',
  SSLCOMMERZ_STORE_ID: STORE_ID,
  SSLCOMMERZ_STORE_PASSWORD: STORE_PASSWORD,
  SSLCOMMERZ_MODE: 'sandbox',
  SSLCOMMERZ_API_URL: `http://127.0.0.1:${SSL_PORT}`,
  STOREFRONT_URL: STORE,
  APP_URL: API,
}

// ---------------------------------------------------------------- SSLCommerz stand-in
/*
 * Just enough of SSLCommerz for SslCommerzGateway, answering in SSLCommerz's shapes.
 * `ssl` is shared with the checks: they read what was sent and set what the next answer is.
 */
const ssl = {
  sessions: [], // { key, form, url } (form = the posted session fields)
  failSessions: 0, // refuse the next n session requests
  payments: [], // { val_id, tran_id, amount, ..., validated }
  attempts: [], // failed / cancelled attempts: { tran_id, status }
  validations: [], // the val_ids the API asked about
  queries: [], // the tran_ids the API asked about
  refunds: [], // { query, answer }
  refuseRefund: null, // errorReason of the next refund refused
  nextCard: 'BKASH-BKash', // card_type of the next payment
  nextRisk: '0', // risk_level of the next payment (reset after use)
  unauthorized: 0,
}
const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
const sessionByKey = (key) => ssl.sessions.find((session) => session.key === key)
const paymentFields = (payment) => ({
  tran_id: payment.tran_id,
  val_id: payment.val_id,
  amount: payment.amount,
  card_type: payment.card_type,
  store_amount: (Number(payment.amount) * 0.975).toFixed(2),
  card_no: '',
  bank_tran_id: payment.bank_tran_id,
  status: 'VALID',
  tran_date: payment.tran_date,
  error: '',
  currency: 'BDT',
  card_issuer: payment.card_issuer,
  card_brand: payment.card_brand,
  card_sub_brand: 'Classic',
  card_issuer_country: 'Bangladesh',
  card_issuer_country_code: 'BD',
  store_id: STORE_ID,
  currency_type: 'BDT',
  currency_amount: payment.amount,
  currency_rate: '1.0000',
  base_fair: '0.00',
  value_a: payment.value_a,
  value_b: payment.value_b,
  value_c: '',
  value_d: '',
  risk_level: payment.risk_level,
  risk_title: payment.risk_title,
})
/** SSLCommerz's IPN / return signature: md5 over the listed fields plus md5(store password), sorted by name. */
function signed(fields, password = STORE_PASSWORD) {
  const keys = Object.keys(fields)
  const data = { ...Object.fromEntries(keys.map((key) => [key, String(fields[key] ?? '')])), store_passwd: md5(password) }
  const text = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('&')
  return { ...fields, verify_sign: md5(text), verify_key: keys.join(',') }
}
const validationAnswer = (payment) => ({
  ...paymentFields(payment),
  status: payment.validated ? 'VALIDATED' : 'VALID',
  validated_on: new Date().toISOString().replace('T', ' ').slice(0, 19),
  gw_version: '',
  APIConnect: 'DONE',
})

const sslApi = createHttpServer(async (req, res) => {
  const raw = await readBody(req)
  const url = new URL(req.url, 'http://stand-in')
  const query = Object.fromEntries(url.searchParams)
  const form = Object.fromEntries(new URLSearchParams(raw))
  const credentials = req.method === 'POST' ? form : query
  const authorized = credentials.store_id === STORE_ID && credentials.store_passwd === STORE_PASSWORD
  if (!authorized) ssl.unauthorized++

  if (req.method === 'POST' && url.pathname === '/gwprocess/v4/api.php') {
    if (!authorized) return sendJson(res, 200, { status: 'FAILED', failedreason: 'Store Credential Error Or Store is De-active' })
    if (ssl.failSessions > 0) {
      ssl.failSessions--
      ssl.sessions.push({ key: null, form, url: null })
      return sendJson(res, 200, { status: 'FAILED', failedreason: 'The stand-in refuses this session (e2e)' })
    }
    const key = nextId('SK')
    const page = `${GATEWAY}/gwprocess/v4/gw.php?Q=pay&SESSIONKEY=${key}`
    ssl.sessions.push({ key, form, url: page })
    return sendJson(res, 200, { status: 'SUCCESS', failedreason: '', sessionkey: key, gw: { visa: '', master: '', amex: '', othercards: '', internetbanking: '', mobilebanking: 'bkash,nagad' }, redirectGatewayURL: page, GatewayPageURL: page, storeBanner: '', storeLogo: '', desc: [], is_direct_pay_enable: '0' })
  }
  if (req.method === 'GET' && url.pathname === '/validator/api/validationserverAPI.php') {
    ssl.validations.push(query.val_id)
    if (!authorized) return sendJson(res, 200, { status: 'INVALID_TRANSACTION', APIConnect: 'INVALID_REQUEST' })
    const payment = ssl.payments.find((item) => item.val_id === query.val_id)
    if (!payment) return sendJson(res, 200, { status: 'INVALID_TRANSACTION', tran_id: '', val_id: query.val_id ?? '', APIConnect: 'DONE' })
    const answer = validationAnswer(payment)
    payment.validated = true
    return sendJson(res, 200, answer)
  }
  if (req.method === 'GET' && url.pathname === '/validator/api/merchantTransIDvalidationAPI.php') {
    if (!authorized) return sendJson(res, 200, { APIConnect: 'INVALID_REQUEST' })
    if (query.bank_tran_id && query.refund_amount) {
      if (ssl.refuseRefund) {
        const answer = { APIConnect: 'DONE', bank_tran_id: query.bank_tran_id, trans_id: '', refund_ref_id: '', status: 'failed', errorReason: ssl.refuseRefund }
        ssl.refuseRefund = null
        ssl.refunds.push({ query, answer })
        return sendJson(res, 200, answer)
      }
      const payment = ssl.payments.find((item) => item.bank_tran_id === query.bank_tran_id)
      const answer = payment
        ? { APIConnect: 'DONE', bank_tran_id: query.bank_tran_id, trans_id: payment.tran_id, refund_ref_id: nextId('RF'), status: 'success', errorReason: '' }
        : { APIConnect: 'DONE', bank_tran_id: query.bank_tran_id, trans_id: '', refund_ref_id: '', status: 'failed', errorReason: 'Invalid bank transaction ID' }
      ssl.refunds.push({ query, answer })
      return sendJson(res, 200, answer)
    }
    if (query.tran_id) {
      ssl.queries.push(query.tran_id)
      const element = [
        ...ssl.payments.filter((item) => item.tran_id === query.tran_id).map((payment) => ({ ...validationAnswer(payment) })),
        ...ssl.attempts.filter((item) => item.tran_id === query.tran_id).map((item) => ({ tran_id: item.tran_id, val_id: '', status: item.status, amount: item.amount, currency_type: 'BDT', bank_tran_id: '' })),
      ]
      return sendJson(res, 200, { APIConnect: 'DONE', no_of_trans_found: element.length, element })
    }
    return sendJson(res, 200, { APIConnect: 'INVALID_REQUEST' })
  }
  return sendJson(res, 404, { status: 'FAILED', failedreason: `No stand-in for ${req.method} ${url.pathname}` })
})

// The hosted gateway page. Pay / Pay, then close the window / Fail / Cancel. The way back is a form POST
// to the store, from this (other) site, like SSLCommerz's.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`
const postBack = (action, fields) =>
  page(
    'Returning to the store…',
    `<form id="back" method="post" action="${escapeHtml(action)}">${Object.entries(fields)
      .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
      .join('')}<noscript><button type="submit">Continue</button></noscript></form><script>document.getElementById('back').submit()</script>`,
  )
function makePayment(session) {
  const form = session.form
  const payment = {
    tran_id: form.tran_id,
    val_id: nextId('VAL'),
    amount: form.total_amount,
    bank_tran_id: nextId('BTX'),
    card_type: ssl.nextCard,
    card_brand: /^(BKASH|NAGAD|ROCKET|UPAY)/.test(ssl.nextCard) ? 'MOBILEBANKING' : 'VISA',
    card_issuer: ssl.nextCard.split('-')[1] ?? 'BKash',
    risk_level: ssl.nextRisk,
    risk_title: ssl.nextRisk === '1' ? 'Risky transaction (e2e)' : 'Safe',
    tran_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    value_a: form.value_a,
    value_b: form.value_b,
    validated: false,
  }
  ssl.nextRisk = '0'
  ssl.payments.push(payment)
  return payment
}
const gatewayHandler = async (req, res) => {
  const url = new URL(req.url, GATEWAY)
  const html = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(body)
  }
  if (req.method === 'GET' && url.pathname === '/gwprocess/v4/gw.php') {
    const session = sessionByKey(url.searchParams.get('SESSIONKEY') ?? '')
    if (!session) return html(404, page('No such payment', '<p>This payment session does not exist.</p>'))
    const button = (outcome, label) => `<form method="post" action="/pay/${encodeURIComponent(session.key)}"><input type="hidden" name="outcome" value="${outcome}"><button type="submit">${label}</button></form>`
    return html(
      200,
      page(
        'SSLCommerz stand-in',
        `<p data-tran="${escapeHtml(session.form.tran_id)}">Pay ৳${escapeHtml(session.form.total_amount)} ${escapeHtml(session.form.currency)} to BuyNest for ${escapeHtml(session.form.value_a)}</p>` +
          button('success', 'Pay') +
          button('closed', 'Pay, then close the window') +
          button('fail', 'Fail') +
          button('cancel', 'Cancel'),
      ),
    )
  }
  const pay = url.pathname.match(/^\/pay\/([^/]+)$/)
  if (req.method === 'POST' && pay) {
    const session = sessionByKey(decodeURIComponent(pay[1]))
    const outcome = new URLSearchParams(await readBody(req)).get('outcome')
    if (!session) return html(404, page('No such payment', ''))
    const form = session.form
    if (outcome === 'success' || outcome === 'closed') {
      const payment = makePayment(session)
      if (outcome === 'closed') return html(200, page('Payment complete', `<p>Paid ৳${escapeHtml(payment.amount)}. You can close this window.</p>`))
      return html(200, postBack(form.success_url, signed(paymentFields(payment))))
    }
    const status = outcome === 'fail' ? 'FAILED' : 'CANCELLED'
    ssl.attempts.push({ tran_id: form.tran_id, status, amount: form.total_amount })
    const fields = { tran_id: form.tran_id, status, error: outcome === 'fail' ? 'Insufficient balance (e2e)' : 'Cancelled by the customer', currency: 'BDT', amount: form.total_amount, value_a: form.value_a, value_b: form.value_b, bank_tran_id: '' }
    return html(200, postBack(outcome === 'fail' ? form.fail_url : form.cancel_url, fields))
  }
  return html(404, page('Not found', ''))
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
const call = async (base, path, { method = 'GET', token, body, raw = false } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${base}${path}`, {
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
const api = (path, options) => call(API, path, options)
/** Runs PHP in the backend (local development only): reads and cleanup without an endpoint. */
function tinker(code) {
  const result = spawnSync('php', ['artisan', 'tinker', `--execute=${code}`], { cwd: BACKEND, encoding: 'utf8', timeout: 60_000 })
  if (result.status !== 0) throw new Error(`tinker failed: ${(result.stderr || result.stdout).trim().slice(0, 200)}`)
  return result.stdout.trim()
}
/**
 * An artisan command with the suite API's environment (BDT, SSLCommerz → the stand-in). Asynchronous on
 * purpose: the stand-in runs in this process, so a blocking spawnSync would leave its calls unanswered.
 */
function artisan(args) {
  return new Promise((resolve) => {
    const child = spawn('php', ['artisan', ...args], { cwd: BACKEND, env: suiteEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ status, output })
    })
  })
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const taka = (value) => `৳${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const noDollar = (text) => !/\$\d/.test(text)
/** Where a $ amount shows up in `text` (for failure messages), or 'no $'. */
const dollarAt = (text) => text.match(/.{0,40}\$\d[\d,.]*/)?.[0] ?? 'no $'

/** What buynest:currency:convert may touch, fingerprinted (read-only). */
const PRICE_FINGERPRINT =
  "echo json_encode(['products' => md5(DB::table('products')->orderBy('id')->get(['id', 'price', 'gift_card_amounts', 'gift_card_min_amount', 'gift_card_max_amount'])->toJson())," +
  " 'variants' => md5(DB::table('product_variants')->orderBy('id')->get(['id', 'price'])->toJson()), 'rules' => md5(DB::table('catalog_rules')->orderBy('id')->get(['id', 'amount'])->toJson())," +
  " 'coupons' => md5(DB::table('coupons')->orderBy('id')->get(['id', 'value', 'min_subtotal'])->toJson()), 'rates' => md5(DB::table('shipping_rates')->orderBy('id')->get(['id', 'price', 'min_subtotal', 'max_subtotal'])->toJson())," +
  " 'settings' => md5(DB::table('settings')->orderBy('key')->get(['key', 'value'])->toJson()), 'settings_rows' => DB::table('settings')->count()," +
  " 'cards' => md5(DB::table('gift_cards')->orderBy('id')->get(['id', 'balance', 'initial_balance', 'currency'])->toJson()), 'card_tx' => DB::table('gift_card_transactions')->count()," +
  " 'carts' => md5(DB::table('customer_carts')->orderBy('id')->get(['id', 'subtotal'])->toJson()), 'currency_rates' => md5(DB::table('currency_rates')->orderBy('id')->get(['id', 'rate', 'enabled'])->toJson())," +
  " 'conversions' => DB::table('currency_conversions')->count(), 'audit' => DB::table('audit_log')->where('action', 'currency.converted')->count()]);"
const fingerprint = () => {
  const out = tinker(PRICE_FINGERPRINT)
  return JSON.parse(out.slice(out.indexOf('{')))
}

const DRESS = 166 // Tartan Dress (39.99, minimum order 1, plenty of stock): ৳39.99 in this store
const customer = { firstName: 'Rafi', lastName: `Takason${run}`, email: `taka.${run}@example.com`, password: 'TakaPass2026', phone: '+880 1711 223344' }
const made = { orders: new Set(), customerId: null, giftCard: null }
let savedMethods = null // checkout.enabled_payment_methods before the suite
let browser
let restoreStock = async () => 0
let owner
const errors = []
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const stockOf = async (id) => (await admin$(`/products/${id}`)).body?.data?.stock_quantity

// ---------------------------------------------------------------- Start
try {
  for (const port of PORTS) {
    if (await portOpen(port)) throw new Error(`port ${port} is already in use: stop whatever runs there (an earlier run?)`)
  }
  certDir = mkdtempSync(join(tmpdir(), 'buynest-e2e-sslcommerz-'))
  const cert = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { encoding: 'utf8' })
  if (cert.status !== 0) throw new Error(`openssl could not make a test certificate: ${cert.stderr.slice(0, 200)}`)
  const gateway = createHttpsServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, gatewayHandler)
  servers.push(sslApi, gateway)
  await new Promise((resolve) => sslApi.listen(SSL_PORT, '127.0.0.1', resolve))
  await new Promise((resolve) => gateway.listen(GATEWAY_PORT, '127.0.0.1', resolve))

  const laravel = start(`Laravel API (:${API_PORT})`, 'php', ['artisan', 'serve', '--host=127.0.0.1', `--port=${API_PORT}`, '--no-reload'], {
    cwd: BACKEND,
    env: { ...suiteEnv, PHP_CLI_SERVER_WORKERS: '4' },
  })
  await waitFor(`${API}/api/v1/store`, laravel)
  const store = start(`storefront (:${STORE_PORT})`, process.execPath, [join(FRONTEND, 'node_modules/vite/bin/vite.js'), '--port', String(STORE_PORT), '--strictPort'], {
    cwd: FRONTEND,
    env: { ...process.env, BUYNEST_LARAVEL_URL: API },
  })
  await waitFor(`${STORE}/api/catalog/store`, store)

  // ---------- The isolated setup really is isolated ----------
  const apiStore = (await api('/api/v1/store')).body?.data
  log(
    apiStore?.currency?.code === 'BDT' && apiStore?.currency?.symbol === '৳' && apiStore?.currency?.decimals === 2 && apiStore?.currencies?.base === 'BDT',
    `API on :${API_PORT} charges in taka (currency ${JSON.stringify(apiStore?.currency)}, display base ${apiStore?.currencies?.base})`,
  )
  log(apiStore?.sslcommerz_payments === 'sslcommerz' && apiStore?.paypal_payments === 'unavailable', `…with SSLCommerz online and PayPal unavailable (sslcommerz_payments "${apiStore?.sslcommerz_payments}", paypal_payments "${apiStore?.paypal_payments}")`)
  log(!(apiStore?.payment_methods ?? []).includes('paypal'), `PayPal isn't among the payment methods in BDT (${JSON.stringify(apiStore?.payment_methods)})`)
  const usualStore = await fetch(`${USUAL_API}/api/v1/store`).then((r) => r.json(), () => null)
  log(!usualStore || (usualStore.data?.currency?.code === 'USD' && usualStore.data?.sslcommerz_payments === 'unavailable'), `the usual API on :8000 stays in USD without SSLCommerz (${usualStore?.data?.currency?.code ?? 'not running'}, sslcommerz_payments "${usualStore?.data?.sslcommerz_payments}")`)
  const storeSettings = await fetch(`${STORE}/api/catalog/store`).then((r) => r.json(), () => null)
  const storeCurrency = storeSettings?.data?.currency?.code ?? storeSettings?.currency?.code
  log(storeCurrency === 'BDT', `storefront on :${STORE_PORT} talks to :${API_PORT} (its /api/catalog/store says currency ${storeCurrency})`)

  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  savedMethods = (await admin$('/settings')).body?.data?.checkout?.enabled_payment_methods ?? null
  if (!Array.isArray(savedMethods)) throw new Error('could not read checkout.enabled_payment_methods')
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
  const phone = async (page, name) => {
    const size = page.viewportSize()
    await page.setViewportSize({ width: 390, height: 844 })
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
    // ignoreHTTPSErrors: the stand-in gateway page's certificate is self-signed.
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
  const miniCart = (page) => page.getByRole('dialog', { name: /Your cart/ })
  async function closeMiniCart(page) {
    if (await visible(miniCart(page), 3000)) {
      await page.keyboard.press('Escape')
      await miniCart(page).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }
  async function addDress(page) {
    await page.goto(`${BASE}/products/${DRESS}`, { waitUntil: 'networkidle' })
    await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
    await closeMiniCart(page)
  }
  /** Fills what is still empty at checkout; `phoneNumber: ''` leaves the phone empty. */
  async function fillCheckout(page, { email, phoneNumber = customer.phone } = {}) {
    await page.locator('[name="email"]').waitFor()
    if (email) await page.locator('[name="email"]').fill(email)
    const phoneField = page.locator('[name="phone"]')
    if (phoneNumber === '') await phoneField.fill('')
    else if (!(await phoneField.inputValue())) await phoneField.fill(phoneNumber)
    const fields = { firstName: 'Nusrat', lastName: 'Jahan', line1: '12 Road 7, Dhanmondi', city: 'Dhaka', state: 'Dhaka', postalCode: '1205' }
    for (const [name, value] of Object.entries(fields)) {
      const input = page.locator(`[name="shipping.${name}"]`)
      if ((await input.count()) > 0 && !(await input.inputValue())) await input.fill(value)
    }
    const country = page.locator('[name="shipping.country"]')
    if ((await country.count()) > 0) await country.selectOption('Bangladesh')
  }
  const sslRadio = (page) => page.getByRole('radio', { name: /SSLCommerz/ })
  const continueButton = (page) => page.getByRole('button', { name: 'Continue to SSLCommerz' })
  /** Clicks "Continue to SSLCommerz" and waits for the stand-in gateway page; returns { number, session }. */
  async function toGateway(page, click = () => continueButton(page).click()) {
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking prices/.test(b.textContent)), null, { timeout: 20000 }).catch(() => {})
    await click()
    await page.waitForURL((url) => url.href.startsWith(`${GATEWAY}/gwprocess/`), { timeout: 30000 }).catch(async (error) => {
      const shown = await page
        .locator('[role="alert"], .field__error, .form-error')
        .allInnerTexts()
        .catch(() => [])
      throw new Error(`no gateway page (at ${page.url()}; shown: ${JSON.stringify(shown.filter(Boolean)).slice(0, 300)}): ${error.message.split('\n')[0]}`)
    })
    const session = sessionByKey(new URL(page.url()).searchParams.get('SESSIONKEY'))
    const number = session?.form?.value_a ?? null
    if (number) made.orders.add(number)
    return { number, session }
  }
  /** A guest order with SSLCommerz, up to the gateway page. */
  async function guestToGateway(email) {
    const page = await newPage()
    await addDress(page)
    await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(page, { email })
    await sslRadio(page).check()
    return { page, ...(await toGateway(page)) }
  }
  const gatewayButton = (page, name) => page.getByRole('button', { name, exact: true })
  const backAt = (page, number, payment) => page.waitForURL((url) => url.pathname === `/order-confirmation/${number}` && url.searchParams.get('payment') === payment && url.searchParams.get('provider') === 'sslcommerz', { timeout: 30000 })
  const hero = (page, text) => page.locator('.order-page__hero h1').filter({ hasText: text })
  const row = (page, label) => page.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
  async function download(page, click) {
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()])
    const path = await file.path()
    return { name: file.suggestedFilename(), bytes: path ? readFileSync(path) : Buffer.alloc(0) }
  }
  /** Sends an IPN like SSLCommerz: a form body, through the store's sign-in service (default) or straight to the API. */
  async function ipn(fields, { via = 'store' } = {}) {
    const url = via === 'store' ? `${BASE}/api/payments/sslcommerz/ipn` : `${API}/api/v1/payments/sslcommerz/ipn`
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(fields).toString() })
    return { status: response.status, body: await response.json().catch(() => null) }
  }

  // ---------- 0. buynest:currency:convert --dry-run changes nothing ----------
  await part('currency convert dry run', async () => {
    const before = fingerprint()
    const dry = await artisan(['buynest:currency:convert', 'BDT', '--rate=110', '--dry-run'])
    const after = fingerprint()
    const changed = Object.keys(before).filter((key) => before[key] !== after[key])
    log(dry.status === 0 && /Dry run: nothing is saved/.test(dry.output) && /Dry run finished: nothing was changed\./.test(dry.output), `buynest:currency:convert BDT --rate=110 --dry-run (BUYNEST_CURRENCY=BDT): exit ${dry.status}, "Dry run finished: nothing was changed."`)
    const example = dry.output.match(/\n\s*Products\s*\n\s*([^\n]+)/)?.[1]?.trim()
    log(/\|\s*products\s*\|\s*\d+/.test(dry.output) && /\d\.\d\d\D+\d+\.00/.test(example ?? ''), `…it prints the counts and before/after examples (${(dry.output.match(/products\s*\|\s*\d+/)?.[0] ?? '').replace(/\s+/g, ' ')}; "${example}")`)
    log(changed.length === 0, `…and nothing changed in the database (prices, variants, rules, coupons, rates, settings, gift cards, carts, display rates, conversions, audit${changed.length ? `; changed: ${changed.join(', ')}` : ''})`)
  })

  // ---------- 1. SSLCommerz turned on in Settings → Checkout; the settings page ----------
  await part('admin settings', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const currencyPanel = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'Store currency' }) })
    await currencyPanel.first().waitFor()
    const panelText = (await currencyPanel.first().innerText()).replace(/\s+/g, ' ')
    log(/BDT/.test(panelText) && panelText.includes('৳1,250.00') && /BUYNEST_CURRENCY/.test(panelText) && /docs\/CURRENCY\.md/.test(panelText), `Settings → Store currency: BDT, "for example ৳1,250.00", BUYNEST_CURRENCY, docs/CURRENCY.md`)
    const checkout = admin.locator('form').filter({ has: admin.getByRole('heading', { name: 'Checkout', exact: true }) })
    const box = checkout.getByRole('checkbox', { name: 'bKash, Nagad, cards (SSLCommerz)' })
    log(await visible(box), 'Settings → Checkout lists "bKash, Nagad, cards (SSLCommerz)"')
    const checkoutText = (await checkout.innerText()).replace(/\s+/g, ' ')
    log(/Sandbox/.test(checkoutText) && /Not available in BDT/.test(checkoutText), 'the provider statuses read "Sandbox" (SSLCommerz) and "Not available in BDT" (PayPal)')
    const describedBy = await box.getAttribute('aria-describedby')
    log(Boolean(describedBy), `the SSLCommerz checkbox is described by its status note (aria-describedby "${describedBy}")`)
    if (!(await box.isChecked())) await box.check()
    await checkout.getByRole('button', { name: 'Save checkout' }).click()
    log(await visible(checkout.getByText('Checkout saved.')), 'turned on and saved: "Checkout saved."')
    const methods = (await api('/api/v1/store')).body?.data?.payment_methods ?? []
    log(methods.includes('sslcommerz') && !methods.includes('paypal'), `GET /store now offers ${JSON.stringify(methods)}`)
    await axe(admin, 'admin settings (store currency, SSLCommerz)')
    await admin.context().close()
  })

  // ---------- 2. Prices in taka in the store; the throwaway customer pays with bKash ----------
  let paidA = null // { number, payment }
  await part('prices in taka and a bKash payment', async () => {
    const registered = await api('/api/v1/auth/register', {
      method: 'POST',
      body: { first_name: customer.firstName, last_name: customer.lastName, email: customer.email, phone: customer.phone, password: customer.password, password_confirmation: customer.password, accept_terms: true },
    })
    const verified = registered.status === 201 ? await api('/api/v1/auth/verify-email', { method: 'POST', body: { email: customer.email, code: (await latestCode(customer.email)).code } }) : registered
    made.customerId = ((await admin$(`/customers?search=${encodeURIComponent(customer.email)}`)).body?.data ?? []).find((item) => item.email === customer.email)?.id ?? null
    log(verified.status === 200 && Boolean(made.customerId), `a throwaway customer signed up and confirmed (${customer.email}, #${made.customerId})`)
    if (!made.customerId) throw new Error(`the throwaway customer could not sign up (${registered.status} ${JSON.stringify(registered.body?.errors ?? registered.body?.message)})`)

    const shop = await newPage()
    await storefrontSignIn(shop, customer)

    // Listing, product page, mini cart, cart page.
    await shop.goto(`${BASE}/products`, { waitUntil: 'networkidle' })
    await shop.locator('.product-card').first().waitFor()
    const cards = (await shop.locator('.product-card').allInnerTexts()).join(' ')
    log(/৳\d/.test(cards) && noDollar(cards), `listing: product prices in ৳, no $ (${cards.match(/৳[\d,.]+/)?.[0]})`)
    await shop.goto(`${BASE}/products/${DRESS}`, { waitUntil: 'networkidle' })
    const details = (await shop.locator('.product-details').innerText()).replace(/\s+/g, ' ')
    log(details.includes('৳39.99') && noDollar(details), 'product page: ৳39.99, no $')
    await axe(shop, 'product page in taka')
    await shop.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
    if (await visible(miniCart(shop), 5000)) {
      const drawer = (await miniCart(shop).first().innerText()).replace(/\s+/g, ' ')
      log(drawer.includes('৳39.99') && noDollar(drawer), 'mini cart: ৳39.99, no $')
    } else log(false, 'the mini cart did not open')
    await closeMiniCart(shop)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    const cartText = (await shop.locator('main').innerText()).replace(/\s+/g, ' ')
    log(cartText.includes('৳39.99') && noDollar(cartText), `cart page: ৳39.99, no $ (free shipping progress: "${cartText.match(/[^.]*৳[\d,.]+ (more|away)[^.]*/)?.[0] ?? 'n/a'}")`)

    // Checkout: PayPal not offered, the SSLCommerz choice, a USD gift card refused.
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(shop)
    log((await shop.getByRole('radio', { name: /^PayPal/ }).count()) === 0, 'checkout: PayPal is not offered in a taka store')
    const radio = sslRadio(shop)
    log(await visible(radio), 'checkout offers "bKash, Nagad or card (SSLCommerz)"')
    const choice = shop.locator('.choice-card').filter({ has: radio })
    const choiceText = (await choice.innerText()).replace(/\s+/g, ' ')
    log(/bKash/.test(choiceText) && /Nagad/.test(choiceText) && /Card/.test(choiceText) && /You'll finish paying on SSLCommerz's secure page\./.test(choiceText), `the choice shows bKash / Nagad / Card badges and "You'll finish paying on SSLCommerz's secure page." ("${choiceText}")`)
    const badgeImages = await choice.locator('img').count()
    log(badgeImages === 0, `the badges are text, no logos fetched (${badgeImages} images)`)
    await radio.check()
    log(await visible(continueButton(shop)), 'with SSLCommerz chosen the button reads "Continue to SSLCommerz"')
    log(await visible(shop.getByText('Needed for paying through SSLCommerz, and for delivery updates.')), 'the phone hint says SSLCommerz needs it')
    const summary = (await shop.locator('main').innerText()).replace(/\s+/g, ' ')
    log(/Total\s*৳[\d,.]+/.test(summary) && noDollar(summary), `checkout summary in ৳ (${summary.match(/Total\s*৳[\d,.]+/)?.[0] ?? '?'}; ${dollarAt(summary)})`)

    // A USD gift card can't pay for a taka order.
    const usualOwner = (await call(USUAL_API, '/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
    const card = usualOwner ? await call(USUAL_API, '/api/admin/v1/gift-cards', { method: 'POST', token: usualOwner, body: { amount: 10, recipient_name: `Taka e2e ${run}`, notify_recipient: false } }) : { status: 0 }
    made.giftCard = card.body?.data?.id ?? null
    const code = card.body?.data?.code
    log(card.status === 201 && card.body?.data?.currency === 'USD' && Boolean(code), `a $10.00 USD gift card made on the usual API (#${made.giftCard}, ${card.body?.data?.currency})`)
    if (code) {
      const redeem = shop.locator('.gift-card-redeem')
      await redeem.getByLabel('Gift card').fill(code)
      await redeem.getByRole('button', { name: 'Apply' }).click()
      log(await visible(redeem.getByText('This gift card is in USD, so it can\'t pay for an order in BDT.'), 20000), 'checkout: the USD card is refused: "This gift card is in USD, so it can\'t pay for an order in BDT."')
      const direct = await api('/api/v1/orders', {
        method: 'POST',
        body: {
          guest: { email: `gc.usd.${run}@example.com` },
          email: `gc.usd.${run}@example.com`,
          phone: customer.phone,
          items: [{ product_id: DRESS, quantity: 1 }],
          shipping_address: { first_name: 'Gift', last_name: 'Usd', line1: '1 Test Road', city: 'Dhaka', state: 'Dhaka', postal_code: '1205', country: 'Bangladesh' },
          shipping_method: 'standard',
          payment_method: 'cod',
          gift_card_code: code,
        },
      })
      log(direct.status === 422 && /This gift card is in USD, so it can't pay for an order in BDT\./.test(JSON.stringify(direct.body?.errors?.gift_card_code ?? direct.body?.errors ?? '')), `…and by the API: 422 errors.gift_card_code (${direct.status})`)
      if (direct.status === 201) made.orders.add(direct.body?.data?.number)
      const remove = redeem.getByRole('button', { name: /Remove/ })
      if (await visible(remove, 1000)) await remove.click()
      await redeem.getByLabel('Gift card').fill('')
    }
    await axe(shop, 'checkout with SSLCommerz chosen')
    await phone(shop, 'checkout with SSLCommerz')

    // Pay with bKash.
    const mailBefore = lastMailId(customer.email)
    const stockBefore = await stockOf(DRESS)
    const { number, session } = await toGateway(shop)
    const placed = await orderOf(number)
    log(Boolean(session && placed), `placing the order sends the browser to the stand-in gateway page (${number})`)
    log(placed?.status === 'pending_payment' && placed?.payment_status === 'unpaid' && placed?.currency === 'BDT' && (await stockOf(DRESS)) === stockBefore - 1, `the order waits for its payment, in BDT, stock reserved (${placed?.status}, ${placed?.payment_status}, ${placed?.currency})`)
    const form = session?.form ?? {}
    log(form.store_id === STORE_ID && form.store_passwd === STORE_PASSWORD && form.total_amount === placed?.totals?.amount_due && form.currency === 'BDT' && form.tran_id === `${number}-1`, `session: store id/password, total_amount ${form.total_amount} (amount due ${placed?.totals?.amount_due}), currency ${form.currency}, tran_id ${form.tran_id}`)
    log(
      form.success_url === `${STORE}/api/payments/sslcommerz/return/success` && form.fail_url === `${STORE}/api/payments/sslcommerz/return/fail` && form.cancel_url === `${STORE}/api/payments/sslcommerz/return/cancel` && form.ipn_url === `${STORE}/api/payments/sslcommerz/ipn`,
      `success/fail/cancel/IPN URLs point at the store's sign-in service (${form.success_url})`,
    )
    log(
      form.cus_email === customer.email && Boolean(form.cus_phone) && form.cus_city === 'Dhaka' && form.cus_country === 'Bangladesh' && form.shipping_method === 'YES' && form.ship_city === 'Dhaka' && form.num_of_item === '1' && /Tartan Dress/.test(form.product_name ?? '') && form.product_category === 'General' && form.product_profile === 'general' && form.value_a === number && form.value_b === '1',
      `customer, phone (${form.cus_phone}), shipping, product fields, value_a ${form.value_a}, value_b ${form.value_b}`,
    )
    log(await visible(gatewayButton(shop, 'Pay')), `the gateway page asks for ৳${form.total_amount}`)
    const validationsBefore = ssl.validations.length
    await gatewayButton(shop, 'Pay').click()
    await backAt(shop, number, 'success')
    log(true, `Pay → a cross-site form POST to the store → 303 → /order-confirmation/${number}?payment=success&provider=sslcommerz`)
    log(await visible(hero(shop, 'Payment received — thank you'), 25000), 'the confirmation: "Payment received — thank you"')
    const payment = ssl.payments.find((item) => item.tran_id === `${number}-1`)
    log(ssl.validations.slice(validationsBefore).includes(payment?.val_id), `the API validated val_id ${payment?.val_id} with the stand-in before recording it`)
    log(await visible(shop.getByText(/Paid with bKash \(SSLCommerz\)/)), 'the confirmation says "Paid with bKash (SSLCommerz)"')
    const confirmation = (await shop.locator('main').innerText()).replace(/\s+/g, ' ')
    log(confirmation.includes(taka(placed?.totals?.total)) && noDollar(confirmation), `the confirmation is in ৳ (${taka(placed?.totals?.total)}), no $`)
    const paid = await orderOf(number)
    log(paid?.payment_status === 'paid' && paid?.status === 'processing' && paid?.invoices?.length === 1 && /Paid with bKash through SSLCommerz\./.test(paid?.invoices?.[0]?.note ?? ''), `paid and invoiced ("${paid?.invoices?.[0]?.note}")`)
    log(paid?.payment?.provider === 'sslcommerz' && paid?.payment?.method_label === 'bKash' && paid?.payment?.reference === payment?.bank_tran_id && paid?.payment?.sslcommerz?.val_id === payment?.val_id, `payment: sslcommerz, "${paid?.payment?.method_label}", bank_tran_id ${paid?.payment?.reference}`)
    await axe(shop, 'confirmation (paid with bKash)')
    await phone(shop, 'the confirmation page')
    paidA = { number, payment }

    // The same return posted again: nothing new.
    const repeat = await fetch(`${BASE}/api/payments/sslcommerz/return/success`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(signed(paymentFields(payment))).toString(), redirect: 'manual' })
    log(repeat.status === 303 && (await orderOf(number))?.invoices?.length === 1, `the same return trip again: 303 and still one invoice (${repeat.headers.get('location')})`)

    // Emails.
    const invoiceMail = await waitForMail(customer.email, new RegExp(`Payment received for order ${number}`), { after: mailBefore })
    log(Boolean(invoiceMail) && invoiceMail.text.includes(taka(paid?.totals?.total)) && noDollar(invoiceMail.text), `the invoice email is in ৳ ("${invoiceMail?.subject}", ${taka(paid?.totals?.total)}; ${dollarAt(invoiceMail?.text ?? '')})`)
    const allMails = mailsTo(customer.email, mailBefore)
    log(allMails.length > 0 && allMails.every((mail) => noDollar(mail.text)), `every email to the customer for this order is free of $ amounts (${allMails.map((mail) => mail.subject).join(' | ')})`)

    // Account: orders list, order page, invoice page, PDF.
    await shop.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
    const listRow = shop.locator('main').getByText(number).first()
    await listRow.waitFor()
    const ordersText = (await shop.locator('main').innerText()).replace(/\s+/g, ' ')
    log(ordersText.includes(taka(paid?.totals?.total)) && noDollar(ordersText), `Account → Orders: ${number} at ${taka(paid?.totals?.total)}, no $`)
    await shop.goto(`${BASE}/account/orders/${number}`, { waitUntil: 'networkidle' })
    await shop.getByText(/Paid with bKash \(SSLCommerz\)/).first().waitFor()
    const orderText = (await shop.locator('main').innerText()).replace(/\s+/g, ' ')
    log(orderText.includes(taka(paid?.totals?.total)) && noDollar(orderText), `account order page: items and totals in ৳ (${taka(paid?.totals?.total)}; ${dollarAt(orderText)}), "Paid with bKash (SSLCommerz)"`)
    await axe(shop, 'account order page (SSLCommerz, taka)')
    await phone(shop, 'the account order page')
    const invoiceNumber = paid?.invoices?.[0]?.number
    const pdfButton = shop.getByRole('button', { name: `Download PDF of invoice ${invoiceNumber}` })
    if (await visible(pdfButton, 5000)) {
      const file = await download(shop, () => pdfButton.click())
      const isPdf = file.bytes.subarray(0, 4).toString('latin1') === '%PDF'
      const bengali = /NotoSansBengali/.test(file.bytes.toString('latin1'))
      log(isPdf && bengali, `the invoice PDF (${file.name}, ${file.bytes.length} bytes) embeds Noto Sans Bengali, the font that draws ৳ (the text itself is compressed)`)
    } else log(false, `no "Download PDF of invoice ${invoiceNumber}" button`)
    await shop.goto(`${BASE}/account/orders/${number}/invoices/${invoiceNumber}`, { waitUntil: 'networkidle' })
    await shop.getByText(invoiceNumber).first().waitFor()
    const invoiceText = (await shop.locator('body').innerText()).replace(/\s+/g, ' ')
    log(invoiceText.includes(taka(paid?.totals?.total)) && noDollar(invoiceText), `the printable invoice ${invoiceNumber} is in ৳ (${taka(paid?.totals?.total)}; ${dollarAt(invoiceText)})`)
    await axe(shop, 'printable invoice (taka)')
    await shop.context().close()
  })

  // ---------- 3. Phone required; a failed payment, Pay now, a cancelled one ----------
  let failedB = null
  await part('phone, failed and cancelled payments', async () => {
    const email = `taka.fail.${run}@example.com`
    const page = await newPage()
    await addDress(page)
    await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(page, { email, phoneNumber: '' })
    await sslRadio(page).check()
    const sessionsBefore = ssl.sessions.length
    await continueButton(page).click()
    log(await visible(page.getByText('Enter a phone number: SSLCommerz needs one for bKash, Nagad, and card payments.')), 'no phone: "Enter a phone number: SSLCommerz needs one for bKash, Nagad, and card payments."')
    log(ssl.sessions.length === sessionsBefore && new URL(page.url()).pathname === '/checkout', 'nothing was placed or sent to SSLCommerz')
    await axe(page, 'checkout with the phone message')
    await page.locator('[name="phone"]').fill(customer.phone)
    const { number, session } = await toGateway(page)
    failedB = number
    await gatewayButton(page, 'Fail').click()
    await backAt(page, number, 'failed')
    log(await visible(hero(page, 'Payment failed')), `Fail on the gateway page (${number}): "Payment failed"`)
    const payNow = page.getByRole('button', { name: 'Pay now' })
    log(await visible(payNow), '"Pay now" is offered')
    const failed = await orderOf(number)
    log(failed?.payment_status === 'unpaid' && failed?.status === 'pending_payment' && (failed?.history ?? []).some((entry) => /payment failed \(attempt .*-1\)/.test(entry.note ?? '')), `nothing recorded but a staff note (${failed?.payment_status}, ${failed?.status})`)
    await axe(page, 'confirmation (payment failed)')
    await payNow.click()
    await page.waitForURL((url) => url.href.startsWith(`${GATEWAY}/gwprocess/`), { timeout: 30000 })
    const second = sessionByKey(new URL(page.url()).searchParams.get('SESSIONKEY'))
    log(second && second !== session && second.form.tran_id === `${number}-2` && second.form.value_b === '2', `Pay now opens a new attempt (tran_id ${second?.form?.tran_id})`)
    await gatewayButton(page, 'Cancel').click()
    await backAt(page, number, 'cancelled')
    log(await visible(hero(page, 'Payment not completed')), 'Cancel on the gateway page: "Payment not completed"')
    log(await visible(page.getByRole('button', { name: 'Pay now' })), '"Pay now" is offered again')
    await axe(page, 'confirmation (payment cancelled)')
    await page.context().close()
  })

  // ---------- 4. The return trip missed: the IPN marks it paid ----------
  await part('IPN only', async () => {
    const { page, number } = await guestToGateway(`taka.ipn.${run}@example.com`)
    await gatewayButton(page, 'Pay, then close the window').click()
    await page.getByRole('heading', { name: 'Payment complete' }).waitFor()
    const payment = ssl.payments.find((item) => item.tran_id === `${number}-1`)
    log((await orderOf(number))?.payment_status === 'unpaid', `paid on the gateway, browser never came back (${number}): still unpaid`)
    const badSign = await ipn({ ...signed(paymentFields(payment)), verify_sign: '0'.repeat(32) })
    log(badSign.status === 400 && badSign.body?.message === 'Invalid SSLCommerz notification.', `an IPN with a wrong verify_sign, through the store: ${badSign.status} "${badSign.body?.message}"`)
    const first = await ipn(signed(paymentFields(payment)))
    const paid = await orderOf(number)
    log(first.status === 200 && first.body?.received === true, `the signed IPN through the store: 200 ${JSON.stringify(first.body)} (the store passes on only "received")`)
    log(paid?.payment_status === 'paid' && paid?.invoices?.length === 1 && paid?.payment?.sslcommerz?.val_id === payment?.val_id && ssl.validations.includes(payment?.val_id), `the API validated the val_id; the order is paid and invoiced by the IPN (${paid?.payment_status}, ${paid?.invoices?.length} invoice)`)
    const again = await ipn(signed(paymentFields(payment)), { via: 'api' })
    log(again.status === 200 && again.body?.result === 'duplicate' && (await orderOf(number))?.invoices?.length === 1, `the same IPN again: "${again.body?.result}", still one invoice`)
    await page.goto(`${BASE}/order-confirmation/${number}`, { waitUntil: 'networkidle' })
    log(await visible(page.getByText(/Paid with bKash \(SSLCommerz\)/)), 'the guest\'s confirmation page (email kept in the tab) shows "Paid with bKash (SSLCommerz)"')
    await page.context().close()
  })

  // ---------- 5. A posted VALID with a val_id SSLCommerz doesn't know; then Check payment ----------
  await part('forged return and Check payment', async () => {
    const { page, number } = await guestToGateway(`taka.check.${run}@example.com`)
    const fake = `VALFAKE${RUN}`
    const validationsBefore = ssl.validations.length
    const forged = await fetch(`${BASE}/api/payments/sslcommerz/return/success`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: GATEWAY },
      body: new URLSearchParams({ tran_id: `${number}-1`, val_id: fake, status: 'VALID', value_a: number, amount: '44.98', bank_tran_id: 'FAKE' }).toString(),
      redirect: 'manual',
    })
    const location = forged.headers.get('location')
    log(forged.status === 303 && location === `/order-confirmation/${number}?payment=failed&provider=sslcommerz`, `a posted "VALID" with an unknown val_id: 303 → ${location}`)
    const unpaid = await orderOf(number)
    log(ssl.validations.slice(validationsBefore).includes(fake) && unpaid?.payment_status === 'unpaid' && unpaid?.invoices?.length === 0, `the API asked the stand-in about ${fake}, which says INVALID: not trusted, still unpaid`)
    const forgedIpn = await ipn({ tran_id: `${number}-1`, val_id: fake, status: 'VALID', amount: '44.98', currency: 'BDT' }, { via: 'api' })
    log(forgedIpn.status === 200 && forgedIpn.body?.result === 'invalid' && (await orderOf(number))?.payment_status === 'unpaid', `the same as an IPN: "${forgedIpn.body?.result}", still unpaid`)

    // Paid on SSLCommerz with Nagad, but neither the return trip nor the IPN arrives: staff use Check payment.
    ssl.nextCard = 'NAGAD-Nagad'
    await gatewayButton(page, 'Pay, then close the window').click()
    await page.getByRole('heading', { name: 'Payment complete' }).waitFor()
    ssl.nextCard = 'BKASH-BKash'
    await page.context().close()
    const payment = ssl.payments.find((item) => item.tran_id === `${number}-1`)
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders/${number}`, { waitUntil: 'networkidle' })
    const check = admin.getByRole('button', { name: 'Check payment' })
    log(await visible(check), `admin order ${number} (unpaid SSLCommerz): "Check payment"`)
    await axe(admin, 'admin order (unpaid SSLCommerz, Check payment)')
    const queriesBefore = ssl.queries.length
    await check.click()
    const message = `Payment found and recorded: ${taka(payment?.amount)} (NAGAD-Nagad). The order was invoiced.`
    log(await visible(admin.getByRole('status').filter({ hasText: message }), 20000), `Check payment: "${message}"`)
    log(ssl.queries.slice(queriesBefore).includes(`${number}-1`), 'the API asked the stand-in\'s transaction query API by tran_id')
    const checked = await orderOf(number)
    log(checked?.payment_status === 'paid' && checked?.invoices?.length === 1 && checked?.payment?.method_label === 'Nagad', `recorded: paid, invoiced, "${checked?.payment?.method_label}"`)
    await row(admin, 'Paid with').waitFor()
    log(/Nagad \(SSLCommerz\)/.test(await row(admin, 'Paid with').innerText()), `the order page now says "Paid with ${await row(admin, 'Paid with').innerText()}"`)
    const audit = (await admin$(`/audit?action=order.payment_checked&subject_type=order&subject_id=${checked?.id}`)).body?.data ?? []
    log(audit.some((entry) => entry.action === 'order.payment_checked'), `audit: order.payment_checked (${audit.length} entry)`)

    // Not found: the failed/cancelled order.
    if (failedB) {
      await admin.goto(`${BASE}/admin/orders/${failedB}`, { waitUntil: 'networkidle' })
      await admin.getByRole('button', { name: 'Check payment' }).click()
      const notFound = 'SSLCommerz has no completed payment for this order (2 attempts checked).'
      log(await visible(admin.getByRole('status').filter({ hasText: notFound }), 20000), `Check payment on ${failedB}: "${notFound}"`)
      log((await orderOf(failedB))?.payment_status === 'unpaid', '…and it stays unpaid')
      log((await row(admin, 'Payment attempts').innerText()).trim() === '2', `Payment attempts: ${(await row(admin, 'Payment attempts').innerText()).trim()}`)
    }
    await admin.context().close()
  })

  // ---------- 6. Risk level 1: on hold ----------
  await part('risky payment on hold', async () => {
    const { page, number } = await guestToGateway(`taka.risk.${run}@example.com`)
    ssl.nextRisk = '1'
    await gatewayButton(page, 'Pay').click()
    await backAt(page, number, 'success')
    log(await visible(hero(page, "We're checking your payment"), 25000), `risk level 1 (${number}): "We're checking your payment"`)
    log(!(await visible(page.getByRole('button', { name: 'Pay now' }), 1500)), 'no Pay now while it is checked')
    const held = await orderOf(number)
    log(held?.payment_status === 'review' && held?.status === 'pending_payment' && held?.invoices?.length === 0 && held?.payment?.sslcommerz?.risk_level === '1', `on hold: ${held?.payment_status}, ${held?.status}, no invoice, risk_level ${held?.payment?.sslcommerz?.risk_level}`)
    const notes = ((await admin$('/notifications?per_page=50')).body?.data ?? []).filter((item) => item.link === `/orders/${number}`)
    log(notes.some((item) => item.title === `Payment on hold for order ${number}`), `admin notification "Payment on hold for order ${number}"`)
    await axe(page, 'confirmation (payment being checked)')
    await page.context().close()
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders/${number}`, { waitUntil: 'networkidle' })
    log(await visible(admin.getByText('On hold (risk check)').first()), 'admin order page: "On hold (risk check)"')
    await row(admin, 'Risk check').waitFor()
    log(/High/.test(await row(admin, 'Risk check').innerText()), `Risk check: "${(await row(admin, 'Risk check').innerText()).replace(/\s+/g, ' ').slice(0, 120)}"`)
    log((await admin.getByRole('button', { name: 'Refund', exact: true }).count()) === 0, 'no Refund button while on hold')
    await axe(admin, 'admin order (on hold)')
    await admin.goto(`${BASE}/admin/orders?payment_status=review`, { waitUntil: 'networkidle' })
    log(await visible(admin.locator('tbody tr').filter({ hasText: number })), 'the Orders grid filtered by "review" lists it')
    await admin.context().close()
  })

  // ---------- 7. Expiry: an unpaid order is cancelled, a paid-but-unheard one is recorded ----------
  await part('expiry', async () => {
    const { page, number: paidLate } = await guestToGateway(`taka.expiry.${run}@example.com`)
    await gatewayButton(page, 'Pay, then close the window').click()
    await page.getByRole('heading', { name: 'Payment complete' }).waitFor()
    await page.context().close()
    const numbers = [failedB, paidLate].filter(Boolean)
    tinker(`App\\Models\\Order::whereIn('number', [${numbers.map((n) => `'${n}'`).join(', ')}])->update(['payment_expires_at' => now()->subMinutes(5)]);`)
    const stockBefore = await stockOf(DRESS)
    const mailBefore = failedB ? lastMailId(`taka.fail.${run}@example.com`) : 0
    const queriesBefore = ssl.queries.length
    const expiry = await artisan(['buynest:payments:expire-sslcommerz'])
    log(expiry.status === 0 && /paid 1/.test(expiry.output) && /cancelled 1/.test(expiry.output), `buynest:payments:expire-sslcommerz (suite env): "${expiry.output.trim().split('\n').pop()}"`)
    log(ssl.queries.slice(queriesBefore).includes(`${failedB}-2`) && ssl.queries.slice(queriesBefore).includes(`${failedB}-1`), 'it asked SSLCommerz about every attempt before cancelling')
    const cancelled = failedB ? await orderOf(failedB) : null
    log(cancelled?.status === 'cancelled' && cancelled?.payment_status === 'unpaid' && (await stockOf(DRESS)) === stockBefore + 1, `${failedB}: cancelled, stock back (+1)`)
    const mail = failedB ? await waitForMail(`taka.fail.${run}@example.com`, /Payment not completed/i, { after: mailBefore }) : null
    log(Boolean(mail) && noDollar(mail.text), `the "Payment not completed" email ("${mail?.subject}"), no $`)
    const recorded = await orderOf(paidLate)
    log(recorded?.payment_status === 'paid' && recorded?.status === 'processing' && recorded?.invoices?.length === 1, `${paidLate}: SSLCommerz said it was paid, so it was recorded instead (${recorded?.payment_status}, ${recorded?.invoices?.length} invoice)`)
    const second = await artisan(['buynest:payments:expire-sslcommerz'])
    log(second.status === 0 && (await orderOf(failedB))?.status === 'cancelled' && (await stockOf(DRESS)) === stockBefore + 1, `a second run changes nothing ("${second.output.trim().split('\n').pop()}")`)
  })

  // ---------- 8. The admin: currency everywhere, the SSLCommerz payment, refunds ----------
  await part('admin', async () => {
    if (!paidA) throw new Error('no order paid with bKash to look at')
    const { number, payment } = paidA
    const admin = await adminPage()

    // Dashboard and reports.
    const overview = (await admin.locator('main').innerText()).replace(/\s+/g, ' ')
    log(/৳[\d,.]+/.test(overview), `dashboard: money in ৳ (${overview.match(/৳[\d,.]+[KM]?/)?.[0]})`)
    const latest = admin.locator('tbody tr').filter({ hasText: number })
    if (await visible(latest, 3000)) log(/৳/.test(await latest.first().innerText()), `dashboard latest orders: ${number} in ৳`)
    const sales = (await admin$('/reports/sales')).body?.data
    log(sales?.currency === 'BDT' && Array.isArray(sales?.other_currencies), `sales report API: currency ${sales?.currency}, other currencies ${JSON.stringify((sales?.other_currencies ?? []).map((item) => item.currency))}`)
    await admin.goto(`${BASE}/admin/reports`, { waitUntil: 'networkidle' })
    await admin.getByRole('heading', { level: 1 }).first().waitFor()
    const reportText = (await admin.locator('main').innerText()).replace(/\s+/g, ' ')
    if ((sales?.other_currencies ?? []).length > 0) {
      log(await visible(admin.getByRole('heading', { name: 'Orders in other currencies' })), 'reports: "Orders in other currencies" (the USD orders, never added to the ৳ totals)')
      log(/BDT orders only/.test(reportText) && /৳/.test(reportText) && /\$/.test(reportText), 'reports: tiles in ৳ ("BDT orders only"), the USD row in $')
    } else log(/৳/.test(reportText), 'reports: tiles in ৳')
    await axe(admin, 'admin reports (taka)')

    // The orders grid.
    await admin.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' })
    const gridRow = admin.locator('tbody tr').filter({ hasText: number })
    await gridRow.first().waitFor()
    log(/৳/.test(await gridRow.first().innerText()), `Orders grid: ${number} in ৳`)
    const usdOrder = ((await admin$('/orders?per_page=100')).body?.data ?? []).find((item) => item.currency === 'USD')?.number
    if (usdOrder) {
      await admin.goto(`${BASE}/admin/orders?q=${usdOrder}`, { waitUntil: 'networkidle' })
      const usdRow = admin.locator('tbody tr').filter({ hasText: usdOrder })
      await usdRow.first().waitFor()
      log(/\$\d/.test(await usdRow.first().innerText()) && !/৳/.test(await usdRow.first().innerText()), `an older USD order (${usdOrder}) keeps $ in the same grid`)
    } else log(false, 'no older USD order found to compare')

    // The order page.
    await admin.goto(`${BASE}/admin/orders/${number}`, { waitUntil: 'networkidle' })
    await row(admin, 'Paid through').waitFor()
    log(/SSLCommerz/.test(await row(admin, 'Paid through').innerText()) && (await row(admin, 'Paid through').getByText('Sandbox').isVisible()), `admin order ${number}: paid through SSLCommerz, "Sandbox"`)
    log((await row(admin, 'Paid with').innerText()).trim() === 'bKash (SSLCommerz)', `"Paid with bKash (SSLCommerz)"`)
    log((await row(admin, 'Bank transaction ID').innerText()).includes(payment.bank_tran_id) && (await row(admin, 'Validation ID').innerText()).includes(payment.val_id) && (await row(admin, 'Transaction ID').innerText()).includes(`${number}-1`), `Bank transaction ID ${payment.bank_tran_id}, Validation ID ${payment.val_id}, Transaction ID ${number}-1`)
    log(/Low/.test(await row(admin, 'Risk check').innerText()) && (await row(admin, 'Payment attempts').innerText()).trim() === '1', 'Risk check: Low; Payment attempts: 1')
    const refundable = await orderOf(number)
    const orderText = (await admin.locator('main').innerText()).replace(/\s+/g, ' ')
    log(orderText.includes(taka(refundable?.totals?.total)) && noDollar(orderText), `the order page's money is in ৳ (${taka(refundable?.totals?.total)}; ${dollarAt(orderText)})`)
    await axe(admin, 'admin order (SSLCommerz, paid)')
    await phone(admin, 'the admin order page')

    // A refund SSLCommerz refuses: nothing saved.
    const stockBefore = await stockOf(DRESS)
    ssl.refuseRefund = 'The stand-in refuses this refund (e2e)'
    await admin.getByRole('button', { name: 'Refund', exact: true }).click()
    let dialog = admin.getByRole('dialog')
    log(await visible(dialog.getByText(/goes back through SSLCommerz/)), 'the refund dialog says the money goes back through SSLCommerz')
    await dialog.getByLabel(/Quantity of .* to refund/).first().fill('1')
    const refundButton = dialog.getByRole('button', { name: /^Refund ৳/ })
    log(await visible(refundButton), `the refund button is in ৳ ("${await refundButton.innerText().catch(() => '?')}")`)
    await axe(admin, 'admin refund dialog (SSLCommerz)')
    await refundButton.click()
    log(await visible(dialog.getByText('SSLCommerz refused the refund: The stand-in refuses this refund (e2e).')), "a refused refund shows SSLCommerz's reason")
    const unchanged = await orderOf(number)
    log(ssl.refunds.at(-1)?.answer?.status === 'failed' && unchanged?.credit_memos?.length === 0 && unchanged?.payment_status === 'paid' && (await stockOf(DRESS)) === stockBefore, `…and nothing is saved (${unchanged?.credit_memos?.length} credit memos, ${unchanged?.payment_status})`)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'hidden' })

    // The refund again, accepted.
    const refundsBefore = ssl.refunds.length
    await admin.getByRole('button', { name: 'Refund', exact: true }).click()
    dialog = admin.getByRole('dialog')
    await dialog.getByLabel(/Quantity of .* to refund/).first().fill('1')
    await dialog.getByRole('button', { name: /^Refund ৳/ }).click()
    log(await visible(admin.getByText(/SSLCommerz is returning the money to the customer/)), 'the refund succeeds: "SSLCommerz is returning the money to the customer"')
    const refunded = await orderOf(number)
    const memo = refunded?.credit_memos?.[0]
    const sent = ssl.refunds.slice(refundsBefore)[0]
    log(sent?.query?.bank_tran_id === payment.bank_tran_id && sent?.query?.refund_amount === memo?.total && sent?.query?.refe_id === `${number}-CM1` && /Refund for order/.test(sent?.query?.refund_remarks ?? ''), `the stand-in got the refund: bank_tran_id ${sent?.query?.bank_tran_id}, refund_amount ${sent?.query?.refund_amount} (memo ${memo?.total}), refe_id ${sent?.query?.refe_id}`)
    log(Boolean(memo?.refund_reference) && memo?.refund_reference === sent?.answer?.refund_ref_id && memo?.currency === 'BDT', `credit memo ${memo?.number} keeps SSLCommerz's refund_ref_id (${memo?.refund_reference}), in ${memo?.currency}`)
    log((refunded?.history ?? []).some((entry) => /৳[\d,.]+ refunded through SSLCommerz/.test(entry.note ?? '')), 'the history says "… ৳… refunded through SSLCommerz."')
    if (memo?.number) {
      await admin.goto(`${BASE}/admin/credit-memos/${memo.number}`, { waitUntil: 'networkidle' })
      await admin.getByText(memo.number).first().waitFor()
      const memoText = (await admin.locator('main').innerText()).replace(/\s+/g, ' ')
      log(memoText.includes(taka(memo.total)) && noDollar(memoText), `admin credit memo page ${memo.number}: ${taka(memo.total)}, no $`)
    }
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
  await attempt('payment methods', async () => {
    if (!savedMethods) return
    const now = (await admin$('/settings')).body?.data?.checkout?.enabled_payment_methods
    if (JSON.stringify(now) !== JSON.stringify(savedMethods)) {
      const answer = await admin$('/settings', { method: 'PATCH', body: { checkout: { enabled_payment_methods: savedMethods } } })
      if (answer.status !== 200) throw new Error(`PATCH settings answered ${answer.status} ${JSON.stringify(answer.body?.errors ?? answer.body?.message)}`)
    }
  })
  const numbers = [...made.orders].filter(Boolean)
  await attempt('test orders', async () => {
    // Unpaid (and on-hold) orders are cancelled; the customer's paid ones move on to Delivered so it can be deleted.
    for (const number of numbers) {
      const order = (await admin$(`/orders/${number}`)).body?.data
      if (!order) continue
      if (order.status === 'pending_payment' || (order.status === 'processing' && order.payment_status === 'unpaid')) await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
      else if (order.email === customer.email && order.status === 'processing') {
        await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'shipped', notify_customer: false } })
        await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'delivered', notify_customer: false } })
      }
    }
  })
  await attempt('the throwaway customer', async () => {
    if (!made.customerId) return
    const deleted = await admin$(`/customers/${made.customerId}`, { method: 'DELETE' })
    if (deleted.status !== 204) throw new Error(`DELETE customer answered ${deleted.status} ${JSON.stringify(deleted.body?.errors ?? deleted.body?.message)}`)
  })
  await attempt('USD gift card', async () => {
    if (made.giftCard && (await admin$(`/gift-cards/${made.giftCard}`)).body?.data?.status === 'active') await admin$(`/gift-cards/${made.giftCard}`, { method: 'PATCH', body: { status: 'disabled' } })
  })
  await attempt('notifications and payment events', () => {
    if (!numbers.length) return
    const links = numbers.map((number) => `'/orders/${number}'`).join(',')
    const likes = numbers.map((number) => `->orWhere('id', 'like', 'return:${number}-%')->orWhere('id', 'like', '${number}-%')`).join('')
    tinker(
      `$ids = App\\Models\\AdminNotification::where('type', 'payment_problem')->whereIn('link', [${links}])->pluck('id');` +
        ` DB::table('admin_notification_reads')->whereIn('notification_id', $ids)->delete(); App\\Models\\AdminNotification::whereIn('id', $ids)->delete();` +
        ` DB::table('payment_events')->where('provider', 'sslcommerz')->where(fn ($q) => $q->where('id', 'like', 'VAL${RUN}%')${likes})->delete();`,
    )
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  const methods = (await admin$('/settings')).body?.data?.checkout?.enabled_payment_methods
  const open = []
  for (const number of numbers) if ((await orderOf(number))?.status === 'pending_payment') open.push(number)
  const leftCustomer = ((await admin$(`/customers?search=${encodeURIComponent(customer.email)}`)).body?.data ?? []).length
  const leftNotes = ((await admin$('/notifications?per_page=50')).body?.data ?? []).filter((item) => numbers.some((number) => item.link === `/orders/${number}`))
  const cardActive = made.giftCard ? (await admin$(`/gift-cards/${made.giftCard}`)).body?.data?.status === 'active' : false
  const methodsBack = !savedMethods || JSON.stringify(methods) === JSON.stringify(savedMethods)
  log(
    problems.length === 0 && methodsBack && open.length === 0 && leftCustomer === 0 && leftNotes.length === 0 && !cardActive,
    `cleanup: payment methods back to ${JSON.stringify(savedMethods)}, unpaid test orders cancelled, the throwaway customer deleted, the USD gift card disabled, notifications and payment events removed, stock put back (orders, invoices, credit memos stay)${problems.length || !methodsBack || open.length || leftCustomer || leftNotes.length || cardActive ? ` — left: ${[...problems, `methods ${JSON.stringify(methods)}`, ...open, `${leftCustomer} customer`, ...leftNotes.map((item) => item.title), `card active ${cardActive}`].join('; ')}` : ''}`,
  )
}
