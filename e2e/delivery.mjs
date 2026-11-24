// Phase 14, end to end in a real browser: Bangladesh delivery and cash on delivery (docs/backend/PHASE14_CONTRACT.md,
// docs/BANGLADESH.md). Nothing reaches SSLCommerz.
//
// The suite starts its own servers and stops them at the end (also on failure and Ctrl+C), like taka.mjs:
//   - a stand-in for SSLCommerz's API on http://127.0.0.1:12141 (session create, validation, transaction query) and its
//     hosted "gateway page" on https://127.0.0.1:12142 (a throwaway self-signed certificate made with openssl), which
//     sends the browser back like SSLCommerz: a cross-site form POST to the store's success/fail/cancel URL
//   - a second Laravel API on :8013 with BUYNEST_CURRENCY=BDT and SSLCommerz switched on through the process environment
//     (which wins over backend/.env), so the advance delivery charge can be paid
//   - a second storefront dev server on :5183 pointed at it (BUYNEST_LARAVEL_URL); the admin comes through it at /admin
// Both APIs share the dev database. No .env file is changed.
//
// Checks: Settings → Checkout (Default country Bangladesh, SSLCommerz) and Settings → Cash on delivery (fee, zones) in the
// admin; a zone rate with its delivery days made in Settings → Table rates; the places API in both languages; the
// Division → District → Area form at checkout and in the address book in English and Bangla (postcode filled for an area
// with one, a Dhaka thana (Banani) and an upazila outside Dhaka (Rajnagar)), Bangladeshi mobile messages (shape, operator)
// and normalisation; Inside vs Outside Dhaka charges with "Delivery in 1–2 days" (Bangla digits in Bangla); cash on
// delivery with its fee line, refused outside its zones and over its limit (checkout and API); the advance delivery charge
// paid through the SSLCommerz stand-in (partly paid, cash due shown to the shopper and the admin) and an unpaid advance
// expiring; confirmation by phone (Sales → To confirm: Couldn't reach, Confirmed and the cod_confirmed email; shipping
// blocked until confirmed, then the override with a reason); the collection dialog (full, short with a note); packing
// slip PDFs (one, bulk) and the courier CSV (BOM, header, a Bangla row, 11-digit phones); axe and 390px; other countries
// unchanged.
//
// Left behind on purpose: orders, invoices, emails (like the other suites). Put back or removed: Settings → Checkout
// (default country, payment methods, allowed countries) and Cash on delivery as read at the start, the table rates made
// here, the throwaway customer (its addresses with it; its orders moved on first), notifications and payment events of
// the test orders, saved carts, stock. Unpaid test orders are cancelled. Delivery zones are only read (checked unchanged).
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SSL_PORT = 12141
const GATEWAY_PORT = 12142
const API_PORT = 8013
const STORE_PORT = 5183
const PORTS = [SSL_PORT, GATEWAY_PORT, API_PORT, STORE_PORT]
const API = `http://127.0.0.1:${API_PORT}`
const STORE = `http://localhost:${STORE_PORT}`
const GATEWAY = `https://127.0.0.1:${GATEWAY_PORT}`
const STORE_ID = 'buyne2edelivery'
const STORE_PASSWORD = 'buyne2edelivery@ssl'
const BACKEND = join(import.meta.dirname, '..', 'backend')
const FRONTEND = join(import.meta.dirname, '..', 'frontend')

// lib.mjs reads these when it loads: this suite's storefront and API, not the usual ones.
process.env.BASE_URL = STORE
process.env.LARAVEL_URL = API
const lib = await import('./lib.mjs')
const { ADMIN_USER, BASE, LARAVEL, SHOPPER, SHOPPER_2, adminSignIn, axeViolations, clearSavedCart, latestCode, preserveStock, reporter, sidewaysOverflow, storefrontSignIn, visible, watchErrors } = lib

const report = reporter('delivery: Bangladesh addresses, delivery zones, cash on delivery (fee, limit, advance, confirmation, collection), slips and courier CSV')
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
const BN_DIGITS = '০১২৩৪৫৬৭৮৯'
const bnDigits = (text) => String(text).replace(/[0-9]/g, (digit) => BN_DIGITS[Number(digit)])
const hasBangla = (text) => /[ঀ-৿]/.test(text ?? '')
const squash = (text) => String(text ?? '').replace(/\s+/g, ' ')
const cents = (value) => Math.round(Number(value) * 100)
const money = (value) => (cents(value) / 100).toFixed(2)
const taka = (value) => `৳${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The API's environment: also used for the artisan command, so it sees the same store. */
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

// ---------------------------------------------------------------- SSLCommerz stand-in (as in taka.mjs)
const ssl = { sessions: [], payments: [], attempts: [], validations: [], queries: [] }
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
  card_issuer: 'BKash',
  card_brand: 'MOBILEBANKING',
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
  risk_level: '0',
  risk_title: 'Safe',
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
  if (req.method === 'POST' && url.pathname === '/gwprocess/v4/api.php') {
    if (!authorized) return sendJson(res, 200, { status: 'FAILED', failedreason: 'Store Credential Error Or Store is De-active' })
    const key = nextId('SK')
    const page = `${GATEWAY}/gwprocess/v4/gw.php?Q=pay&SESSIONKEY=${key}`
    ssl.sessions.push({ key, form, url: page })
    return sendJson(res, 200, { status: 'SUCCESS', failedreason: '', sessionkey: key, gw: { mobilebanking: 'bkash,nagad' }, redirectGatewayURL: page, GatewayPageURL: page, storeBanner: '', storeLogo: '', desc: [], is_direct_pay_enable: '0' })
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
    if (query.tran_id) {
      ssl.queries.push(query.tran_id)
      const element = [
        ...ssl.payments.filter((item) => item.tran_id === query.tran_id).map((payment) => validationAnswer(payment)),
        ...ssl.attempts.filter((item) => item.tran_id === query.tran_id).map((item) => ({ tran_id: item.tran_id, val_id: '', status: item.status, amount: item.amount, currency_type: 'BDT', bank_tran_id: '' })),
      ]
      return sendJson(res, 200, { APIConnect: 'DONE', no_of_trans_found: element.length, element })
    }
    return sendJson(res, 200, { APIConnect: 'INVALID_REQUEST' })
  }
  return sendJson(res, 404, { status: 'FAILED', failedreason: `No stand-in for ${req.method} ${url.pathname}` })
})
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
    card_type: 'BKASH-BKash',
    tran_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    value_a: form.value_a,
    value_b: form.value_b,
    validated: false,
  }
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
    return html(200, page('SSLCommerz stand-in', `<p>Pay ৳${escapeHtml(session.form.total_amount)} ${escapeHtml(session.form.currency)} to BuyNest for ${escapeHtml(session.form.value_a)}</p>` + button('success', 'Pay') + button('cancel', 'Cancel')))
  }
  const pay = url.pathname.match(/^\/pay\/([^/]+)$/)
  if (req.method === 'POST' && pay) {
    const session = sessionByKey(decodeURIComponent(pay[1]))
    const outcome = new URLSearchParams(await readBody(req)).get('outcome')
    if (!session) return html(404, page('No such payment', ''))
    const form = session.form
    if (outcome === 'success') return html(200, postBack(form.success_url, signed(paymentFields(makePayment(session)))))
    ssl.attempts.push({ tran_id: form.tran_id, status: 'CANCELLED', amount: form.total_amount })
    return html(200, postBack(form.cancel_url, { tran_id: form.tran_id, status: 'CANCELLED', error: 'Cancelled by the customer', currency: 'BDT', amount: form.total_amount, value_a: form.value_a, value_b: form.value_b, bank_tran_id: '' }))
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const call = async (base, path, { method = 'GET', token, body, raw = false, headers = {} } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: raw ? 'application/pdf, text/csv, application/json' : 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
      body: body && JSON.stringify(body),
    })
    if (response.status === 429 && attempt < 4) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    if (raw) return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) }
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) }
  }
}
const api = (path, options) => call(API, path, options)
/** Runs PHP in the backend (local development only): reads and cleanup without an endpoint. */
function tinker(code) {
  const result = spawnSync('php', ['artisan', 'tinker', `--execute=${code}`], { cwd: BACKEND, encoding: 'utf8', timeout: 60_000 })
  if (result.status !== 0) throw new Error(`tinker failed: ${(result.stderr || result.stdout).trim().slice(0, 200)}`)
  return result.stdout.trim()
}
/** An artisan command with the suite API's environment. Asynchronous: the stand-in runs in this process. */
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
/** Every email to `email` after the id `after`, newest last. */
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
    await sleep(500)
  }
  return null
}
const lastMailId = (email) => mailsTo(email).at(-1)?.id ?? 0
/** The text of a PDF through pdftotext (null when it isn't installed). */
function pdfText(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'buynest-e2e-delivery-pdf-'))
  try {
    const file = join(dir, 'slip.pdf')
    writeFileSync(file, bytes)
    const result = spawnSync('pdftotext', ['-enc', 'UTF-8', '-layout', file, '-'], { encoding: 'utf8' })
    if (result.error || result.status !== 0) return null
    return result.stdout
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
/** A small CSV reader (quoted fields, "" escapes, commas and newlines inside quotes). */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const DRESS = 166 // Tartan Dress (on sale, plenty of stock, 8 g): its price reads as taka in this store
const customer = { firstName: 'Shuvo', lastName: `Deliveryson${run}`, email: `delivery.${run}@example.com`, password: 'DeliveryPass2026', phone: '+880 1711 556677' }
const PLACES = {
  dhaka: { division: 'Dhaka', divisionBn: 'ঢাকা', district: 'Dhaka', districtBn: 'ঢাকা' },
  banani: { area: 'Banani', areaBn: 'বনানী' },
  dhanmondi: { area: 'Dhanmondi', areaBn: 'ধানমন্ডি', postcode: '1209' },
  sylhet: { division: 'Sylhet', divisionBn: 'সিলেট', district: 'Moulvibazar', districtBn: 'মৌলভীবাজার', area: 'Rajnagar', areaBn: 'রাজনগর', postcode: '3240' },
}
const ids = {} // place ids, looked up through the places API at the start
const RATE = { inside: { price: '60.00', min: 1, max: 2 }, suburbs: { price: '100.00', min: 2, max: 3 }, outside: { price: '120.00', min: 3, max: 5 } }
const COD_FEE = '20.00'
const made = { orders: new Set(), customerId: null, rates: [] }
const saved = { checkout: null, cod: null, rateIds: null, zones: null }
let browser
let restoreStock = async () => 0
let owner
let shopperToken = null
const errors = []
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const stockOf = async (id) => (await admin$(`/products/${id}`)).body?.data?.stock_quantity
const zonesFingerprint = async () => {
  const zones = (await admin$('/delivery-zones')).body?.data ?? []
  return JSON.stringify(zones.map((zone) => [zone.id, zone.code, zone.name, zone.bn_name, zone.position, zone.is_active, zone.is_fallback, zone.districts.map((d) => d.id), zone.areas.map((a) => a.id)]))
}
const patchSettings = async (body) => {
  const answer = await admin$('/settings', { method: 'PATCH', body })
  if (answer.status !== 200) throw new Error(`PATCH settings ${JSON.stringify(body)} answered ${answer.status} ${JSON.stringify(answer.body?.errors ?? answer.body?.message)}`)
  return answer.body?.data
}
/** A Bangladesh address for API calls. */
const bdAddress = (area, extra = {}) => ({
  first_name: 'Karim',
  last_name: 'Uddin',
  line1: 'House 7, Road 11',
  country: 'Bangladesh',
  division_id: area === 'rajnagar' ? ids.sylhet : ids.dhakaDivision,
  district_id: area === 'rajnagar' ? ids.moulvibazar : ids.dhakaDistrict,
  area_id: ids[area],
  ...extra,
})

// ---------------------------------------------------------------- Start
try {
  for (const port of PORTS) {
    if (await portOpen(port)) throw new Error(`port ${port} is already in use: stop whatever runs there (an earlier run?)`)
  }
  certDir = mkdtempSync(join(tmpdir(), 'buynest-e2e-delivery-'))
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

  const apiStore = (await api('/api/v1/store')).body?.data
  log(apiStore?.currency?.code === 'BDT' && apiStore?.sslcommerz_payments === 'sslcommerz', `API on :${API_PORT} charges in taka with SSLCommerz online (${apiStore?.currency?.code}, sslcommerz_payments "${apiStore?.sslcommerz_payments}")`)

  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  const settings = (await admin$('/settings')).body?.data
  if (!settings?.checkout || !settings?.cod) throw new Error('could not read Settings → Checkout and Cash on delivery')
  saved.checkout = { allowed_countries: settings.checkout.allowed_countries, enabled_payment_methods: settings.checkout.enabled_payment_methods, default_country: settings.checkout.default_country ?? null }
  saved.cod = { ...settings.cod }
  saved.rateIds = new Set(((await admin$('/shipping-rates')).body?.data ?? []).map((rate) => rate.id))
  saved.zones = await zonesFingerprint()
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
    await page.waitForTimeout(400)
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
      // Where it stopped, for whoever reads the failure (DELIVERY_SHOTS=<dir>).
      if (process.env.DELIVERY_SHOTS && lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: join(process.env.DELIVERY_SHOTS, `${name.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {})
    }
  }
  let lastPage = null
  async function newPage({ viewport = { width: 1280, height: 900 }, lang } = {}) {
    // ignoreHTTPSErrors: the stand-in gateway page's certificate is self-signed.
    const context = await browser.newContext({ viewport, bypassCSP: true, ignoreHTTPSErrors: true, acceptDownloads: true })
    context.setDefaultTimeout(15000)
    if (lang) await context.addCookies([{ name: 'buynest_lang', value: lang, url: BASE }])
    lastPage = watchErrors(await context.newPage(), errors)
    return lastPage
  }
  async function adminPage() {
    const admin = await newPage({ viewport: { width: 1440, height: 900 } })
    await adminSignIn(admin, ADMIN_USER)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    return admin
  }
  /** The throwaway customer, signed in (in English), then in `lang`. */
  async function shopperPage(lang = 'en') {
    const shop = await newPage()
    await storefrontSignIn(shop, customer)
    // The account's language (saved by an earlier switch) applies once the account has loaded.
    await shop.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    await shop.waitForTimeout(500)
    // The header switch, like a shopper (signed in, it also becomes the account's language, so English pages switch back).
    if ((await shop.evaluate(() => document.documentElement.lang)) !== lang) {
      await shop.locator('.site-header').getByRole('button', { name: lang === 'bn' ? 'বাংলা' : 'English', exact: true }).click()
      await shop.waitForFunction((want) => document.documentElement.lang === want, lang, { timeout: 10000 })
    }
    return shop
  }
  const mainText = async (page) => squash(await page.locator('main').innerText())
  async function closeMiniCart(page) {
    const drawer = page.getByRole('dialog', { name: /Your cart|আপনার কার্ট/ })
    if (await visible(drawer, 3000)) {
      await page.keyboard.press('Escape')
      await drawer.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }
  async function addDress(page) {
    await page.goto(`${BASE}/products/${DRESS}`, { waitUntil: 'networkidle' })
    await page.locator('.product-details').getByRole('button', { name: /add to cart|কার্টে যোগ/i }).first().click()
    await closeMiniCart(page)
  }
  /** Chooses `label` in the <select name=…> once its list has it. */
  async function pick(page, name, label) {
    const select = page.locator(`select[name="${name}"]`)
    await page.waitForFunction(
      ([selector, wanted]) => {
        const element = document.querySelector(selector)
        return element && !element.disabled && [...element.options].some((option) => option.textContent.trim() === wanted)
      },
      [`select[name="${name}"]`, label],
      { timeout: 15000 },
    )
    await select.selectOption({ label })
  }
  async function choosePlace(page, prefix, { division, district, area }) {
    const name = (field) => (prefix ? `${prefix}.${field}` : field)
    if (division) await pick(page, name('divisionId'), division)
    if (district) await pick(page, name('districtId'), district)
    if (area) await pick(page, name('areaId'), area)
  }
  const priced = (page) => page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking prices|দাম যাচাই/.test(b.textContent)), null, { timeout: 20000 }).catch(() => {})
  const placeButton = (page) => page.locator('button[type="submit"][form="checkout-form"]')
  const methodCard = (page, id) => page.locator('.choice-card').filter({ has: page.locator(`input[value="${id}"]`) })
  const fieldError = (page, name) => page.locator('.form-field').filter({ has: page.locator(`[name="${name}"]`) }).locator('.form-field__error')
  async function download(page, click) {
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), click()])
    const path = await file.path()
    return { name: file.suggestedFilename(), bytes: path ? readFileSync(path) : Buffer.alloc(0) }
  }
  const row = (page, label) => page.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')
  /** Clicks the checkout's submit button and waits until the browser leaves /checkout for `where`. */
  async function placeOrder(page, where) {
    await priced(page)
    await placeButton(page).and(page.locator(':enabled')).waitFor({ timeout: 20000 })
    await placeButton(page).click()
    await page.waitForURL(where, { timeout: 45000 }).catch(async (error) => {
      const shown = await page.locator('[role="alert"], .form-field__error').allInnerTexts().catch(() => [])
      throw new Error(`the order wasn't placed (at ${page.url()}; shown: ${JSON.stringify(shown.filter(Boolean)).slice(0, 300)}): ${error.message.split('\n')[0]}`)
    })
  }
  /** Picks Standard delivery, like a shopper (a method not offered for a moment is swapped for another one). */
  async function chooseStandard(page) {
    await priced(page)
    const radio = page.locator('input[name="shippingMethod"][value="standard"]')
    await radio.check()
    await priced(page)
    return radio.isChecked()
  }
  const numberFromUrl = (page) => new URL(page.url()).pathname.match(/BN-\d+/)?.[0] ?? null

  // ---------- 0. The isolated setup, the places API ----------
  await part('places API', async () => {
    const usual = await fetch('http://127.0.0.1:8000/api/v1/store').then((r) => r.json(), () => null)
    log(!usual || usual.data?.currency?.code === 'USD', `the usual API on :8000 stays in USD (${usual?.data?.currency?.code ?? 'not running'})`)
    const fromStore = await fetch(`${STORE}/api/catalog/store`).then((r) => r.json(), () => null)
    log((fromStore?.data?.currency?.code ?? fromStore?.currency?.code) === 'BDT', `storefront on :${STORE_PORT} talks to :${API_PORT}`)
    const divisions = await api('/api/v1/places/bd/divisions')
    const divisionsBn = await api('/api/v1/places/bd/divisions', { headers: { 'Accept-Language': 'bn' } })
    const dhaka = divisions.body?.data?.find((item) => item.name_en === 'Dhaka')
    const sylhet = divisions.body?.data?.find((item) => item.name_en === 'Sylhet')
    log(divisions.body?.data?.length === 8 && dhaka?.name_bn === 'ঢাকা' && /max-age=86400/.test(divisions.headers.get('cache-control') ?? ''), `GET /places/bd/divisions: 8 divisions, Dhaka/ঢাকা, cached a day (${divisions.headers.get('cache-control')})`)
    log(divisionsBn.body?.data?.some((item) => item.name === 'ঢাকা') && divisionsBn.body?.data?.every((item) => hasBangla(item.name)), 'in Bangla (Accept-Language: bn) every division is named in Bangla')
    ids.dhakaDivision = dhaka?.id
    ids.sylhet = sylhet?.id
    const districts = (await api(`/api/v1/places/bd/districts?division=${ids.dhakaDivision}`)).body?.data ?? []
    ids.dhakaDistrict = districts.find((item) => item.name_en === 'Dhaka')?.id
    ids.moulvibazar = ((await api(`/api/v1/places/bd/districts?division=${ids.sylhet}`)).body?.data ?? []).find((item) => item.name_en === 'Moulvibazar')?.id
    const areas = (await api(`/api/v1/places/bd/areas?district=${ids.dhakaDistrict}`)).body?.data ?? []
    const banani = areas.find((item) => item.name_en === 'Banani')
    const dhanmondi = areas.find((item) => item.name_en === 'Dhanmondi')
    ids.banani = banani?.id
    ids.dhanmondi = dhanmondi?.id
    log(banani?.kind === 'thana' && banani?.name_bn === 'বনানী' && dhanmondi?.postcodes?.join() === '1209', `Dhaka district's areas include the thanas Banani (${banani?.id}, ${banani?.name_bn}) and Dhanmondi (postcode ${dhanmondi?.postcodes?.join()})`)
    const rajnagar = ((await api(`/api/v1/places/bd/areas?district=${ids.moulvibazar}`)).body?.data ?? []).find((item) => item.name_en === 'Rajnagar')
    ids.rajnagar = rajnagar?.id
    log(rajnagar?.kind === 'upazila' && rajnagar?.postcodes?.join() === '3240', `Moulvibazar's upazila Rajnagar (${rajnagar?.id}, ${rajnagar?.name_bn}, postcode ${rajnagar?.postcodes?.join()})`)
    const missing = await api('/api/v1/places/bd/areas')
    log(missing.status === 422 && Boolean(missing.body?.errors?.district), `areas without a district: 422 district (${missing.status})`)
    const viaStore = await fetch(`${STORE}/api/catalog/places/bd/areas?district=${ids.moulvibazar}&lang=bn`).then((r) => r.json(), () => null)
    const viaList = viaStore?.data ?? viaStore
    log(Array.isArray(viaList) && viaList.some((item) => item.name === 'রাজনগর'), 'the store\'s sign-in service passes the areas through in Bangla (?lang=bn)')
    if (!ids.banani || !ids.rajnagar || !ids.dhakaDistrict || !ids.moulvibazar) throw new Error(`places missing: ${JSON.stringify(ids)}`)

    // The throwaway customer.
    const registered = await api('/api/v1/auth/register', {
      method: 'POST',
      body: { first_name: customer.firstName, last_name: customer.lastName, email: customer.email, phone: customer.phone, password: customer.password, password_confirmation: customer.password, accept_terms: true },
    })
    const verified = registered.status === 201 ? await api('/api/v1/auth/verify-email', { method: 'POST', body: { email: customer.email, code: (await latestCode(customer.email)).code } }) : registered
    made.customerId = ((await admin$(`/customers?search=${encodeURIComponent(customer.email)}`)).body?.data ?? []).find((item) => item.email === customer.email)?.id ?? null
    log(verified.status === 200 && Boolean(made.customerId), `a throwaway customer signed up and confirmed (${customer.email}, #${made.customerId})`)
    if (!made.customerId) throw new Error(`the throwaway customer could not sign up (${registered.status} ${JSON.stringify(registered.body?.errors ?? registered.body?.message)})`)
    shopperToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: customer.email, password: customer.password } })).body?.data?.tokens?.access_token
  })

  // ---------- 1. Settings → Checkout (default country) and Cash on delivery, in the admin ----------
  await part('admin settings', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const checkout = admin.locator('form').filter({ has: admin.getByRole('heading', { name: 'Checkout', exact: true }) })
    await checkout.first().waitFor()
    await checkout.getByLabel('Default country').selectOption('Bangladesh')
    const sslBox = checkout.getByRole('checkbox', { name: 'bKash, Nagad, cards (SSLCommerz)' })
    if (!(await sslBox.isChecked())) await sslBox.check()
    const codBox = checkout.getByRole('checkbox', { name: 'Cash on delivery', exact: true })
    if (!(await codBox.isChecked())) await codBox.check()
    await checkout.getByRole('button', { name: 'Save checkout' }).click()
    log(await visible(checkout.getByText('Checkout saved.')), 'Settings → Checkout: Default country Bangladesh, SSLCommerz and cash on delivery ticked, "Checkout saved."')
    const store = (await api('/api/v1/store')).body?.data
    log(store?.default_country === 'Bangladesh' && store?.payment_methods?.includes('sslcommerz') && store?.payment_methods?.includes('cod'), `GET /store: default_country "${store?.default_country}", methods ${JSON.stringify(store?.payment_methods)}`)

    await admin.reload({ waitUntil: 'networkidle' })
    const cod = admin.locator('form').filter({ has: admin.getByRole('heading', { name: 'Cash on delivery', exact: true }) })
    await cod.first().waitFor()
    await cod.getByLabel('Cash on delivery fee').fill(COD_FEE)
    await cod.getByLabel('Largest order total for cash on delivery').fill('')
    for (const zone of ['Inside Dhaka', 'Dhaka suburbs']) {
      const box = cod.getByRole('checkbox', { name: zone, exact: true })
      if (!(await box.isChecked())) await box.check()
    }
    const outside = cod.getByRole('checkbox', { name: 'Outside Dhaka', exact: true })
    if (await outside.isChecked()) await outside.uncheck()
    const advanceRadio = cod.getByRole('radio', { name: /The delivery charge first, online/ })
    log(await advanceRadio.isEnabled(), 'the "delivery charge first, online (SSLCommerz)" choice can be picked now SSLCommerz is ticked')
    await cod.getByRole('radio', { name: /Nothing in advance/ }).check()
    const confirm = cod.getByRole('checkbox', { name: 'Confirm each order by phone before shipping' })
    if (await confirm.isChecked()) await confirm.uncheck()
    await axe(admin, 'admin settings (cash on delivery)')
    await cod.getByRole('button', { name: 'Save cash on delivery' }).click()
    log(await visible(cod.getByText('Cash on delivery saved.')), 'Settings → Cash on delivery: fee ৳20, Inside Dhaka and Dhaka suburbs only, "Cash on delivery saved."')
    const codNow = (await admin$('/settings')).body?.data?.cod
    log(codNow?.fee === COD_FEE && JSON.stringify([...(codNow?.zones ?? [])].sort()) === JSON.stringify(['dhaka_suburbs', 'inside_dhaka']) && codNow?.advance === 'none' && codNow?.max_order_total === null && codNow?.require_confirmation === false, `saved: ${JSON.stringify(codNow)}`)
    await admin.context().close()
  })

  // ---------- 2. Zone rates with delivery days (Settings → Table rates), the zones page ----------
  await part('zone rates', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings/shipping-rates`, { waitUntil: 'networkidle' })
    const standard = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'Standard', exact: true }) })
    await standard.first().waitFor()
    await standard.getByRole('button', { name: 'Add a standard rate' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('Country').fill('Bangladesh')
    await dialog.getByLabel('Delivery zone').selectOption({ label: 'Inside Dhaka' })
    await dialog.getByLabel('Price (BDT)').fill(RATE.inside.price)
    await dialog.getByLabel('Delivery from (days)').fill(String(RATE.inside.min))
    await dialog.getByLabel('Delivery up to (days)').fill(String(RATE.inside.max))
    await axe(admin, 'admin rate dialog with a delivery zone')
    await dialog.getByRole('button', { name: 'Add rate' }).click()
    log(await visible(admin.getByText(/added at the end of the standard rates\./)), `the rate dialog adds a Standard rate for Inside Dhaka: "${squash(await admin.locator('.notice--success').first().innerText().catch(() => ''))}"`)
    const rates = (await admin$('/shipping-rates')).body?.data ?? []
    const inside = rates.find((rate) => !saved.rateIds.has(rate.id) && rate.zone_code === 'inside_dhaka')
    if (inside) made.rates.push(inside.id)
    log(inside?.method === 'standard' && inside?.price === RATE.inside.price && inside?.eta_days_min === 1 && inside?.eta_days_max === 2, `saved: standard, inside_dhaka, ৳${inside?.price}, ${inside?.eta_days_min}–${inside?.eta_days_max} days`)
    // Outside Dhaka through the API (the same fields).
    const outside = await admin$('/shipping-rates', { method: 'POST', body: { method: 'standard', country: 'Bangladesh', zone_code: 'outside_dhaka', price: RATE.outside.price, eta_days_min: RATE.outside.min, eta_days_max: RATE.outside.max } })
    if (outside.body?.data?.id) made.rates.push(outside.body.data.id)
    log(outside.status === 201 && outside.body?.data?.zone_code === 'outside_dhaka', `a Standard rate for Outside Dhaka at ৳${RATE.outside.price}, 3–5 days (API, ${outside.status})`)
    // Dhaka suburbs too (a district alone, before its area is chosen, matches this zone), like docs/BANGLADESH.md's example.
    const suburbs = await admin$('/shipping-rates', { method: 'POST', body: { method: 'standard', country: 'Bangladesh', zone_code: 'dhaka_suburbs', price: RATE.suburbs.price, eta_days_min: RATE.suburbs.min, eta_days_max: RATE.suburbs.max } })
    if (suburbs.body?.data?.id) made.rates.push(suburbs.body.data.id)
    log(suburbs.status === 201, `a Standard rate for Dhaka suburbs at ৳${RATE.suburbs.price}, 2–3 days (API, ${suburbs.status})`)
    const unknown = await admin$('/shipping-rates', { method: 'POST', body: { method: 'standard', country: 'Bangladesh', zone_code: 'nowhere_e2e', price: '1.00' } })
    log(unknown.status === 422 && Boolean(unknown.body?.errors?.zone_code), `a rate for an unknown zone: 422 zone_code (${unknown.status})`)
    if (unknown.status === 201) made.rates.push(unknown.body.data.id)
    await admin.reload({ waitUntil: 'networkidle' })
    const table = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'Standard', exact: true }) }).locator('tbody')
    await table.first().waitFor()
    const tableText = squash(await table.innerText())
    log(/Inside Dhaka/.test(tableText) && /in 1–2 days/.test(tableText) && /Outside Dhaka/.test(tableText) && /in 3–5 days/.test(tableText), `the Standard table shows the Zone and Delivery columns ("Inside Dhaka … in 1–2 days", "Outside Dhaka … in 3–5 days")`)
    await axe(admin, 'admin shipping table rates with zones')
    await phone(admin, 'admin shipping table rates')

    await admin.goto(`${BASE}/admin/settings/delivery-zones`, { waitUntil: 'networkidle' })
    await admin.getByRole('heading', { name: 'Delivery zones', level: 1 }).waitFor()
    const zonesText = await mainText(admin)
    log(/Inside Dhaka/.test(zonesText) && /ঢাকার ভেতরে/.test(zonesText) && /Outside Dhaka/.test(zonesText) && /fallback/i.test(zonesText) && /Banani/.test(zonesText), 'Settings → Delivery zones lists the three zones (Bangla names, the fallback badge, Banani among Inside Dhaka\'s places)')
    await axe(admin, 'admin delivery zones')
    await phone(admin, 'admin delivery zones')
    await admin.context().close()
  })

  // ---------- 3. English checkout: the Bangladesh form, mobile messages, zones, COD fee / zones / limit ----------
  let orderA = null
  await part('English checkout', async () => {
    const shop = await shopperPage('en')
    await addDress(shop)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    log(await visible(shop.getByText('Delivery charge is calculated from your area at checkout.')), 'cart: "Delivery charge is calculated from your area at checkout."')
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await shop.locator('select[name="shipping.divisionId"]').waitFor()
    log((await shop.locator('[name="shipping.country"]').inputValue()) === 'Bangladesh', 'checkout starts in Bangladesh (the default country)')
    log((await shop.locator('[name="shipping.city"]').count()) === 0 || !(await shop.locator('[name="shipping.city"]').isVisible()), 'a Bangladesh address asks for Division → District → Area instead of city and state')
    log(await visible(shop.getByText('Choose your area to see the delivery charge for it.')) && (await visible(shop.locator('.cart-summary__note', { hasText: 'Delivery charge is calculated from your area.' }))), 'before an area: "Choose your area to see the delivery charge for it." and the summary note')
    log(await shop.locator('select[name="shipping.districtId"]').isDisabled() && /Choose a division first/.test(await shop.locator('select[name="shipping.districtId"]').innerText()), 'District waits: "Choose a division first"')

    // Another country keeps the old fields.
    await shop.locator('[name="shipping.country"]').selectOption('United States')
    log(await visible(shop.locator('[name="shipping.city"]'), 5000) && (await shop.locator('select[name="shipping.divisionId"]').count()) === 0, 'United States: the usual City / State fields, no division')
    await shop.locator('[name="shipping.country"]').selectOption('Bangladesh')
    await shop.locator('select[name="shipping.divisionId"]').waitFor()

    // Dhanmondi: its one postcode is filled in; Banani (no postcode): taken back.
    await shop.locator('[name="shipping.firstName"]').fill('Shuvo')
    await shop.locator('[name="shipping.lastName"]').fill('Ahmed')
    await choosePlace(shop, 'shipping', { division: PLACES.dhaka.division, district: PLACES.dhaka.district })
    log(await visible(shop.locator('.bd-address__filter input[type="search"]'), 5000), 'Dhaka district has more than 12 areas: a search box narrows them')
    await shop.locator('.bd-address__filter input[type="search"]').fill('dhan')
    const narrowed = await shop.locator('select[name="shipping.areaId"] option').allInnerTexts()
    log(narrowed.includes('Dhanmondi') && narrowed.length <= 4, `typing "dhan" narrows the areas (${narrowed.filter(Boolean).join(', ')})`)
    await pick(shop, 'shipping.areaId', PLACES.dhanmondi.area)
    await shop.locator('.bd-address__filter input[type="search"]').fill('')
    log((await shop.locator('[name="shipping.postalCode"]').inputValue()) === '1209' && (await visible(shop.getByText('Postcode 1209 filled in for this area.'))), 'Dhanmondi fills in its postcode 1209 (announced)')
    await pick(shop, 'shipping.areaId', PLACES.banani.area)
    log((await shop.locator('[name="shipping.postalCode"]').inputValue()) === '', 'Banani (a Dhaka thana without a postcode) takes the suggested postcode back')
    await shop.locator('[name="shipping.line1"]').fill('House 12, Road 11, Block C')
    log(await chooseStandard(shop), 'Standard delivery chosen')
    const standard = methodCard(shop, 'standard')
    log(await visible(standard.getByText('Inside Dhaka · Delivery in 1–2 days')), `Standard: "Inside Dhaka · Delivery in 1–2 days" (${squash(await standard.innerText().catch(() => ''))})`)
    log((await standard.innerText()).includes(taka(RATE.inside.price)), `…at the Inside Dhaka rate ${taka(RATE.inside.price)}`)
    log(await visible(shop.getByText('Delivery zone: Inside Dhaka')), '"Delivery zone: Inside Dhaka" under the methods')
    log(!(await shop.locator('.cart-summary__note', { hasText: 'Delivery charge is calculated from your area.' }).isVisible()), 'the area note is gone once the area is chosen')

    // Mobile numbers: shape, operator.
    const phoneField = shop.locator('[name="phone"]')
    log(await visible(shop.getByText('Bangladeshi mobile, like 01712-345678. The courier calls this number.')), 'the phone hint: "Bangladeshi mobile, like 01712-345678. The courier calls this number."')
    await shop.locator('input[name="paymentMethod"][value="cod"]').check()
    await phoneField.fill('12345')
    await placeButton(shop).click()
    log(await visible(fieldError(shop, 'phone').filter({ hasText: 'Enter a Bangladeshi mobile number: 11 digits starting with 01, like 01712-345678.' })), 'a wrong shape: "Enter a Bangladeshi mobile number: 11 digits starting with 01, like 01712-345678."')
    await phoneField.fill('01212345678')
    await placeButton(shop).click()
    log(await visible(fieldError(shop, 'phone').filter({ hasText: 'Mobile numbers start with 013 to 019. Check the third digit.' })), 'a wrong operator (012): "Mobile numbers start with 013 to 019. Check the third digit."')
    log(new URL(shop.url()).pathname === '/checkout', 'no order is placed with a wrong number')
    const apiPhone = await api('/api/v1/cart/validate', { method: 'POST', body: { items: [{ product_id: DRESS, quantity: 1 }], country: 'Bangladesh', area_id: ids.banani, district_id: ids.dhakaDistrict } })
    const refusedPhone = await api('/api/v1/orders', { method: 'POST', body: { guest: { email: `delivery.phone.${run}@example.com` }, email: `delivery.phone.${run}@example.com`, phone: '01212345678', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: bdAddress('banani'), shipping_method: 'standard', payment_method: 'cod' } })
    if (refusedPhone.status === 201) made.orders.add(refusedPhone.body?.data?.number)
    log(apiPhone.status === 200 && refusedPhone.status === 422 && /Enter a Bangladeshi mobile number, for example 01712 345678\./.test(JSON.stringify(refusedPhone.body?.errors?.phone ?? '')), `…and the API: 422 phone "Enter a Bangladeshi mobile number, for example 01712 345678." (${refusedPhone.status})`)
    const refusedBn = await api('/api/v1/orders', { method: 'POST', headers: { 'Accept-Language': 'bn' }, body: { guest: { email: `delivery.phone.${run}@example.com` }, email: `delivery.phone.${run}@example.com`, phone: '01212345678', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: bdAddress('banani'), shipping_method: 'standard', payment_method: 'cod' } })
    if (refusedBn.status === 201) made.orders.add(refusedBn.body?.data?.number)
    log(refusedBn.status === 422 && /বাংলাদেশি মোবাইল নম্বর/.test(JSON.stringify(refusedBn.body?.errors?.phone ?? '')), `…in Bangla: "${refusedBn.body?.errors?.phone?.[0]}"`)
    const badArea = await api('/api/v1/orders', { method: 'POST', body: { guest: { email: `delivery.phone.${run}@example.com` }, email: `delivery.phone.${run}@example.com`, phone: '01712345678', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: bdAddress('banani', { district_id: ids.moulvibazar }), shipping_method: 'standard', payment_method: 'cod' } })
    if (badArea.status === 201) made.orders.add(badArea.body?.data?.number)
    log(badArea.status === 422 && Boolean(badArea.body?.errors?.['shipping_address.district_id'] || badArea.body?.errors?.['shipping_address.area_id']), `places that don't belong together: 422 (${JSON.stringify(badArea.body?.errors ?? {}).slice(0, 120)})`)
    await phoneField.fill('01712-345678')

    // Cash on delivery: the fee.
    await priced(shop)
    const payment = squash(await shop.locator('.checkout__section').filter({ has: shop.locator('input[name="paymentMethod"]') }).innerText())
    log(payment.includes(`A cash on delivery fee of ${taka(COD_FEE)} is added.`), `the payment note: "A cash on delivery fee of ${taka(COD_FEE)} is added."`)
    const summary = squash(await shop.locator('.checkout__summary').innerText())
    log(new RegExp(`Cash on delivery fee\\s*${taka(COD_FEE).replace('.', '\\.')}`).test(summary), `the summary has its own "Cash on delivery fee ${taka(COD_FEE)}" row`)
    await axe(shop, 'checkout with the Bangladesh address form (English)')
    await phone(shop, 'checkout with the Bangladesh address form')

    // Outside Dhaka (Rajnagar): its rate, and no cash on delivery there.
    await choosePlace(shop, 'shipping', { division: PLACES.sylhet.division, district: PLACES.sylhet.district, area: PLACES.sylhet.area })
    log((await shop.locator('[name="shipping.postalCode"]').inputValue()) === '3240', 'Rajnagar (an upazila in Moulvibazar) fills in 3240')
    await chooseStandard(shop)
    log(await visible(standard.getByText('Outside Dhaka · Delivery in 3–5 days')) && (await standard.innerText()).includes(taka(RATE.outside.price)), `Standard outside Dhaka: "Outside Dhaka · Delivery in 3–5 days" at ${taka(RATE.outside.price)}`)
    const codInput = shop.locator('input[name="paymentMethod"][value="cod"]')
    await shop.waitForFunction(() => document.querySelector('input[name="paymentMethod"][value="cod"]')?.disabled === true, null, { timeout: 15000 }).catch(() => {})
    const codCard = methodCard(shop, 'cod')
    log((await codInput.isDisabled()) && /Cash on delivery isn't available for Outside Dhaka\. Please choose another way to pay\./.test(await codCard.innerText()), `COD outside its zones: disabled, "Cash on delivery isn't available for Outside Dhaka. Please choose another way to pay."`)
    log(!(await codInput.isChecked()), `another method is chosen instead (${await shop.locator('input[name="paymentMethod"]:checked').getAttribute('value').catch(() => '?')})`)
    const zoneRefused = await api('/api/v1/orders', { method: 'POST', body: { guest: { email: `delivery.zone.${run}@example.com` }, email: `delivery.zone.${run}@example.com`, phone: '01712345678', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: bdAddress('rajnagar'), shipping_method: 'standard', payment_method: 'cod' } })
    if (zoneRefused.status === 201) made.orders.add(zoneRefused.body?.data?.number)
    log(zoneRefused.status === 422 && /Cash on delivery isn't available in your area\./.test(JSON.stringify(zoneRefused.body?.errors?.payment_method ?? '')), `…and the API: 422 payment_method "Cash on delivery isn't available in your area." (${zoneRefused.status})`)
    const cartOutside = (await api('/api/v1/cart/validate', { method: 'POST', body: { items: [{ product_id: DRESS, quantity: 1 }], country: 'Bangladesh', area_id: ids.rajnagar, district_id: ids.moulvibazar, payment_method: 'cod' } })).body?.data
    log(cartOutside?.delivery_zone?.code === 'outside_dhaka' && cartOutside?.cod?.available === false && cartOutside?.cod?.reason === 'zone', `cart/validate: zone outside_dhaka, cod ${JSON.stringify({ available: cartOutside?.cod?.available, reason: cartOutside?.cod?.reason })}`)

    // The limit.
    await choosePlace(shop, 'shipping', { division: PLACES.dhaka.division, district: PLACES.dhaka.district, area: PLACES.banani.area })
    await chooseStandard(shop)
    await patchSettings({ cod: { max_order_total: '100.00' } })
    // Prices are checked again for another area (each area's answer is kept for a while): Dhanmondi, also Inside Dhaka.
    await pick(shop, 'shipping.areaId', PLACES.dhanmondi.area)
    await chooseStandard(shop)
    await shop.waitForFunction(() => document.querySelector('input[name="paymentMethod"][value="cod"]')?.disabled === true, null, { timeout: 15000 }).catch(() => {})
    log((await codInput.isDisabled()) && (await codCard.innerText()).includes(`Cash on delivery is available for orders up to ${taka(100)}. Please choose another way to pay.`), `over the limit: "Cash on delivery is available for orders up to ${taka(100)}. Please choose another way to pay."`)
    const limitRefused = await api('/api/v1/orders', { method: 'POST', body: { guest: { email: `delivery.limit.${run}@example.com` }, email: `delivery.limit.${run}@example.com`, phone: '01712345678', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: bdAddress('banani'), shipping_method: 'standard', payment_method: 'cod' } })
    if (limitRefused.status === 201) made.orders.add(limitRefused.body?.data?.number)
    log(limitRefused.status === 422 && /Cash on delivery is available for orders up to/.test(JSON.stringify(limitRefused.body?.errors?.payment_method ?? '')), `…and the API: 422 payment_method "${limitRefused.body?.errors?.payment_method?.[0]}"`)
    await patchSettings({ cod: { max_order_total: null } })
    await pick(shop, 'shipping.areaId', PLACES.banani.area)
    await shop.locator('[name="shipping.postalCode"]').fill('')
    await chooseStandard(shop)
    await shop.waitForFunction(() => document.querySelector('input[name="paymentMethod"][value="cod"]')?.disabled === false, null, { timeout: 15000 }).catch(() => {})
    await codInput.check()
    await chooseStandard(shop)

    // Place it.
    const stockBefore = await stockOf(DRESS)
    await placeOrder(shop, (url) => url.pathname.startsWith('/order-confirmation/'))
    const number = numberFromUrl(shop)
    if (number) made.orders.add(number)
    orderA = number
    const placed = number ? await orderOf(number) : null
    const address = placed?.shipping_address ?? {}
    log(placed?.payment_method === 'cod' && placed?.status === 'processing' && (await stockOf(DRESS)) === stockBefore - 1, `placed ${number}: cash on delivery, processing, stock reserved`)
    log(placed?.phone === '+8801712345678', `the mobile typed as "01712-345678" is stored as ${placed?.phone}`)
    log(address.area_id === ids.banani && address.district_id === ids.dhakaDistrict && address.division_id === ids.dhakaDivision && address.city === 'Dhaka' && address.state === 'Dhaka' && address.area === 'Banani', `the address keeps the place ids, area "${address.area}", city "${address.city}", state "${address.state}" (filled in English)`)
    log(placed?.delivery?.zone_code === 'inside_dhaka' && placed?.delivery?.eta_days_min === 1 && placed?.delivery?.eta_days_max === 2 && placed?.totals?.shipping === RATE.inside.price && placed?.totals?.cod_fee === COD_FEE && placed?.cod?.fee === COD_FEE, `delivery ${JSON.stringify(placed?.delivery)}, shipping ${placed?.totals?.shipping}, cod_fee ${placed?.totals?.cod_fee}`)
    log(cents(placed?.totals?.total) === cents(placed?.totals?.subtotal) - cents(placed?.totals?.discount ?? 0) + cents(RATE.inside.price) + cents(COD_FEE) && placed?.cod?.cod_due === placed?.totals?.total, `the total includes the fee (${placed?.totals?.total}) and all of it is due in cash (${placed?.cod?.cod_due})`)
    await shop.goto(`${BASE}/account/orders/${number}`, { waitUntil: 'networkidle' })
    await shop.getByText(number).first().waitFor()
    const orderText = await mainText(shop)
    log(orderText.includes('Delivery zone: Inside Dhaka') && /Delivery in 1–2 days/.test(orderText) && orderText.includes('Cash on delivery fee'), 'the account order page: "Delivery zone: Inside Dhaka", "Delivery in 1–2 days", the fee row')
    log(/Banani, Dhaka/.test(orderText) && /Dhaka Division/.test(orderText), 'the address in the Bangladesh format: "Banani, Dhaka", "Dhaka Division"')
    await axe(shop, 'account order page (Bangladesh address, COD fee)')
    await shop.context().close()
  })

  // ---------- 4. The address book in Bangla and English ----------
  await part('address book', async () => {
    const shop = await shopperPage('bn')
    await shop.goto(`${BASE}/account/addresses`, { waitUntil: 'networkidle' })
    await shop.getByRole('heading', { name: 'ঠিকানার তালিকা' }).first().waitFor()
    await shop.getByRole('button', { name: /ঠিকানা যোগ করুন|আপনার প্রথম ঠিকানা যোগ করুন/ }).first().click()
    await shop.locator('select[name="divisionId"]').waitFor()
    log((await shop.locator('[name="country"]').inputValue()) === 'Bangladesh', 'Bangla address book: a new address starts in Bangladesh')
    await shop.locator('[name="firstName"]').fill('শুভ')
    await shop.locator('[name="lastName"]').fill('আহমেদ')
    await choosePlace(shop, '', { division: PLACES.dhaka.divisionBn, district: PLACES.dhaka.districtBn, area: PLACES.banani.areaBn })
    log(true, 'Division → District → Area in Bangla: ঢাকা → ঢাকা → বনানী')
    await shop.locator('[name="line1"]').fill('বাড়ি ১২, রোড ১১, ব্লক সি')
    const phoneField = shop.locator('[name="phone"]')
    log(await visible(shop.getByText('বাংলাদেশি মোবাইল নম্বর, যেমন ০১৭১২-৩৪৫৬৭৮। কুরিয়ার এই নম্বরে কল করবে।')), 'the Bangla mobile hint')
    await phoneField.fill('12345')
    const save = shop.locator('form.address-form button[type="submit"]')
    await save.click()
    log(await visible(fieldError(shop, 'phone').filter({ hasText: 'বাংলাদেশি মোবাইল নম্বর দিন: ০১ দিয়ে শুরু ১১ অঙ্ক, যেমন ০১৭১২-৩৪৫৬৭৮।' })), 'a wrong shape in Bangla: "বাংলাদেশি মোবাইল নম্বর দিন: ০১ দিয়ে শুরু ১১ অঙ্ক…"')
    await phoneField.fill('০১২১২৩৪৫৬৭৮')
    await save.click()
    log(await visible(fieldError(shop, 'phone').filter({ hasText: 'মোবাইল নম্বর ০১৩ থেকে ০১৯ দিয়ে শুরু হয়। তৃতীয় অঙ্কটি দেখুন।' })), 'a wrong operator in Bangla digits: "মোবাইল নম্বর ০১৩ থেকে ০১৯ দিয়ে শুরু হয়…"')
    await phoneField.fill('০১৭১২-৩৪৫৬৭৮')
    const shippingDefault = shop.getByRole('checkbox', { name: 'আমার ডিফল্ট ডেলিভারির ঠিকানা হিসেবে ব্যবহার করুন' })
    if ((await shippingDefault.count()) && !(await shippingDefault.isChecked())) await shippingDefault.check()
    await axe(shop, 'address book form in Bangla')
    await save.click()
    log(await visible(shop.getByText('ঠিকানাটি আপনার ঠিকানার তালিকায় যোগ হয়েছে।')), 'saved: "ঠিকানাটি আপনার ঠিকানার তালিকায় যোগ হয়েছে।"')
    const shownBn = (await visible(shop.locator('main').getByText(/বনানী, ঢাকা/), 10000)) && (await visible(shop.locator('main').getByText(/ঢাকা বিভাগ/), 3000))
    log(shownBn, `the saved address in Bangla: "বনানী, ঢাকা", "ঢাকা বিভাগ"${shownBn ? '' : ` (shown: ${squash(await shop.locator('.address-book').innerText()).slice(0, 300)})`}`)
    const listed = (await api('/api/v1/me/addresses', { token: shopperToken })).body?.data ?? []
    const bn = listed.find((item) => item.area_id === ids.banani)
    log(bn?.phone === '+8801712345678' && bn?.division_id === ids.dhakaDivision && bn?.district_id === ids.dhakaDistrict && bn?.city === 'Dhaka' && bn?.state === 'Dhaka' && (bn?.postal_code ?? '') === '', `stored: phone ${bn?.phone} (typed in Bangla digits), ids ${bn?.division_id}/${bn?.district_id}/${bn?.area_id}, city/state "${bn?.city}"/"${bn?.state}", no postcode`)
    await phone(shop, 'the address book in Bangla')
    await shop.context().close()

    // English: an upazila outside Dhaka, its postcode filled in, a +880 number.
    const en = await shopperPage('en')
    await en.goto(`${BASE}/account/addresses`, { waitUntil: 'networkidle' })
    await en.getByRole('heading', { name: 'Address book' }).first().waitFor()
    await en.getByRole('button', { name: 'Add address' }).first().click()
    await en.locator('select[name="divisionId"]').waitFor()
    await en.locator('[name="firstName"]').fill('Shuvo')
    await en.locator('[name="lastName"]').fill('Ahmed')
    await choosePlace(en, '', { division: PLACES.sylhet.division, district: PLACES.sylhet.district, area: PLACES.sylhet.area })
    log((await en.locator('[name="postalCode"]').inputValue()) === PLACES.sylhet.postcode, `Rajnagar fills in its postcode ${PLACES.sylhet.postcode}`)
    await en.locator('[name="line1"]').fill('Village Uttarbhag')
    await en.locator('[name="phone"]').fill('+880 1811-223344')
    await en.locator('form.address-form button[type="submit"]').click()
    log(await visible(en.getByText('Address added to your address book.')), 'saved: "Address added to your address book."')
    const shownEn = (await visible(en.locator('main').getByText(/Rajnagar, Moulvibazar 3240/), 10000)) && (await visible(en.locator('main').getByText(/Sylhet Division/), 3000))
    log(shownEn, `the saved address in English: "Rajnagar, Moulvibazar 3240", "Sylhet Division"${shownEn ? '' : ` (shown: ${squash(await en.locator('.address-book').innerText()).slice(0, 300)})`}`)
    const second = ((await api('/api/v1/me/addresses', { token: shopperToken })).body?.data ?? []).find((item) => item.area_id === ids.rajnagar)
    log(second?.phone === '+8801811223344' && second?.postal_code === '3240' && second?.city === 'Moulvibazar' && second?.state === 'Sylhet', `stored: phone ${second?.phone}, postcode ${second?.postal_code}, city "${second?.city}", state "${second?.state}"`)
    const badPostcode = await api('/api/v1/me/addresses', { method: 'POST', token: shopperToken, body: { ...bdAddress('rajnagar'), phone: '01811223344', postal_code: '32' } })
    log(badPostcode.status === 422 && /Enter a 4-digit postcode\./.test(JSON.stringify(badPostcode.body?.errors ?? '')), `the API refuses a 2-digit postcode (${badPostcode.status})`)
    await axe(en, 'address book in English')
    await en.context().close()
  })

  // ---------- 5. Confirmation by phone on; a Bangla checkout ----------
  let orderB = null
  let orderC = null
  await part('Bangla checkout with phone confirmation', async () => {
    await patchSettings({ cod: { require_confirmation: true } })
    const shop = await shopperPage('bn')
    await addDress(shop)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await shop.locator('select[name="shipping.areaId"]').waitFor()
    await shop.waitForFunction(() => document.querySelector('select[name="shipping.areaId"]')?.value !== '', null, { timeout: 15000 }).catch(() => {})
    const area = await shop.locator('select[name="shipping.areaId"]').evaluate((select) => select.selectedOptions[0]?.textContent.trim())
    log(area === 'বনানী', `the default saved address fills the form, the area named in Bangla ("${area}")`)
    if (area !== 'বনানী') await choosePlace(shop, 'shipping', { division: PLACES.dhaka.divisionBn, district: PLACES.dhaka.districtBn, area: PLACES.banani.areaBn })
    if (!(await shop.locator('[name="shipping.line1"]').inputValue())) await shop.locator('[name="shipping.line1"]').fill('বাড়ি ১২, রোড ১১, ব্লক সি')
    await chooseStandard(shop)
    const standard = methodCard(shop, 'standard')
    log(await visible(standard.getByText('ঢাকার ভেতরে · ১–২ দিনে ডেলিভারি')), `Standard in Bangla: "ঢাকার ভেতরে · ১–২ দিনে ডেলিভারি" (${squash(await standard.innerText().catch(() => ''))})`)
    log((await standard.innerText()).includes(`৳${bnDigits(RATE.inside.price)}`), `…at ৳${bnDigits(RATE.inside.price)} in Bangla digits`)
    log(await visible(shop.getByText('ডেলিভারি জোন: ঢাকার ভেতরে')), '"ডেলিভারি জোন: ঢাকার ভেতরে" under the methods')
    await shop.locator('input[name="paymentMethod"][value="cod"]').check()
    await priced(shop)
    const note = squash(await shop.locator('.checkout__section').filter({ has: shop.locator('input[name="paymentMethod"]') }).innerText())
    log(note.includes(`৳${bnDigits(COD_FEE)} ক্যাশ অন ডেলিভারি ফি যোগ হবে।`) && note.includes('অর্ডার পাঠানোর আগে নিশ্চিত করতে আমরা আপনাকে কল করব।'), 'the payment note in Bangla: the fee and "অর্ডার পাঠানোর আগে নিশ্চিত করতে আমরা আপনাকে কল করব।"')
    const summary = squash(await shop.locator('.checkout__summary').innerText())
    log(summary.includes('ক্যাশ অন ডেলিভারি ফি') && !/[A-Za-z]{4,}/.test(summary.replace(/Tartan Dress|BuyNest|SSLCommerz/g, '')), 'the summary in Bangla, with its "ক্যাশ অন ডেলিভারি ফি" row')
    await axe(shop, 'checkout in Bangla (Bangladesh form, COD)')
    await phone(shop, 'the Bangla checkout')
    await placeOrder(shop, (url) => url.pathname.startsWith('/order-confirmation/'))
    orderB = numberFromUrl(shop)
    if (orderB) made.orders.add(orderB)
    const placed = orderB ? await orderOf(orderB) : null
    log(placed?.locale === 'bn' && placed?.confirmation?.status === 'pending' && placed?.status === 'processing' && placed?.delivery?.zone_code === 'inside_dhaka' && placed?.phone === '+8801711556677', `placed ${orderB} in Bangla: locale ${placed?.locale}, confirmation ${placed?.confirmation?.status}, phone ${placed?.phone}`)
    await shop.goto(`${BASE}/account/orders/${orderB}`, { waitUntil: 'networkidle' })
    await shop.getByText(bnDigits(orderB)).or(shop.getByText(orderB)).first().waitFor()
    const orderText = await mainText(shop)
    log(orderText.includes('নিশ্চিত করতে আমরা আপনাকে কল করব') && orderText.includes('ডেলিভারি জোন: ঢাকার ভেতরে') && /বনানী, ঢাকা/.test(orderText), 'the order page in Bangla: "নিশ্চিত করতে আমরা আপনাকে কল করব", the zone, "বনানী, ঢাকা"')
    await axe(shop, 'account order page in Bangla (waiting for the call)')
    await shop.context().close()

    // A second one through the API (English), to ship without confirmation.
    const placedC = await api('/api/v1/orders', { method: 'POST', token: shopperToken, body: { email: customer.email, phone: '01812 345678', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: bdAddress('banani'), shipping_method: 'standard', payment_method: 'cod' } })
    orderC = placedC.body?.data?.number ?? null
    if (orderC) made.orders.add(orderC)
    log(placedC.status === 201 && placedC.body?.data?.confirmation_status === 'pending' && placedC.body?.data?.phone === '+8801812345678', `${orderC} through the API: confirmation ${placedC.body?.data?.confirmation_status}, phone "01812 345678" stored as ${placedC.body?.data?.phone}`)
  })

  // ---------- 6. Sales → To confirm ----------
  await part('To confirm', async () => {
    if (!orderB) throw new Error('no order waiting for its call')
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' })
    log(await visible(admin.getByRole('link', { name: 'To confirm' })), 'the Sales menu has "To confirm"')
    await admin.goto(`${BASE}/admin/to-confirm`, { waitUntil: 'networkidle' })
    await admin.getByRole('heading', { name: 'To confirm', level: 1 }).waitFor()
    const card = admin.locator('li.confirm-card').filter({ has: admin.getByRole('heading', { name: new RegExp(orderB) }) })
    await card.first().waitFor()
    const numbers = await admin.locator('li.confirm-card h2 a').allInnerTexts()
    log(numbers.indexOf(orderB) >= 0 && numbers.indexOf(orderC) > numbers.indexOf(orderB), `oldest first: ${orderB} before ${orderC} (${numbers.join(', ')})`)
    const call = card.getByRole('link', { name: /Call 01711 556677/ })
    log((await call.getAttribute('href')) === 'tel:+8801711556677', `"Call 01711 556677" is a tel: link (${await call.getAttribute('href')})`)
    const cardText = squash(await card.innerText())
    log(/Inside Dhaka/.test(cardText) && /Not called yet/.test(cardText) && /Banani/.test(cardText), 'the card shows the zone, "Not called yet", the address')
    await axe(admin, 'Sales → To confirm')
    await phone(admin, 'Sales → To confirm')

    await card.getByRole('button', { name: `Couldn't reach: ${orderB}` }).click()
    let dialog = admin.getByRole('dialog')
    await dialog.getByLabel('Note (optional)').fill('No answer at 11:00 (e2e)')
    await dialog.getByRole('button', { name: "Save: couldn't reach" }).click()
    log(await visible(admin.getByText(`Order ${orderB}: the attempt was saved. It stays in the queue.`)), `Couldn't reach: "Order ${orderB}: the attempt was saved. It stays in the queue."`)
    await card.getByText('1 so far').waitFor({ timeout: 10000 }).catch(() => {})
    log(/1 so far/.test(await card.innerText()) && /No answer at 11:00 \(e2e\)/.test(await card.innerText()), 'still listed: "1 so far" and the last note')
    const unreachable = await orderOf(orderB)
    log(unreachable?.confirmation?.status === 'unreachable' && unreachable?.confirmation?.attempts === 1, `the order: ${unreachable?.confirmation?.status}, ${unreachable?.confirmation?.attempts} attempt`)

    const mailBefore = lastMailId(customer.email)
    await card.getByRole('button', { name: `Confirmed: ${orderB}` }).click()
    dialog = admin.getByRole('dialog')
    log(await dialog.getByRole('checkbox', { name: 'Email the customer that the order is confirmed' }).isChecked(), 'Confirmed: emailing the customer is ticked')
    await axe(admin, 'the confirmation dialog')
    await dialog.getByRole('button', { name: 'Mark as confirmed' }).click()
    log(await visible(admin.getByText(`Order ${orderB} confirmed. The customer was emailed.`)), `"Order ${orderB} confirmed. The customer was emailed."`)
    const leftCard = admin.locator('li.confirm-card').filter({ has: admin.getByRole('heading', { name: new RegExp(orderB) }) })
    await leftCard.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
    log(!(await leftCard.isVisible()), `${orderB} has left the queue`)
    const confirmed = await orderOf(orderB)
    log(confirmed?.confirmation?.status === 'confirmed' && Boolean(confirmed?.confirmation?.confirmed_at) && (confirmed?.confirmation?.logs ?? []).map((item) => item.outcome).join() === 'unreachable,confirmed', `confirmed at ${confirmed?.confirmation?.confirmed_at}, log ${JSON.stringify((confirmed?.confirmation?.logs ?? []).map((item) => item.outcome))}`)
    const mail = await waitForMail(customer.email, new RegExp(`${orderB}.*নিশ্চিত|নিশ্চিত.*${orderB}|confirm`, 'i'), { after: mailBefore })
    log(Boolean(mail) && mail.text.includes(orderB), `the cod_confirmed email in the dev mailbox, in the customer's Bangla ("${mail?.subject}")`)
    const shop = await shopperPage('en')
    await shop.goto(`${BASE}/account/orders/${orderB}`, { waitUntil: 'networkidle' })
    await shop.getByText(orderB).first().waitFor()
    log(/Confirmed/.test(await mainText(shop)), 'the customer\'s order page now says "Confirmed"')
    await shop.context().close()
    await admin.context().close()
  })

  // ---------- 7. Shipping blocked until confirmed, the override; collection (short, full) ----------
  await part('shipping and collection', async () => {
    if (!orderC || !orderB) throw new Error('no orders to ship')
    const blocked = await admin$(`/orders/${orderC}/shipments`, { method: 'POST', body: { carrier: 'other', notify_customer: false } })
    log(blocked.status === 422 && /This cash on delivery order hasn't been confirmed by phone yet\. Confirm it first, or ship it anyway with a reason\./.test(JSON.stringify(blocked.body?.errors?.order ?? '')), `shipping ${orderC} before the call: 422 "This cash on delivery order hasn't been confirmed by phone yet…" (${blocked.status})`)
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders/${orderC}`, { waitUntil: 'networkidle' })
    await admin.getByRole('heading', { name: 'Manage order' }).waitFor()
    log(await visible(admin.getByText("This cash on delivery order isn't confirmed by phone yet. Confirm it below first, or ship it anyway with a reason.")), 'the order page says it isn\'t confirmed yet')
    const pageText = await mainText(admin)
    log(/Phone confirmation/.test(pageText) && /Inside Dhaka/.test(pageText) && /Cash to collect/.test(pageText) && /Banani/.test(pageText), 'the order page: Phone confirmation panel, Delivery zone, Cash to collect, the Bangladesh address')
    const callLink = admin.locator('a[href="tel:+8801812345678"]')
    log((await callLink.count()) > 0, 'the phone is a tel: link')
    await admin.getByRole('button', { name: 'Ship', exact: true }).click()
    let dialog = admin.getByRole('dialog')
    log(await visible(dialog.getByText('Not confirmed by phone')), 'Ship asks first: "Not confirmed by phone"')
    await dialog.getByLabel('Carrier').selectOption({ index: 1 })
    await dialog.getByRole('button', { name: 'Create shipment' }).click()
    log(await visible(dialog.getByText('Confirm the order by phone first, or tick “Ship without confirmation” and give the reason.')), 'without the tick: "Confirm the order by phone first, or tick “Ship without confirmation” and give the reason."')
    await dialog.getByRole('checkbox', { name: 'Ship without confirmation' }).check()
    await dialog.getByLabel('Reason').fill('Customer confirmed by SMS (e2e)')
    await axe(admin, 'ship dialog with the override')
    await dialog.getByRole('button', { name: 'Create shipment' }).click()
    log(await visible(admin.getByText(/The order is now shipped\./)), 'with the tick and a reason: shipped')
    const overridden = await orderOf(orderC)
    const override = (overridden?.confirmation?.logs ?? []).find((item) => item.outcome === 'override')
    log(overridden?.status === 'shipped' && /Customer confirmed by SMS \(e2e\)/.test(override?.note ?? ''), `${orderC}: ${overridden?.status}, the override logged ("${override?.note}")`)
    await admin.reload({ waitUntil: 'networkidle' })
    log(await visible(admin.getByText('Shipped without confirmation')), 'the log on the order page: "Shipped without confirmation"')

    // A short collection.
    const due = overridden?.cod?.cod_due
    const short = money(Number(due) - 10)
    await admin.getByRole('button', { name: 'Mark as delivered' }).click()
    dialog = admin.getByRole('dialog')
    const amount = dialog.getByLabel('Amount collected (BDT)')
    log((await amount.inputValue()) === String(Number(due)), `the collection dialog: prefilled with what is due (${await amount.inputValue()} of ${due})`)
    await amount.fill(String(Number(due) + 5))
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click()
    log(await visible(dialog.getByText(/That is more than the ৳[\d,.]+ due\./)), 'more than due: "That is more than the … due."')
    await amount.fill(short)
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click()
    log(await visible(dialog.getByText('Say why less was collected.')), 'short without a reason: "Say why less was collected."')
    await dialog.getByLabel('Why less was collected').fill('Customer paid ৳10 less, rest promised by bKash (e2e)')
    await axe(admin, 'collection dialog (short)')
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click()
    log(await visible(admin.getByText(/is still due\./)), `short: "Marked as delivered with ${taka(short)} collected; ৳10.00 is still due."`)
    const shortOrder = await orderOf(orderC)
    log(shortOrder?.status === 'delivered' && shortOrder?.payment_status === 'partially_paid' && shortOrder?.cod?.cod_due === '10.00' && shortOrder?.cod?.collected === short, `${orderC}: ${shortOrder?.status}, ${shortOrder?.payment_status}, still due ${shortOrder?.cod?.cod_due}, collected ${shortOrder?.cod?.collected}`)
    const notes = ((await admin$('/notifications?per_page=50')).body?.data ?? []).filter((item) => item.link === `/orders/${orderC}`)
    log(notes.some((item) => item.type === 'cod_short_collection' || /short|less/i.test(item.title ?? '')), `an admin notification about the short collection ("${notes[0]?.title}")`)
    log(await visible(admin.getByText('Partly paid').first()), 'the order page: "Partly paid"')
    await admin.context().close()

    // The confirmed one: shipped normally, then the full amount.
    const shipped = await admin$(`/orders/${orderB}/shipments`, { method: 'POST', body: { carrier: 'other', notify_customer: false } })
    log(shipped.status === 201, `${orderB} (confirmed) ships without a reason (${shipped.status})`)
    const admin2 = await adminPage()
    await admin2.goto(`${BASE}/admin/orders/${orderB}`, { waitUntil: 'networkidle' })
    await admin2.getByRole('button', { name: 'Mark as delivered' }).click()
    dialog = admin2.getByRole('dialog')
    await dialog.getByLabel('Amount collected (BDT)').waitFor()
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click()
    log(await visible(admin2.getByText(/collected and the order is paid\./)), 'the full amount: "… collected and the order is paid."')
    const full = await orderOf(orderB)
    log(full?.status === 'delivered' && full?.payment_status === 'paid' && full?.cod?.cod_due === '0.00' && full?.invoices?.length === 1 && /Cash collected on delivery/.test(full?.invoices?.[0]?.note ?? ''), `${orderB}: ${full?.payment_status}, nothing due, invoiced ("${full?.invoices?.[0]?.note}")`)
    await admin2.context().close()
  })

  // ---------- 8. The advance delivery charge through SSLCommerz (stand-in); an unpaid one expiring ----------
  let orderD = null
  await part('advance delivery charge', async () => {
    await patchSettings({ cod: { advance: 'delivery_charge', require_confirmation: false } })
    const shop = await shopperPage('en')
    await addDress(shop)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await shop.locator('select[name="shipping.areaId"]').waitFor()
    await shop.waitForFunction(() => document.querySelector('select[name="shipping.areaId"]')?.value !== '', null, { timeout: 15000 }).catch(() => {})
    await shop.locator('input[name="paymentMethod"][value="cod"]').check()
    await chooseStandard(shop)
    const advance = money(Number(RATE.inside.price) + Number(COD_FEE))
    const buttonText = squash(await placeButton(shop).innerText())
    log(buttonText === `Pay delivery charge · ${taka(advance)}`, `the button reads "${buttonText}"`)
    const summary = squash(await shop.locator('.checkout__summary').innerText())
    log(summary.includes('Pay now (delivery charge)') && summary.includes('Due in cash on delivery'), 'the summary: "Pay now (delivery charge)" and "Due in cash on delivery"')
    log(await visible(shop.getByText(new RegExp(`Pay the delivery charge \\(${taka(advance).replace('.', '\\.')}\\) now with bKash, Nagad or card\\.`))), `the note: "Pay the delivery charge (${taka(advance)}) now with bKash, Nagad or card. Pay the rest (…) in cash when your order arrives."`)
    await axe(shop, 'checkout with the advance delivery charge')
    await priced(shop)
    await placeButton(shop).click()
    await shop.waitForURL((url) => url.href.startsWith(`${GATEWAY}/gwprocess/`), { timeout: 45000 })
    const session = sessionByKey(new URL(shop.url()).searchParams.get('SESSIONKEY'))
    orderD = session?.form?.value_a ?? null
    if (orderD) made.orders.add(orderD)
    const waiting = orderD ? await orderOf(orderD) : null
    log(session?.form?.total_amount === advance && waiting?.status === 'pending_payment' && waiting?.cod?.advance_amount === advance, `the stand-in is asked for the delivery charge + fee only (${session?.form?.total_amount} of ${waiting?.totals?.total}); ${orderD} waits (${waiting?.status})`)
    await shop.getByRole('button', { name: 'Pay', exact: true }).click()
    await shop.waitForURL((url) => url.pathname === `/order-confirmation/${orderD}` && url.searchParams.get('provider') === 'sslcommerz', { timeout: 30000 })
    log(await visible(shop.locator('.order-page__hero h1').filter({ hasText: 'Delivery charge paid' }), 25000), 'back in the store: "Delivery charge paid"')
    const paid = await orderOf(orderD)
    const due = paid?.cod?.cod_due
    log(paid?.status === 'processing' && paid?.payment_status === 'partially_paid' && paid?.cod?.advance_paid === advance && cents(due) === cents(paid?.totals?.total) - cents(advance), `${orderD}: ${paid?.status}, ${paid?.payment_status}, advance paid ${paid?.cod?.advance_paid}, cash due ${due}`)
    log(paid?.invoices?.length === 1 && /Advance delivery charge paid with bKash through SSLCommerz\./.test(paid?.invoices?.[0]?.note ?? ''), `an invoice for the advance ("${paid?.invoices?.[0]?.note}")`)
    const confirmation = await mainText(shop)
    log(confirmation.includes(`We've received ${taka(advance)} for order ${orderD}. Please keep ${taka(due)} ready to pay in cash on delivery.`), `the shopper is told to keep ${taka(due)} ready`)
    await axe(shop, 'confirmation (delivery charge paid)')
    await shop.goto(`${BASE}/account/orders/${orderD}`, { waitUntil: 'networkidle' })
    await shop.getByText(orderD).first().waitFor()
    const orderText = await mainText(shop)
    log(orderText.includes('Partly paid') && orderText.includes('Paid in advance') && orderText.includes('Due in cash on delivery') && orderText.includes(taka(due)), 'the account order page: "Partly paid", "Paid in advance", "Due in cash on delivery"')
    await shop.context().close()

    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders/${orderD}`, { waitUntil: 'networkidle' })
    await row(admin, 'Paid in advance').waitFor()
    log((await row(admin, 'Paid in advance').innerText()).includes(taka(advance)) && (await row(admin, 'Cash to collect').innerText()).includes(taka(due)), `the admin order page: Paid in advance ${taka(advance)}, Cash to collect ${taka(due)}`)
    log(await visible(admin.getByText('Partly paid').first()), 'the admin payment status: "Partly paid"')
    await axe(admin, 'admin order (advance paid, cash to collect)')
    await phone(admin, 'the admin order page')
    await admin.context().close()

    // An advance never paid: cancelled and restocked when its SSLCommerz window passes.
    const stockBefore = await stockOf(DRESS)
    const unpaid = await api('/api/v1/orders', { method: 'POST', token: shopperToken, body: { email: customer.email, phone: '01712345678', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: bdAddress('banani'), shipping_method: 'standard', payment_method: 'cod' } })
    const orderE = unpaid.body?.data?.number
    if (orderE) made.orders.add(orderE)
    log(unpaid.status === 201 && unpaid.body?.data?.status === 'pending_payment' && Boolean(unpaid.body?.data?.payment?.url) && (await stockOf(DRESS)) === stockBefore - 1, `${orderE}: waits for its advance (${unpaid.body?.data?.status}), a payment link, stock reserved`)
    if (orderE) {
      tinker(`App\\Models\\Order::where('number', '${orderE}')->update(['payment_expires_at' => now()->subMinutes(5)]);`)
      const expiry = await artisan(['buynest:payments:expire-sslcommerz'])
      const expired = await orderOf(orderE)
      log(expiry.status === 0 && expired?.status === 'cancelled' && (await stockOf(DRESS)) === stockBefore, `buynest:payments:expire-sslcommerz: ${orderE} ${expired?.status}, stock back ("${expiry.output.trim().split('\n').pop()}")`)
    }
    await patchSettings({ cod: { advance: 'none' } })
  })

  // ---------- 9. Packing slip PDFs and the courier CSV ----------
  await part('packing slips and courier CSV', async () => {
    if (!orderB || !orderD) throw new Error('no orders for the slips')
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders/${orderB}`, { waitUntil: 'networkidle' })
    const link = admin.getByRole('link', { name: `Download PDF of packing slip ${orderB}` })
    await link.waitFor()
    const single = await download(admin, () => link.click())
    const text = pdfText(single.bytes) ?? ''
    log(single.bytes.subarray(0, 4).toString('latin1') === '%PDF' && /NotoSansBengali/.test(single.bytes.toString('latin1')) && single.name === `packing-slip-${orderB}.pdf`, `the packing slip PDF (${single.name}, ${single.bytes.length} bytes) embeds Noto Sans Bengali`)
    if (text) {
      log(text.includes(orderB) && /PREPAID|Collect in cash/i.test(text) && /Banani/.test(text) && /Inside Dhaka/.test(text) && /01711\s?556677|\+8801711556677/.test(text), 'its text: the order number, the cash line, Banani, Inside Dhaka, the mobile')
      log(hasBangla(text), 'the Bangla order also has its Bangla address column (Bangla letters in the text)')
      log(!/Tartan Dress\s+৳|৳\s*34\.81/.test(text), 'items without prices')
    } else log(true, '(pdftotext not installed: the PDF text was not read)')
    const apiSlip = await call(API, `/api/admin/v1/orders/${orderD}/packing-slip.pdf`, { token: owner, raw: true })
    const apiText = pdfText(apiSlip.bytes) ?? ''
    const dueD = (await orderOf(orderD))?.cod?.cod_due
    log(apiSlip.status === 200 && /application\/pdf/.test(apiSlip.headers.get('content-type') ?? '') && (!apiText || (apiText.includes(orderD) && /Collect in cash/i.test(apiText) && apiText.includes(dueD) && /Advance paid/i.test(apiText))), `${orderD}'s slip: "Collect in cash" ${dueD} and "Advance paid online"`)

    // The grid: filters, bulk PDF, courier CSV.
    await admin.goto(`${BASE}/admin/orders?zone=inside_dhaka&cod=1`, { waitUntil: 'networkidle' })
    await admin.locator('tbody tr').first().waitFor()
    const gridText = await admin.locator('tbody').innerText()
    log(gridText.includes(orderD) && gridText.includes(orderC) && (await admin.getByLabel('Delivery zone').inputValue()) === 'inside_dhaka', 'Orders grid filtered by Delivery zone Inside Dhaka and Cash on delivery lists the test orders')
    await axe(admin, 'orders grid with the zone and COD filters')
    for (const number of [orderB, orderC, orderD]) await admin.getByRole('checkbox', { name: `Select order ${number}` }).check()
    const bar = admin.locator('form.bulk-bar')
    await bar.getByLabel('Action').selectOption({ label: 'Packing slips (PDF)' })
    const bulk = await download(admin, () => bar.getByRole('button', { name: 'Apply' }).click())
    const bulkText = pdfText(bulk.bytes)
    const pages = bulkText === null ? null : bulkText.split('\f').filter((chunk) => chunk.trim()).length
    log(bulk.bytes.subarray(0, 4).toString('latin1') === '%PDF' && /^packing-slips-\d{4}-\d{2}-\d{2}\.pdf$/.test(bulk.name) && (bulkText === null || (pages === 3 && [orderB, orderC, orderD].every((number) => bulkText.includes(number)))), `bulk "Packing slips (PDF)": ${bulk.name}, ${pages ?? '?'} pages, one per order`)
    log(await visible(admin.getByText(/Packing slips downloaded/)), '"Packing slips downloaded (…)" and the orders stay ticked')
    await bar.getByLabel('Action').selectOption({ label: 'Courier CSV' })
    const csv = await download(admin, () => bar.getByRole('button', { name: 'Apply' }).click())
    const bom = csv.bytes.subarray(0, 3).toString('hex') === 'efbbbf'
    const rows = parseCsv(csv.bytes.subarray(bom ? 3 : 0).toString('utf8')).filter((line) => line.some((cell) => cell !== ''))
    const header = rows[0]?.join(',')
    log(bom, `the courier CSV (${csv.name}) starts with a UTF-8 byte order mark`)
    log(header === 'invoice,recipient_name,recipient_phone,recipient_address,district,area,cod_amount,weight_kg,note', `header: ${header}`)
    const byNumber = Object.fromEntries(rows.slice(1).map((line) => [line[0], Object.fromEntries(rows[0].map((key, index) => [key, line[index]]))]))
    const b = byNumber[orderB]
    const d = byNumber[orderD]
    log(rows.length === 4 && Boolean(b && d && byNumber[orderC]), `one row per order (${rows.length - 1})`)
    log(hasBangla(b?.recipient_address) && /Banani/.test(b?.recipient_address ?? '') && b?.district === 'Dhaka' && b?.area === 'Banani', `a Bangla row: "${b?.recipient_address}" (district ${b?.district}, area ${b?.area})`)
    log(b?.recipient_phone === '01711556677' && /^01[3-9]\d{8}$/.test(d?.recipient_phone ?? ''), `phones in the 11-digit local form (${b?.recipient_phone}, ${d?.recipient_phone})`)
    log(d?.cod_amount === dueD && /Inside Dhaka/.test(d?.note ?? '') && /Advance paid/.test(d?.note ?? '') && b?.cod_amount === '0.00' && /^\d+\.\d{2}$/.test(d?.weight_kg ?? ''), `cash to collect ${d?.cod_amount} for ${orderD} ("${d?.note}"), 0.00 for the paid ${orderB}, weight ${d?.weight_kg} kg`)
    const viaApi = await call(API, `/api/admin/v1/orders/export/courier.csv?numbers=${orderC}`, { token: owner, raw: true })
    log(viaApi.status === 200 && viaApi.bytes.subarray(0, 3).toString('hex') === 'efbbbf' && viaApi.bytes.toString('utf8').includes(orderC), `GET …/export/courier.csv?numbers=${orderC}: 200 with the BOM`)
    await admin.context().close()
  })

  // ---------- 10. Other countries unchanged ----------
  await part('other countries', async () => {
    const usCart = await api('/api/v1/cart/validate', { method: 'POST', body: { items: [{ product_id: DRESS, quantity: 1 }], country: 'United States', payment_method: 'cod' } })
    const us = usCart.body?.data
    // Standard now has rows, but only Bangladesh zone rows: other countries keep its flat price (a zone price must
    // never take Standard away abroad). Express has no rows and keeps its flat price too.
    const standardAbroad = us?.shipping_options?.find((option) => option.id === 'standard')
    log(standardAbroad?.source === 'flat' && standardAbroad?.zone_code === null, `a United States cart still gets Standard at its flat price (${standardAbroad?.source}, ${standardAbroad?.price})`)
    const express = us?.shipping_options?.find((option) => option.id === 'express')
    log(us?.delivery_zone === null && express?.zone_code === null && express?.eta_days_min === null && express?.source === 'flat' && express?.price === '12.99' && us?.cod?.available === true, `a United States cart: no zone, Express at its flat price with its usual ETA (${usCart.status}: ${express?.price}, ${express?.source}, "${express?.eta}"), COD offered (zones apply to Bangladesh only)`)
    const placed = await api('/api/v1/orders', {
      method: 'POST',
      body: { guest: { email: `delivery.us.${run}@example.com` }, email: `delivery.us.${run}@example.com`, phone: '+1 555 010 2030', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: { first_name: 'Ana', last_name: 'Lee', line1: '12 Market Street', city: 'Springfield', state: 'Oregon', postal_code: '29112', country: 'United States' }, shipping_method: 'express', payment_method: 'cod' },
    })
    const number = placed.body?.data?.number
    if (number) made.orders.add(number)
    const keys = Object.keys(placed.body?.data?.shipping_address ?? {}).sort()
    log(placed.status === 201 && keys.length === 8 && !keys.includes('area_id') && placed.body?.data?.phone?.startsWith('+1') && placed.body?.data?.delivery?.zone_code === null, `a United States order: the 8 usual address keys (${keys.join(', ')}), phone ${placed.body?.data?.phone}, no zone${placed.status === 201 ? '' : ` (${placed.status} ${JSON.stringify(placed.body).slice(0, 200)})`}`)
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
  await attempt('settings', async () => {
    if (saved.cod) await patchSettings({ cod: { max_order_total: saved.cod.max_order_total, fee: saved.cod.fee, advance: saved.cod.advance, zones: saved.cod.zones, require_confirmation: saved.cod.require_confirmation } })
    if (saved.checkout) await patchSettings({ checkout: saved.checkout })
  })
  await attempt('table rates', async () => {
    const now = (await admin$('/shipping-rates')).body?.data ?? []
    for (const rate of now) {
      if (saved.rateIds && !saved.rateIds.has(rate.id)) {
        const answer = await admin$(`/shipping-rates/${rate.id}`, { method: 'DELETE' })
        if (![200, 204].includes(answer.status)) throw new Error(`DELETE rate ${rate.id} answered ${answer.status}`)
      }
    }
  })
  const numbers = [...made.orders].filter(Boolean)
  await attempt('test orders', async () => {
    // Unpaid ones are cancelled; the customer's others move on to Delivered so it can be deleted.
    for (const number of numbers) {
      const order = (await admin$(`/orders/${number}`)).body?.data
      if (!order || ['cancelled', 'delivered', 'closed'].includes(order.status)) continue
      if (order.status === 'pending_payment' || (order.status === 'processing' && order.payment_status === 'unpaid')) {
        await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
        continue
      }
      if (order.status === 'processing') await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'shipped', notify_customer: false, confirmation_override: 'e2e cleanup' } })
      await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'delivered', notify_customer: false } })
    }
  })
  await attempt('the throwaway customer', async () => {
    if (!made.customerId) return
    const deleted = await admin$(`/customers/${made.customerId}`, { method: 'DELETE' })
    if (deleted.status !== 204) throw new Error(`DELETE customer answered ${deleted.status} ${JSON.stringify(deleted.body?.errors ?? deleted.body?.message)}`)
  })
  await attempt('notifications and payment events', () => {
    if (!numbers.length) return
    const links = numbers.map((number) => `'/orders/${number}'`).join(',')
    const likes = numbers.map((number) => `->orWhere('id', 'like', 'return:${number}-%')->orWhere('id', 'like', '${number}-%')`).join('')
    tinker(
      `$ids = App\\Models\\AdminNotification::whereIn('type', ['payment_problem', 'cod_short_collection'])->whereIn('link', [${links}])->pluck('id');` +
        ` DB::table('admin_notification_reads')->whereIn('notification_id', $ids)->delete(); App\\Models\\AdminNotification::whereIn('id', $ids)->delete();` +
        ` DB::table('payment_events')->where('provider', 'sslcommerz')->where(fn ($q) => $q->where('id', 'like', 'VAL${RUN}%')${likes})->delete();`,
    )
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  const settings = (await admin$('/settings')).body?.data
  const checkoutBack = !saved.checkout || (JSON.stringify(settings?.checkout?.enabled_payment_methods) === JSON.stringify(saved.checkout.enabled_payment_methods) && (settings?.checkout?.default_country ?? null) === saved.checkout.default_country && JSON.stringify(settings?.checkout?.allowed_countries) === JSON.stringify(saved.checkout.allowed_countries))
  const codBack = !saved.cod || JSON.stringify(settings?.cod) === JSON.stringify(saved.cod)
  const rateIds = ((await admin$('/shipping-rates')).body?.data ?? []).map((rate) => rate.id)
  const ratesBack = !saved.rateIds || (rateIds.length === saved.rateIds.size && rateIds.every((id) => saved.rateIds.has(id)))
  const zonesBack = !saved.zones || (await zonesFingerprint()) === saved.zones
  const open = []
  for (const number of numbers) if (['pending_payment', 'processing', 'shipped'].includes((await orderOf(number))?.status)) open.push(number)
  const leftCustomer = ((await admin$(`/customers?search=${encodeURIComponent(customer.email)}`)).body?.data ?? []).length
  const leftNotes = ((await admin$('/notifications?per_page=50')).body?.data ?? []).filter((item) => numbers.some((number) => item.link === `/orders/${number}`))
  const ok = problems.length === 0 && checkoutBack && codBack && ratesBack && zonesBack && open.length === 0 && leftCustomer === 0 && leftNotes.length === 0
  log(
    ok,
    `cleanup: Settings → Checkout and Cash on delivery back as read, the table rates made here deleted, zones unchanged, test orders cancelled or delivered, the throwaway customer deleted, notifications and payment events removed, stock put back${ok ? '' : ` — left: ${[...problems, `checkout ${checkoutBack}`, `cod ${codBack} ${JSON.stringify(settings?.cod)}`, `rates ${ratesBack}`, `zones ${zonesBack}`, ...open, `${leftCustomer} customer`, ...leftNotes.map((item) => item.title)].join('; ')}`}`,
  )
  // With the defaults back, a free-text Bangladesh address (no place ids) still works as before.
  if (saved.checkout?.default_country === null) {
    const free = await api('/api/v1/cart/validate', { method: 'POST', body: { items: [{ product_id: DRESS, quantity: 1 }], country: 'Bangladesh', payment_method: 'cod' } })
    log(free.status === 200 && free.body?.data?.delivery_zone === null && free.body?.data?.cod?.available === true, `after the reset a free-text Bangladesh cart has no zone and cash on delivery as before (${free.status})`)
  }
}
