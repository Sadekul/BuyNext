// Phase 21, end to end in a real browser: sales and cash reports (docs/backend/PHASE21_CONTRACT.md §4).
// Nothing reaches a real courier, payment provider or SMS gateway.
//
// The suite starts its own servers and stops them at the end (also on failure and Ctrl+C), like courier.mjs:
//   - a stand-in for Steadfast's merchant API on http://127.0.0.1:12161/api/v1 (create_order, with the Api-Key /
//     Secret-Key headers checked)
//   - a stand-in for Pathao's merchant API on http://127.0.0.1:12162 (issue-token and orders, Bearer token checked),
//     only to book the parcel that comes back "Returned"
//   - a second Laravel API on :8015 with BUYNEST_CURRENCY=BDT and both couriers set up through the process environment
//     (which wins over backend/.env), so the usual API on :8000 stays as it is
//   - a second storefront dev server on :5185 pointed at it; the admin comes through it at /admin
// Both APIs share the dev database, so every figure is checked as a change from what the reports said before the
// suite's own orders (other suites' orders stay in the database), plus the identities that must always hold
// (breakdowns add up to the totals, owed = collected − fees − payouts).
//
// Orders (a throwaway customer and two throwaway products, Bangladesh addresses, cash on delivery):
//   A  shipped by the shop's own delivery (carrier "other"), cash collected by staff ("Mark as delivered") → cash:staff
//   B  booked with Steadfast and delivered through its webhook, with the cash and a ৳60 fee → cash:steadfast
//   C  booked with Steadfast and not yet collected (Still to collect), later collected by staff on the order page:
//      the rider of the latest (courier) shipment has the cash, so it counts for Steadfast, not staff
//   D  a guest order booked with Pathao and reported "Returned" (it stays shipped: a returned parcel has no order status)
//   E  created by staff (bank transfer, a United States address: no delivery zone) and invoiced by staff → "other"
//      (staff-invoiced instead of an online payment through a stand-in: no provider is set up on the suite's API)
// Checks: Sales by payment method and by delivery zone (API and page); Money in (channels add up, page, CSV with BOM);
// Cash on delivery (courier balance = collected − fees − payouts, period table, staff cash, Still to collect with its
// filters and link, CSVs with BOM); courier payments (record, field errors, the duplicate warning through both hops,
// edit into a negative balance, delete, the balance going down and back up); a Viewer sees the pages but can't record
// (403 permission_denied from the API through the sign-in service); the time zone (Asia/Dhaka moves an order placed
// at 20:00 UTC to the next day, then the setting is put back); axe and 390 px on the three new pages.
//
// Left behind on purpose (like the other suites): orders A–E with their shipments, invoices, timelines, audit entries
// and emails. D stays shipped with a returned Pathao parcel (a shipped order can only move on to delivered); a parcel that
// came back is not counted in "Still to collect". Put back or removed: every settings row as read at the start (rows that did not exist are
// deleted, not written with a default), the courier payments it recorded (deleted: soft-deleted rows don't count),
// E's placed-at time, the throwaway customer and products, the Viewer admin (deactivated), courier notifications of
// the test orders, the Pathao token cached by the suite's API, saved carts, stock.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'

const STEADFAST_PORT = 12161
const PATHAO_PORT = 12162
const API_PORT = 8015
const STORE_PORT = 5185
const PORTS = [STEADFAST_PORT, PATHAO_PORT, API_PORT, STORE_PORT]
const API = `http://127.0.0.1:${API_PORT}`
const STORE = `http://localhost:${STORE_PORT}`
const BACKEND = join(import.meta.dirname, '..', 'backend')
const FRONTEND = join(import.meta.dirname, '..', 'frontend')

const SF = { key: 'e2e-reports-steadfast-key', secret: 'e2e-reports-steadfast-secret', webhook: 'e2e-reports-steadfast-webhook' }
const PA = { clientId: 'e2e-reports-pathao', clientSecret: 'e2e-reports-pathao-secret', username: 'reports@buynest.test', password: 'e2e-reports-pathao-password', storeId: '8899', webhook: 'e2e-reports-pathao-webhook' }

// lib.mjs reads these when it loads: this suite's storefront and API, not the usual ones.
process.env.BASE_URL = STORE
process.env.LARAVEL_URL = API
const lib = await import('./lib.mjs')
const { ADMIN_USER, BASE, LARAVEL, SHOPPER, SHOPPER_2, adminSignIn, axeViolations, clearSavedCart, latestCode, preserveStock, reporter, sidewaysOverflow, visible, watchErrors } = lib

const report = reporter('reports: sales by method and zone, money in, cash on delivery, courier payments, time zone')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const run = Date.now().toString(36)
const RUN = run.toUpperCase()
/** Every courier payment this suite records has a reference starting with this (cleanup also removes earlier runs'). */
const REF_PREFIX = 'E2E-RPT-'
const REF = (n) => `${REF_PREFIX}${RUN}-${n}`
let sequence = 0
const nextId = (prefix) => `${prefix}${RUN}${(++sequence).toString(36).toUpperCase().padStart(4, '0')}`

/** The API's environment (artisan too): taka, both couriers set up against the stand-ins. */
const suiteEnv = {
  ...process.env,
  BUYNEST_CURRENCY: 'BDT',
  STEADFAST_API_KEY: SF.key,
  STEADFAST_SECRET_KEY: SF.secret,
  STEADFAST_API_URL: `http://127.0.0.1:${STEADFAST_PORT}/api/v1`,
  STEADFAST_WEBHOOK_TOKEN: SF.webhook,
  PATHAO_CLIENT_ID: PA.clientId,
  PATHAO_CLIENT_SECRET: PA.clientSecret,
  PATHAO_USERNAME: PA.username,
  PATHAO_PASSWORD: PA.password,
  PATHAO_STORE_ID: PA.storeId,
  PATHAO_MODE: 'sandbox',
  PATHAO_API_URL: `http://127.0.0.1:${PATHAO_PORT}`,
  PATHAO_WEBHOOK_SECRET: PA.webhook,
  STOREFRONT_URL: STORE,
  APP_URL: API,
}
// Laravel compacts its output when it sees AI_AGENT; tinker's JSON is read below.
const phpEnv = { ...process.env }
delete phpEnv.AI_AGENT

// ---------------------------------------------------------------- Courier stand-ins
const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
const parse = (raw) => {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return null
  }
}

/* Steadfast (Packzy): create_order only, in Steadfast's shapes. */
const sf = { orders: [], unauthorized: 0, nextConsignment: 60_000_000 + Math.floor(Math.random() * 1_000_000) * 10 }
const steadfastApi = createHttpServer(async (req, res) => {
  const raw = await readBody(req)
  const url = new URL(req.url, 'http://stand-in')
  if (req.headers['api-key'] !== SF.key || req.headers['secret-key'] !== SF.secret) {
    sf.unauthorized++
    return sendJson(res, 401, { status: 401, message: 'Unauthorized' })
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/create_order') {
    const body = parse(raw)
    const record = { body, answer: null }
    sf.orders.push(record)
    if (!body || !body.invoice || !/^01\d{9}$/.test(String(body.recipient_phone)) || body.cod_amount === undefined) {
      record.answer = { status: 422, errors: { invoice: ['The invoice, an 11-digit phone and the cod amount are required.'] } }
      return sendJson(res, 422, record.answer)
    }
    sf.nextConsignment += 7
    record.answer = {
      status: 200,
      message: 'Consignment has been created successfully.',
      consignment: { consignment_id: sf.nextConsignment, invoice: body.invoice, tracking_code: nextId('SF').toLowerCase(), cod_amount: body.cod_amount, status: 'in_review', created_at: new Date().toISOString() },
    }
    return sendJson(res, 200, record.answer)
  }
  return sendJson(res, 404, { status: 404, message: `No stand-in for ${req.method} ${url.pathname}` })
})

/* Pathao ("Aladdin" merchant API): a token and a booking, in Pathao's shapes. No delivery fee is reported. */
const pa = { tokens: new Set(), orders: [], refused: 0 }
const pathaoApi = createHttpServer(async (req, res) => {
  const raw = await readBody(req)
  const path = new URL(req.url, 'http://stand-in').pathname
  if (req.method === 'POST' && path === '/aladdin/api/v1/issue-token') {
    const body = parse(raw) ?? {}
    if (body.client_id !== PA.clientId || body.client_secret !== PA.clientSecret || body.username !== PA.username || body.password !== PA.password) {
      return sendJson(res, 401, { message: 'Client authentication failed', type: 'error', code: 401 })
    }
    const token = `pathao-reports-${nextId('T').toLowerCase()}`
    pa.tokens.add(token)
    return sendJson(res, 200, { token_type: 'Bearer', expires_in: 432000, access_token: token, refresh_token: `${token}-refresh` })
  }
  if (!pa.tokens.has((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))) {
    pa.refused++
    return sendJson(res, 401, { message: 'Unauthenticated.', type: 'error', code: 401 })
  }
  if (req.method === 'POST' && path === '/aladdin/api/v1/orders') {
    const body = parse(raw) ?? {}
    const record = { body, answer: null }
    pa.orders.push(record)
    if (!body.merchant_order_id || !body.recipient_city || !body.recipient_zone || !Number.isInteger(body.amount_to_collect)) {
      record.answer = { message: 'Please fix the given errors', type: 'error', code: 422, errors: { recipient_city: ['The recipient city field is required.'] } }
      return sendJson(res, 422, record.answer)
    }
    record.answer = { message: 'Order Created Successfully', type: 'success', code: 200, data: { consignment_id: nextId('DL'), merchant_order_id: body.merchant_order_id, order_status: 'Pending' } }
    return sendJson(res, 200, record.answer)
  }
  return sendJson(res, 404, { message: `No stand-in for ${req.method} ${path}`, type: 'error', code: 404 })
})

// ---------------------------------------------------------------- Servers this suite starts and stops
const children = []
const servers = []
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
}
process.on('exit', () => children.forEach((child) => killGroup(child, 'SIGKILL')))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n(${signal}: putting things back and stopping the servers this suite started)`)
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
const call = async (base, path, { method = 'GET', token, body, headers = {} } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
      body: body && JSON.stringify(body),
    })
    // Busy runs can reach the API's per-minute limits: wait as long as it asks, then try again.
    if (response.status === 429 && attempt < 4) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) }
  }
}
const api = (path, options) => call(API, path, options)
/** Runs PHP in the backend (local development only): reads, backdating and cleanup without an endpoint. */
function tinker(code) {
  const result = spawnSync('php', ['artisan', 'tinker', `--execute=${code}`], { cwd: BACKEND, env: phpEnv, encoding: 'utf8', timeout: 60_000 })
  if (result.status !== 0) throw new Error(`tinker failed: ${(result.stderr || result.stdout).trim().slice(0, 200)}`)
  return result.stdout.trim()
}
const tinkerJson = (code) => {
  const out = tinker(code)
  const start = out.search(/[[{]/)
  return start < 0 ? null : JSON.parse(out.slice(start))
}
/** PHP string literal for any text (no quoting problems). */
const php = (text) => `base64_decode('${Buffer.from(String(text), 'utf8').toString('base64')}')`
/** Every settings row (key → raw value). */
const settingsRows = () => tinkerJson("echo json_encode(DB::table('settings')->pluck('value', 'key'));") ?? {}

const cents = (value) => Math.round(Number(value ?? 0) * 100)
const taka = (value) => `৳${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const takaCents = (value) => taka(value / 100)
const count = (value) => Number(value).toLocaleString('en-US')
const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()
const dayWords = (day) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
const shortDay = (day) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
const plusDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
/** A small CSV reader (quoted fields, "" escapes, commas and newlines inside quotes), as in delivery.mjs. */
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
  return rows.filter((line) => line.some((cell) => cell !== ''))
}

const customer = { firstName: 'Rehana', lastName: `Ledger${run}`, email: `reports.${run}@example.com`, password: 'ReportsPass2026', phone: '+880 1711 445566' }
const guestEmail = `reports.guest.${run}@example.com`
const viewer = { email: `viewer.reports.${run}@buynest.test`, password: 'ViewerReports2026pass' }
const made = { orders: new Set(), customerId: null, products: [], payouts: new Set(), viewerId: null, backdated: null }
const saved = { rows: null, courierSettings: null }
let cleaned = false // cleanup runs once (the finally block or Ctrl+C)
const ids = {}
let browser
let restoreStock = async () => 0
let owner
let shopperToken = null
const errors = []
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const latestShipment = (order) => (order?.shipments ?? []).at(-1) ?? null
const steadfastHook = (body) => api('/api/v1/couriers/steadfast/webhook', { method: 'POST', body, headers: { Authorization: `Bearer ${SF.webhook}` } })
const pathaoHook = (body) => api('/api/v1/couriers/pathao/webhook', { method: 'POST', body, headers: { 'X-PATHAO-Signature': PA.webhook } })
const bdAddress = (extra = {}) => ({ first_name: 'Karim', last_name: 'Uddin', line1: 'House 9, Road 11', country: 'Bangladesh', division_id: ids.dhakaDivision, district_id: ids.dhakaDistrict, area_id: ids.banani, ...extra })
/** The kind and collected_via of an order's invoices (Phase 21 columns, not in any API answer). */
const invoiceKinds = (number) =>
  tinkerJson(`echo json_encode(App\\Models\\Invoice::whereIn('order_id', App\\Models\\Order::where('number', '${number}')->pluck('id'))->orderBy('id')->get(['kind', 'collected_via', 'amount']));`) ?? []
/** Courier payments with this suite's reference prefix (this run's and any earlier interrupted run's). */
async function suitePayouts() {
  const found = []
  for (let page = 1; page <= 20; page++) {
    const answer = await admin$(`/courier-payouts?per_page=100&page=${page}`)
    for (const payout of answer.body?.data ?? []) if ((payout.reference ?? '').startsWith(REF_PREFIX)) found.push(payout)
    if (!answer.body?.meta || page >= answer.body.meta.last_page) break
  }
  return found
}

// ---------------------------------------------------------------- Start
try {
  for (const port of PORTS) {
    if (await portOpen(port)) throw new Error(`port ${port} is already in use: stop whatever runs there (an earlier run?)`)
  }
  servers.push(steadfastApi, pathaoApi)
  await new Promise((resolve) => steadfastApi.listen(STEADFAST_PORT, '127.0.0.1', resolve))
  await new Promise((resolve) => pathaoApi.listen(PATHAO_PORT, '127.0.0.1', resolve))

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

  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  // Before anything can change them: what to put back.
  saved.rows = settingsRows()
  if (!saved.rows || Object.keys(saved.rows).length === 0) throw new Error('could not read the settings rows')
  saved.courierSettings = (await admin$('/couriers')).body?.settings ?? null
  if (JSON.parse(saved.rows.sms_enabled ?? 'false') === true) throw new Error('SMS sending is switched on (Settings → SMS): this suite places orders and must not send SMS')
  restoreStock = await preserveStock()
  // A Pathao token cached by an earlier run (another suite's stand-in) would only be refused: start clean.
  tinker("Cache::forget('couriers.pathao.token'); echo 'ok';")
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
  let lastPage = null
  /** One part of the suite: a failure is reported and the next part still runs. */
  async function part(name, body) {
    try {
      await body()
    } catch (error) {
      log(false, `${name} stopped early: ${error.message.split('\n')[0]}`)
      if (process.env.REPORTS_DEBUG) console.log(name, error.stack, lastPage?.url(), await lastPage?.screenshot({ path: `${process.env.REPORTS_DEBUG}/${name.replace(/\W+/g, '-')}.png`, fullPage: true }).then(() => 'shot', () => 'no shot'))
    }
  }
  async function newPage({ viewport = { width: 1440, height: 900 } } = {}) {
    const context = await browser.newContext({ viewport, bypassCSP: true, acceptDownloads: true })
    context.setDefaultTimeout(15000)
    // This suite starts its own storefront dev server: its first page compiles can be slow (SQA S2).
    context.setDefaultNavigationTimeout(45000)
    lastPage = watchErrors(await context.newPage(), errors)
    return lastPage
  }
  async function adminPage(account = ADMIN_USER) {
    const admin = await newPage()
    await adminSignIn(admin, account)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    return admin
  }
  async function download(page, click) {
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), click()])
    const path = await file.path()
    const bytes = path ? readFileSync(path) : Buffer.alloc(0)
    const bom = bytes.subarray(0, 3).toString('hex') === 'efbbbf'
    return { name: file.suggestedFilename(), bom, rows: parseCsv(bytes.subarray(bom ? 3 : 0).toString('utf8')) }
  }
  /** The cells of a table row whose header cell is `label` (texts, squashed). */
  const rowCells = async (scope, label) => {
    const row = scope.getByRole('row').filter({ has: scope.page().getByRole('rowheader', { name: label, exact: true }) })
    if ((await row.count()) === 0) return null
    return (await row.first().locator('th, td').allInnerTexts()).map(squash)
  }
  /** Opens the "Show the numbers as a table" of the chart whose table has this caption. */
  const openTable = async (page, caption) => {
    const details = page.locator('details.chart__table').filter({ has: page.locator('caption', { hasText: caption }) })
    await details.first().waitFor({ state: 'attached' })
    if (!(await details.first().evaluate((element) => element.open))) await details.first().locator('summary').click()
    return details.first()
  }
  const report$ = async (name, query) => {
    const answer = await admin$(`/reports/${name}?${new URLSearchParams(query)}`)
    if (answer.status !== 200) throw new Error(`GET reports/${name} answered ${answer.status} ${JSON.stringify(answer.body?.errors ?? answer.body?.message)}`)
    return answer.body
  }
  const methodRow = (sales, key) => sales.by_payment_method.find((row) => row.method === key) ?? { orders: 0, gross: '0.00', refunds: '0.00', net: '0.00' }
  const zoneRow = (sales, code) => sales.by_delivery_zone.find((row) => row.zone_code === code) ?? { orders: 0, gross: '0.00', refunds: '0.00', net: '0.00' }
  const channel = (payments, key) => payments.channels.find((row) => row.channel === key) ?? { amount: '0.00', count: 0 }
  const balance = (cod, carrier) => cod.balances.find((row) => row.carrier === carrier) ?? { collected_all_time: '0.00', fees_all_time: null, payouts_all_time: '0.00', owed: '0.00', last_payout_on: null, note: null }
  const periodRow = (cod, carrier) => cod.period.find((row) => row.carrier === carrier) ?? { shipped: 0, delivered: 0, returned: 0, cancelled: 0, collected: '0.00', fees: null, payouts: '0.00' }
  /** A titled section (its table wrapper is a region with the same name: the section comes first). */
  const region = (page, name) => page.getByRole('region', { name, exact: true }).first()
  const sum = (rows, key) => rows.reduce((total, row) => total + cents(row[key]), 0)
  const owedAddsUp = (cod) => cod.balances.every((row) => cents(row.owed) === cents(row.collected_all_time) - cents(row.fees_all_time) - cents(row.payouts_all_time) && row.note === (cents(row.owed) >= 0 ? null : cents(row.payouts_all_time) > 0 ? 'paid_more_than_recorded' : 'fees_more_than_collected'))

  let today = null
  const base = {}
  const O = {} // label → { number, total (cents) }

  // ---------- 0. The isolated setup, throwaway data, what the reports say before ----------
  await part('setup', async () => {
    const apiStore = (await api('/api/v1/store')).body?.data
    log(apiStore?.currency?.code === 'BDT', `API on :${API_PORT} charges in taka (${apiStore?.currency?.code})`)
    const couriers = (await admin$('/couriers')).body?.data ?? []
    log(['steadfast', 'pathao'].every((key) => couriers.find((item) => item.key === key)?.configured === true), `Steadfast and Pathao are set up on :${API_PORT} (the stand-ins)`)
    const fromStore = await fetch(`${STORE}/api/catalog/store`).then((r) => r.json(), () => null)
    log((fromStore?.data?.currency?.code ?? fromStore?.currency?.code) === 'BDT', `storefront on :${STORE_PORT} talks to :${API_PORT}`)

    // What this suite needs from Settings → Checkout and Cash on delivery (read only: changed only if missing, put back at the end).
    const settings = (await admin$('/settings')).body?.data
    const needs = {}
    const allowed = settings?.checkout?.allowed_countries ?? []
    if (!['Bangladesh', 'United States'].every((country) => allowed.includes(country))) needs.checkout = { ...needs.checkout, allowed_countries: [...new Set([...allowed, 'Bangladesh', 'United States'])] }
    const methods = settings?.checkout?.enabled_payment_methods ?? []
    if (!methods.includes('cod')) needs.checkout = { ...needs.checkout, enabled_payment_methods: [...methods, 'cod'] }
    if (settings?.checkout?.guest_checkout === false) needs.checkout = { ...needs.checkout, guest_checkout: true }
    if (settings?.cod?.advance && settings.cod.advance !== 'none') needs.cod = { advance: 'none' }
    if (settings?.cod?.max_order_total) needs.cod = { ...needs.cod, max_order_total: null }
    if (Object.keys(needs).length) {
      const answer = await admin$('/settings', { method: 'PATCH', body: needs })
      if (answer.status !== 200) throw new Error(`PATCH settings ${JSON.stringify(needs)} answered ${answer.status} ${JSON.stringify(answer.body?.errors ?? answer.body?.message)}`)
    }
    log(true, `settings for the run: ${Object.keys(needs).length ? `changed for the run ${JSON.stringify(needs)} (put back at the end)` : 'nothing to change'}; time zone ${settings?.general?.store_timezone}`)

    // Payments left by an interrupted earlier run would change the balances under the checks.
    const leftovers = await suitePayouts()
    for (const payout of leftovers) await admin$(`/courier-payouts/${payout.id}`, { method: 'DELETE' })
    if (leftovers.length) console.log(`(removed ${leftovers.length} courier payments left by an earlier interrupted run)`)

    // Places (Dhaka → Dhaka → Banani), the throwaway customer and products.
    const divisions = (await api('/api/v1/places/bd/divisions')).body?.data ?? []
    ids.dhakaDivision = divisions.find((item) => item.name_en === 'Dhaka')?.id
    ids.dhakaDistrict = ((await api(`/api/v1/places/bd/districts?division=${ids.dhakaDivision}`)).body?.data ?? []).find((item) => item.name_en === 'Dhaka')?.id
    ids.banani = ((await api(`/api/v1/places/bd/areas?district=${ids.dhakaDistrict}`)).body?.data ?? []).find((item) => item.name_en === 'Banani')?.id
    if (!ids.dhakaDivision || !ids.dhakaDistrict || !ids.banani) throw new Error(`Bangladesh places not found (${JSON.stringify(ids)})`)
    const registered = await api('/api/v1/auth/register', {
      method: 'POST',
      body: { first_name: customer.firstName, last_name: customer.lastName, email: customer.email, phone: customer.phone, password: customer.password, password_confirmation: customer.password, accept_terms: true },
    })
    const verified = registered.status === 201 ? await api('/api/v1/auth/verify-email', { method: 'POST', body: { email: customer.email, code: (await latestCode(customer.email)).code } }) : registered
    made.customerId = ((await admin$(`/customers?search=${encodeURIComponent(customer.email)}`)).body?.data ?? []).find((item) => item.email === customer.email)?.id ?? null
    if (!made.customerId) throw new Error(`the throwaway customer could not sign up (${registered.status} ${JSON.stringify(registered.body?.errors ?? registered.body?.message)})`)
    shopperToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: customer.email, password: customer.password } })).body?.data?.tokens?.access_token
    log(verified.status === 200 && Boolean(shopperToken), `a throwaway customer signed up and confirmed (${customer.email}, #${made.customerId})`)
    for (const [key, price] of [
      ['lamp', 1250],
      ['tray', 640],
    ]) {
      const created = await admin$('/products', { method: 'POST', body: { name: `E2E Report ${key} ${run}`, category: 'home-decoration', price, stock_quantity: 60, status: 'active', sku: `E2E-RPT-${key}-${run}`.toUpperCase(), weight: 500 } })
      if (created.body?.data?.id) made.products.push(created.body.data.id)
      ids[key] = created.body?.data?.id
    }
    log(Boolean(ids.lamp && ids.tray), `two throwaway products (#${ids.lamp}, #${ids.tray})`)
    if (!ids.lamp || !ids.tray) throw new Error('the throwaway products could not be made')

    // The reports before this suite's orders: every figure below is checked as a change from these.
    const sales = await report$('sales', {})
    today = sales.meta?.to
    log(/^\d{4}-\d{2}-\d{2}$/.test(today ?? '') && typeof sales.meta?.timezone === 'string', `the reports' "today" is ${today} (${sales.meta?.timezone}); meta.timezone is there`)
    base.sales = (await report$('sales', { from: today, to: today })).data
    base.payments = (await report$('payments', { from: today, to: today })).data
    base.cod = (await report$('cod', { from: today, to: today })).data
  })
  if (!today) throw new Error('the setup did not finish')

  // ---------- 1. The orders ----------
  await part('orders', async () => {
    const confirm = async (number) => {
      const order = await orderOf(number)
      if (order?.confirmation?.status && !['confirmed', 'not_required'].includes(order.confirmation.status)) {
        await admin$(`/orders/${number}/confirmation`, { method: 'POST', body: { outcome: 'confirmed', notify_customer: false } })
      }
    }
    const placeCod = async (label, items, guest = null) => {
      const body = { email: guest ?? customer.email, phone: '01711 445566', items, shipping_address: bdAddress({ first_name: `Order${label}` }), shipping_method: 'standard', payment_method: 'cod', ...(guest && { guest: { email: guest } }) }
      const placed = await api('/api/v1/orders', { method: 'POST', token: guest ? undefined : shopperToken, body })
      const number = placed.body?.data?.number
      if (!number) throw new Error(`order ${label} not placed: ${placed.status} ${JSON.stringify(placed.body?.errors ?? placed.body?.message)}`)
      made.orders.add(number)
      await confirm(number)
      const order = await orderOf(number)
      O[label] = { number, total: cents(order.totals.total), zone: order.delivery?.zone_code ?? order.delivery_zone?.code ?? null }
      return order
    }
    const a = await placeCod('A', [{ product_id: ids.lamp, quantity: 1 }])
    await placeCod('B', [
      { product_id: ids.lamp, quantity: 1 },
      { product_id: ids.tray, quantity: 1 },
    ])
    await placeCod('C', [{ product_id: ids.tray, quantity: 2 }])
    await placeCod('D', [{ product_id: ids.tray, quantity: 1 }], guestEmail)
    log(['A', 'B', 'C', 'D'].every((label) => O[label]) && a.payment_method === 'cod' && a.currency === 'BDT' && a.status === 'processing', `four cash on delivery orders with a Banani address: ${['A', 'B', 'C', 'D'].map((label) => `${label} ${O[label]?.number} ${takaCents(O[label]?.total)}`).join(', ')} (D as a guest)`)

    const e = await admin$('/orders', {
      method: 'POST',
      body: {
        customer_id: made.customerId,
        items: [{ product_id: ids.lamp, quantity: 1 }],
        shipping_address: { first_name: 'Ellen', last_name: 'Ledger', line1: '9 Ledger Lane', city: 'Springfield', state: 'Oregon', postal_code: '97477', country: 'United States' },
        shipping_method: 'standard',
        payment_method: 'bank_transfer',
        notify_customer: false,
      },
    })
    const numberE = e.body?.data?.number
    if (!numberE) throw new Error(`order E not created: ${e.status} ${JSON.stringify(e.body?.errors ?? e.body?.message)}`)
    made.orders.add(numberE)
    O.E = { number: numberE, total: cents(e.body.data.totals.total) }
    log(e.status === 201 && e.body.data.payment_method === 'bank_transfer', `order E ${numberE} created by staff: bank transfer to the United States, ${takaCents(O.E.total)}`)
  })
  if (!O.A || !O.B || !O.C || !O.D || !O.E) throw new Error('the orders were not placed')

  // ---------- 2. Shipping, delivering, collecting, invoicing ----------
  await part('fulfilment', async () => {
    // A: the shop's own delivery; staff confirm the cash on the order page.
    const shippedA = await admin$(`/orders/${O.A.number}/shipments`, { method: 'POST', body: { carrier: 'other', notify_customer: false } })
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders/${O.A.number}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Mark as delivered' }).click()
    let dialog = admin.getByRole('dialog', { name: `Mark order ${O.A.number} as delivered?` })
    const amountA = await dialog.getByLabel('Amount collected (BDT)').inputValue()
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click()
    log(shippedA.status === 201 && cents(amountA) === O.A.total && (await visible(admin.getByText(/collected and the order is paid\./))), `A ${O.A.number}: shipped by the shop (carrier other), "Mark as delivered" with ${taka(amountA)} → "… collected and the order is paid."`)
    const kindsA = invoiceKinds(O.A.number)
    log(kindsA.length === 1 && kindsA[0].kind === 'cod_collection' && kindsA[0].collected_via === 'staff', `A's invoice: ${JSON.stringify(kindsA)} (cod_collection, collected by staff)`)

    // B: Steadfast books it and reports it delivered with the cash and its fee.
    const bookedB = await admin$(`/orders/${O.B.number}/courier-booking`, { method: 'POST', body: { courier: 'steadfast' } })
    const shipmentB = latestShipment(await orderOf(O.B.number))
    const consignmentB = shipmentB?.courier?.consignment_id
    log(bookedB.status < 300 && shipmentB?.carrier === 'steadfast' && Boolean(consignmentB), `B ${O.B.number}: booked with Steadfast (consignment ${consignmentB}, ${bookedB.status})`)
    const hook = await steadfastHook({ notification_type: 'delivery_status', consignment_id: Number(consignmentB), invoice: O.B.number, cod_amount: O.B.total / 100, status: 'delivered', delivery_charge: 60, tracking_message: 'Delivered (e2e reports)', updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) })
    const deliveredB = await orderOf(O.B.number)
    const parcelB = latestShipment(deliveredB)?.courier
    log(hook.status === 200 && deliveredB?.status === 'delivered' && deliveredB?.payment_status === 'paid' && cents(parcelB?.collected) === O.B.total && parcelB?.courier_fee === '60.00', `Steadfast's webhook "delivered": B ${deliveredB?.status}, ${deliveredB?.payment_status}, collected ${parcelB?.collected}, fee ${parcelB?.courier_fee}`)
    const kindsB = invoiceKinds(O.B.number)
    log(kindsB.length === 1 && kindsB[0].kind === 'cod_collection' && kindsB[0].collected_via === 'steadfast', `B's invoice: ${JSON.stringify(kindsB)} (cod_collection, collected by Steadfast)`)

    // C: booked with Steadfast, not delivered yet.
    const bookedC = await admin$(`/orders/${O.C.number}/courier-booking`, { method: 'POST', body: { courier: 'steadfast' } })
    const c = await orderOf(O.C.number)
    O.C.consignment = latestShipment(c)?.courier?.consignment_id
    log(bookedC.status < 300 && c?.status === 'shipped' && latestShipment(c)?.courier?.delivery_status === 'booked' && c?.payment_status !== 'paid', `C ${O.C.number}: booked with Steadfast and shipped, nothing collected yet (consignment ${O.C.consignment})`)

    // D: Pathao books it; the parcel comes back.
    const bookedD = await admin$(`/orders/${O.D.number}/courier-booking`, { method: 'POST', body: { courier: 'pathao', pathao: { city_id: 1, zone_id: 101 } } })
    const consignmentD = latestShipment(await orderOf(O.D.number))?.courier?.consignment_id
    const returned = await pathaoHook({ consignment_id: consignmentD, merchant_order_id: O.D.number, event: 'order.returned', order_status: 'Returned', updated_at: new Date().toISOString() })
    const d = await orderOf(O.D.number)
    log(bookedD.status < 300 && returned.status === 202 && latestShipment(d)?.carrier === 'pathao' && latestShipment(d)?.courier?.delivery_status === 'returned' && d?.status === 'shipped', `D ${O.D.number}: booked with Pathao (${bookedD.status}), Pathao's webhook "Returned" (${returned.status}) → parcel ${latestShipment(d)?.courier?.delivery_status}, order still ${d?.status}`)

    // E: staff invoice the bank transfer on the order page.
    await admin.goto(`${BASE}/admin/orders/${O.E.number}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Invoice', exact: true }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
    await admin.getByRole('dialog').waitFor({ state: 'hidden' })
    let e = null
    for (let tries = 0; tries < 60 && e?.payment_status !== 'paid'; tries++) {
      e = await orderOf(O.E.number)
      if (e?.payment_status !== 'paid') await sleep(250)
    }
    const kindsE = invoiceKinds(O.E.number)
    log(e?.payment_status === 'paid' && kindsE.length === 1 && kindsE[0].kind === null && kindsE[0].collected_via === null, `E ${O.E.number}: invoiced by staff (${e?.payment_status}; invoice kind ${kindsE[0]?.kind}, collected_via ${kindsE[0]?.collected_via})`)
    await admin.context().close()
  })

  // ---------- 3. Sales by payment method and by delivery zone ----------
  await part('sales breakdowns', async () => {
    const sales = (await report$('sales', { from: today, to: today })).data
    const cod = ['A', 'B', 'C', 'D'].reduce((total, label) => total + O[label].total, 0)
    const deltaCod = cents(methodRow(sales, 'cod').gross) - cents(methodRow(base.sales, 'cod').gross)
    const deltaBank = cents(methodRow(sales, 'bank_transfer').gross) - cents(methodRow(base.sales, 'bank_transfer').gross)
    log(methodRow(sales, 'cod').orders - methodRow(base.sales, 'cod').orders === 4 && deltaCod === cod, `by_payment_method "cod": +4 orders, +${takaCents(deltaCod)} gross (A–D: ${takaCents(cod)})`)
    log(methodRow(sales, 'bank_transfer').orders - methodRow(base.sales, 'bank_transfer').orders === 1 && deltaBank === O.E.total && methodRow(sales, 'bank_transfer').label === 'Bank transfer', `by_payment_method "bank_transfer" ("${methodRow(sales, 'bank_transfer').label}"): +1 order, +${takaCents(deltaBank)}`)
    const dhaka = zoneRow(sales, 'inside_dhaka')
    const none = zoneRow(sales, null)
    log(dhaka.orders - zoneRow(base.sales, 'inside_dhaka').orders === 4 && cents(dhaka.gross) - cents(zoneRow(base.sales, 'inside_dhaka').gross) === cod && dhaka.name === 'Inside Dhaka', `by_delivery_zone "Inside Dhaka": +4 orders, +${takaCents(cents(dhaka.gross) - cents(zoneRow(base.sales, 'inside_dhaka').gross))}`)
    log(none.orders - zoneRow(base.sales, null).orders === 1 && cents(none.gross) - cents(zoneRow(base.sales, null).gross) === O.E.total && none.name === 'No zone (outside Bangladesh or a free-text address)', `by_delivery_zone null ("${none.name}"): +1 order (E, United States)`)
    const t = sales.totals
    const addsUp = (rows) => rows.reduce((n, row) => n + row.orders, 0) === t.orders && sum(rows, 'gross') === cents(t.gross) && sum(rows, 'refunds') === cents(t.refunds) && sum(rows, 'net') === cents(t.net)
    log(addsUp(sales.by_payment_method) && addsUp(sales.by_delivery_zone), `both breakdowns add up to the totals (${t.orders} orders, gross ${taka(t.gross)}, refunds ${taka(t.refunds)}, net ${taka(t.net)})`)
    const ordered = (rows) => rows.every((row, index) => index === 0 || cents(rows[index - 1].gross) >= cents(row.gross))
    log(ordered(sales.by_payment_method) && ordered(sales.by_delivery_zone), 'both are ordered by gross, largest first')

    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/reports?from=${today}&to=${today}&groupBy=day`, { waitUntil: 'networkidle' })
    await admin.getByRole('heading', { name: 'Sales and products', level: 1 }).waitFor()
    log(await visible(admin.getByText(/Dates in (UTC|\S+ time)\./)), `"Sales and products": "${squash(await admin.getByText(/Dates in/).first().innerText().catch(() => ''))}"`)
    const nav = admin.getByRole('navigation', { name: 'Admin' }).getByRole('list', { name: 'Reports' })
    const links = (await nav.getByRole('link').allInnerTexts()).map(squash)
    log(JSON.stringify(links) === JSON.stringify(['Sales and products', 'Money in', 'Cash on delivery', 'Courier payments']), `the Reports group in the sidebar: ${links.join(', ')}`)
    const byMethod = region(admin, 'By payment method')
    const byZone = region(admin, 'By delivery zone')
    await byMethod.waitFor()
    log(/Largest: /.test(await byMethod.locator('.chart__summary').innerText()) && (await byMethod.getByRole('img', { name: 'By payment method' }).count()) === 1, `"By payment method": bars with a text summary ("${squash(await byMethod.locator('.chart__summary').innerText()).slice(0, 90)}…")`)
    await openTable(admin, 'Sales by payment method')
    const codCells = await rowCells(byMethod, 'Cash on delivery')
    const codApi = methodRow(sales, 'cod')
    log(codCells?.[1] === count(codApi.orders) && codCells?.[2] === taka(codApi.gross) && codCells?.[4] === taka(codApi.net), `its table: "Cash on delivery" ${codCells?.slice(1).join(' | ')}`)
    const bankCells = await rowCells(byMethod, 'Bank transfer')
    log(bankCells?.[2] === taka(methodRow(sales, 'bank_transfer').gross), `"Bank transfer" ${bankCells?.slice(1).join(' | ')}`)
    await openTable(admin, 'Sales by delivery zone')
    const zoneCells = await rowCells(byZone, 'Inside Dhaka')
    const noneCells = await rowCells(byZone, 'No zone (outside Bangladesh or a free-text address)')
    log(zoneCells?.[1] === count(dhaka.orders) && zoneCells?.[2] === taka(dhaka.gross) && noneCells?.[1] === count(none.orders) && noneCells?.[2] === taka(none.gross), `"By delivery zone": Inside Dhaka ${zoneCells?.slice(1, 3).join(' | ')}, No zone ${noneCells?.slice(1, 3).join(' | ')}`)
    await admin.context().close()
  })

  // ---------- 4. Money in ----------
  await part('money in', async () => {
    const payments = (await report$('payments', { from: today, to: today, group_by: 'day' })).data
    const delta = (key) => cents(channel(payments, key).amount) - cents(channel(base.payments, key).amount)
    const deltaCount = (key) => channel(payments, key).count - channel(base.payments, key).count
    log(delta('cash:staff') === O.A.total && deltaCount('cash:staff') === 1 && channel(payments, 'cash:staff').label === 'Cash collected by staff', `channel cash:staff ("${channel(payments, 'cash:staff').label}"): +${takaCents(delta('cash:staff'))} (A), +1 payment`)
    log(delta('cash:steadfast') === O.B.total && deltaCount('cash:steadfast') === 1 && channel(payments, 'cash:steadfast').label === 'Cash collected by Steadfast', `channel cash:steadfast ("${channel(payments, 'cash:steadfast').label}"): +${takaCents(delta('cash:steadfast'))} (B)`)
    log(delta('other') === O.E.total && deltaCount('other') === 1, `channel other ("${channel(payments, 'other').label}"): +${takaCents(delta('other'))} (E, invoiced by staff)`)
    const t = payments.totals
    log(cents(t.cod_cash) - cents(base.payments.totals.cod_cash) === O.A.total + O.B.total, `totals.cod_cash +${takaCents(cents(t.cod_cash) - cents(base.payments.totals.cod_cash))} (A + B)`)
    const channelsSum = sum(payments.channels, 'amount')
    log(channelsSum === cents(t.received) && cents(t.online) + cents(t.cod_cash) + cents(t.other) === cents(t.received) && cents(t.received) - cents(t.refunds) === cents(t.net_received), `the channels add up: ${takaCents(channelsSum)} = received ${taka(t.received)} = online + cash + other; net ${taka(t.net_received)} = received − refunds`)
    const point = payments.series.find((row) => row.period === today)
    log(payments.series.length === 1 && point?.cod_cash === t.cod_cash && point?.online === t.online && point?.other === t.other && point?.net_received === t.net_received, `series for ${today} matches the totals`)

    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/reports/payments?from=${today}&to=${today}&groupBy=day`, { waitUntil: 'networkidle' })
    await admin.getByRole('heading', { name: 'Money in', level: 1 }).waitFor()
    const tiles = (await admin.locator('dl.stats .stat__label').allInnerTexts()).map(squash)
    log(['Net received', 'Received', 'Online', 'Cash on delivery', 'Refunds'].every((label) => tiles.includes(label)), `tiles: ${tiles.join(', ')}`)
    const channels = region(admin, 'By channel')
    await channels.waitFor()
    const staffCells = await rowCells(channels, 'Cash collected by staff')
    const steadfastCells = await rowCells(channels, 'Cash collected by Steadfast')
    const received = await channels.locator('tfoot tr').locator('th, td').allInnerTexts()
    log(staffCells?.[2] === taka(channel(payments, 'cash:staff').amount) && steadfastCells?.[2] === taka(channel(payments, 'cash:steadfast').amount) && squash(received[2]) === taka(t.received), `"By channel": staff ${staffCells?.[2]}, Steadfast ${steadfastCells?.[2]}, Received ${squash(received[2])}`)
    const chart = admin.getByRole('img', { name: 'Money received by day' })
    log((await chart.count()) === 1 && /Received ৳[\d,.]+: online ৳[\d,.]+, cash on delivery ৳[\d,.]+, other ৳[\d,.]+\./.test(squash(await admin.locator('#money-chart-summary').innerText().catch(() => ''))), `the stacked chart has a text summary ("${squash(await admin.locator('#money-chart-summary').innerText().catch(() => '')).slice(0, 110)}…")`)
    await openTable(admin, 'Money received by day')
    const dayCells = await rowCells(region(admin, 'Money received by day'), shortDay(today))
    log(dayCells?.[2] === taka(point?.cod_cash) && dayCells?.[5] === taka(point?.net_received), `"Show the numbers as a table": ${shortDay(today)} ${dayCells?.slice(1).join(' | ')}`)
    const csv = await download(admin, () => admin.getByRole('link', { name: 'Download money-in CSV' }).click())
    const row = csv.rows.find((line) => line[0] === today)
    log(csv.bom && csv.rows[0]?.join(',') === 'period,online,cod_cash,other,refunds,net_received' && csv.rows.length === 2 && row?.[2] === point?.cod_cash && row?.[5] === point?.net_received, `money-in CSV ${csv.name}: BOM ${csv.bom}, header ${csv.rows[0]?.join(',')}, ${today}: ${row?.join(',')}`)
    await axe(admin, 'Money in')
    await phone(admin, 'Money in')
    await admin.context().close()
  })

  // ---------- 5. Cash on delivery: balances, the period, still to collect ----------
  await part('cash on delivery', async () => {
    const cod = (await report$('cod', { from: today, to: today })).data
    const sfNow = balance(cod, 'steadfast')
    const sfBefore = balance(base.cod, 'steadfast')
    log(cents(sfNow.collected_all_time) - cents(sfBefore.collected_all_time) === O.B.total && cents(sfNow.fees_all_time) - cents(sfBefore.fees_all_time) === 6000 && sfNow.fees_reported === true, `Steadfast balance: collected +${takaCents(cents(sfNow.collected_all_time) - cents(sfBefore.collected_all_time))} (B), fees +${takaCents(cents(sfNow.fees_all_time) - cents(sfBefore.fees_all_time))} (reported per parcel)`)
    log(cents(sfNow.owed) - cents(sfBefore.owed) === O.B.total - 6000 && owedAddsUp(cod), `owed +${takaCents(cents(sfNow.owed) - cents(sfBefore.owed))} (B − fee); every courier's owed = collected − fees − payouts (${cod.balances.map((row) => `${row.carrier} ${row.owed}`).join(', ')})`)
    const sfPeriod = periodRow(cod, 'steadfast')
    const sfPeriodBefore = periodRow(base.cod, 'steadfast')
    const paPeriod = periodRow(cod, 'pathao')
    const paPeriodBefore = periodRow(base.cod, 'pathao')
    log(sfPeriod.shipped - sfPeriodBefore.shipped === 2 && sfPeriod.delivered - sfPeriodBefore.delivered === 1 && cents(sfPeriod.collected) - cents(sfPeriodBefore.collected) === O.B.total, `period, Steadfast: shipped +${sfPeriod.shipped - sfPeriodBefore.shipped} (B, C), delivered +${sfPeriod.delivered - sfPeriodBefore.delivered}, collected +${takaCents(cents(sfPeriod.collected) - cents(sfPeriodBefore.collected))}`)
    log(paPeriod.shipped - paPeriodBefore.shipped === 1 && paPeriod.returned - paPeriodBefore.returned === 1, `period, Pathao: shipped +${paPeriod.shipped - paPeriodBefore.shipped}, returned +${paPeriod.returned - paPeriodBefore.returned} (D)`)
    log(cents(cod.staff.collected) - cents(base.cod.staff.collected) === O.A.total, `staff.collected +${takaCents(cents(cod.staff.collected) - cents(base.cod.staff.collected))} (A)`)
    const dueC = cents((await orderOf(O.C.number))?.cod?.cod_due)
    O.C.due = dueC
    // D's parcel came back: it brings in no cash, so it is not "still to collect" (counted as returned instead).
    log(cod.outstanding.orders - base.cod.outstanding.orders === 1 && cents(cod.outstanding.amount) - cents(base.cod.outstanding.amount) === dueC, `outstanding: +1 order (C, not the returned D), +${takaCents(cents(cod.outstanding.amount) - cents(base.cod.outstanding.amount))}`)
    const pathaoListed = ((await admin$(`/reports/cod/outstanding?carrier=pathao&per_page=100`)).body?.data ?? []).some((row) => row.number === O.D.number)
    log(!pathaoListed, `the returned parcel D (${O.D.number}) is not in Still to collect`)
    const listed = await admin$(`/reports/cod/outstanding?carrier=steadfast&per_page=100`)
    const rowC = (listed.body?.data ?? []).find((row) => row.number === O.C.number)
    log(rowC?.carrier === 'steadfast' && rowC?.consignment_id === String(O.C.consignment) && rowC?.delivery_status === 'booked' && cents(rowC?.cod_due) === dueC && rowC?.days_since_shipped === 0 && !(listed.body?.data ?? []).some((row) => [O.A.number, O.B.number].includes(row.number)), `GET cod/outstanding?carrier=steadfast lists C (${rowC?.consignment_id}, ${rowC?.delivery_status}, ${rowC?.cod_due}, ${rowC?.days_since_shipped} days), not A or B`)
    const older = await admin$(`/reports/cod/outstanding?carrier=steadfast&older_than_days=7&per_page=100`)
    log(older.status === 200 && !(older.body?.data ?? []).some((row) => row.number === O.C.number), '…and not with older_than_days=7')

    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/reports/cod?from=${today}&to=${today}`, { waitUntil: 'networkidle' })
    await admin.getByRole('heading', { name: 'Cash on delivery', level: 1 }).waitFor()
    const card = admin.locator('.cash-card').filter({ has: admin.getByRole('heading', { name: 'Steadfast', exact: true }) })
    await card.waitFor()
    const cardText = squash(await card.innerText())
    const owedText = cents(sfNow.owed) > 0 ? `Steadfast owes you ${taka(sfNow.owed)}` : cents(sfNow.owed) === 0 ? 'Steadfast owes you nothing' : sfNow.note === 'fees_more_than_collected' ? `You owe Steadfast ${takaCents(-cents(sfNow.owed))}` : 'Paid more than recorded — check the payments'
    log(cardText.includes(owedText) && cardText.includes(`Collected ${taka(sfNow.collected_all_time)}`) && cardText.includes(`Fees ${taka(sfNow.fees_all_time)}`) && cardText.includes(`Paid to you ${taka(sfNow.payouts_all_time)}`), `the Steadfast card: "${owedText}", Collected ${taka(sfNow.collected_all_time)}, Fees ${taka(sfNow.fees_all_time)}, Paid to you ${taka(sfNow.payouts_all_time)}`)
    const cards = await admin.locator('.cash-card').count()
    const unreported = cod.balances.filter((row) => row.fees_all_time === null)
    let feesShown = true
    for (const row of unreported) if (!(await admin.locator('.cash-card').filter({ has: admin.getByRole('heading', { name: row.label, exact: true }) }).getByText('Fees not reported').isVisible())) feesShown = false
    log(cards === cod.balances.length && feesShown, `${cards} courier cards (one per balance); "Fees not reported" on ${unreported.length ? unreported.map((row) => row.label).join(', ') : 'none (every courier reported fees)'}`)
    const period = region(admin, 'In this period, by courier')
    const sfCells = await rowCells(period, 'Steadfast')
    const paCells = await rowCells(period, 'Pathao')
    log(sfCells?.[1] === count(sfPeriod.shipped) && sfCells?.[2] === count(sfPeriod.delivered) && sfCells?.[5] === taka(sfPeriod.collected) && paCells?.[3] === count(paPeriod.returned) && paCells?.[6] === (paPeriod.fees === null ? 'Not reported' : taka(paPeriod.fees)), `period table: Steadfast ${sfCells?.slice(1).join(' | ')}; Pathao ${paCells?.slice(1).join(' | ')}`)
    const staffTile = admin.locator('.stat').filter({ has: admin.locator('dt', { hasText: 'Collected by staff' }) })
    log(await visible(staffTile), `tile "Collected by staff": ${squash(await staffTile.locator('.stat__value').innerText().catch(() => ''))}`)

    // Balances CSV.
    const balances = await download(admin, () => admin.getByRole('link', { name: 'Download balances CSV' }).click())
    const sfLine = balances.rows.find((line) => line[0] === 'steadfast')
    log(balances.bom && balances.rows[0]?.join(',') === 'carrier,courier,collected,fees,paid_to_you,owed,last_payout_on,note' && balances.rows.length === cod.balances.length + 1 && sfLine?.[2] === sfNow.collected_all_time && sfLine?.[3] === sfNow.fees_all_time && sfLine?.[5] === sfNow.owed, `balances CSV ${balances.name}: BOM ${balances.bom}, ${balances.rows.length - 1} rows, steadfast ${sfLine?.join(',')}`)

    // Still to collect: filter by courier, find C, the link to its order; older than 7 days hides it.
    const outstanding = region(admin, 'Still to collect')
    const filters = admin.getByRole('group', { name: 'Filter the orders still to collect' })
    await filters.getByLabel('Courier').selectOption({ label: 'Steadfast' })
    await admin.waitForLoadState('networkidle')
    const link = outstanding.getByRole('link', { name: O.C.number, exact: true })
    for (let pages = 0; pages < 10 && !(await visible(link, 3000)); pages++) {
      const next = outstanding.getByRole('button', { name: 'Next' })
      if (!(await next.isEnabled().catch(() => false))) break
      await next.click()
      await admin.waitForLoadState('networkidle')
    }
    const row = outstanding.getByRole('row').filter({ has: admin.getByRole('link', { name: O.C.number, exact: true }) })
    const rowText = squash(await row.innerText().catch(() => ''))
    log((await link.getAttribute('href')) === `/admin/orders/${O.C.number}` && rowText.includes('Steadfast') && rowText.includes(String(O.C.consignment)) && rowText.includes('Booked') && rowText.includes(takaCents(dueC)), `Still to collect (Steadfast): "${rowText}" links to /admin/orders/${O.C.number}`)
    const list = await download(admin, () => outstanding.getByRole('link', { name: 'Download list CSV' }).click())
    const csvC = list.rows.find((line) => line[0] === O.C.number)
    log(list.bom && list.rows[0]?.join(',') === 'number,placed_at,shipped_at,carrier,consignment_id,delivery_status,cod_due,days_since_shipped' && csvC?.[3] === 'steadfast' && cents(csvC?.[6]) === dueC && list.rows.slice(1).every((line) => line[3] === 'steadfast'), `list CSV ${list.name} (Steadfast only): BOM ${list.bom}, ${list.rows.length - 1} rows, C: ${csvC?.join(',')}`)
    await filters.getByLabel('Shipped').selectOption({ label: 'Older than 7 days' })
    await admin.waitForLoadState('networkidle')
    await sleep(300)
    log((await outstanding.getByRole('link', { name: O.C.number, exact: true }).count()) === 0, '"Older than 7 days": C (shipped today) is not listed')
    await filters.getByLabel('Shipped').selectOption({ label: 'Any age' })
    await axe(admin, 'Cash on delivery')
    await phone(admin, 'Cash on delivery')

    // The link opens the order; staff confirm the cash Steadfast's rider collected for C.
    await admin.goto(`${BASE}/admin/orders/${O.C.number}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Mark as delivered' }).click()
    const dialog = admin.getByRole('dialog', { name: `Mark order ${O.C.number} as delivered?` })
    await dialog.getByLabel('Amount collected (BDT)').waitFor()
    await dialog.getByRole('button', { name: 'Mark as delivered' }).click()
    log(await visible(admin.getByText(/collected and the order is paid\./)), `C: "Mark as delivered" by staff → "… collected and the order is paid."`)
    const kindsC = invoiceKinds(O.C.number)
    log(kindsC.length === 1 && kindsC[0].kind === 'cod_collection' && kindsC[0].collected_via === 'steadfast', `C's invoice: ${JSON.stringify(kindsC)}: recorded by staff on a Steadfast parcel, so the cash is with Steadfast`)
    const after = (await report$('cod', { from: today, to: today })).data
    const payments = (await report$('payments', { from: today, to: today })).data
    const stillListed = ((await admin$(`/reports/cod/outstanding?carrier=steadfast&per_page=100`)).body?.data ?? []).some((line) => line.number === O.C.number)
    log(cents(balance(after, 'steadfast').collected_all_time) - cents(sfNow.collected_all_time) === O.C.total && cents(after.staff.collected) === cents(cod.staff.collected) && cents(channel(payments, 'cash:steadfast').amount) - cents(channel(base.payments, 'cash:steadfast').amount) === O.B.total + O.C.total && cents(channel(payments, 'cash:staff').amount) - cents(channel(base.payments, 'cash:staff').amount) === O.A.total && !stillListed, `…Steadfast collected +${takaCents(O.C.total)}, staff cash unchanged, Money in cash:steadfast = B + C, C no longer in Still to collect`)
    await admin.context().close()
  })

  // ---------- 6. Courier payments: record, duplicate, edit, delete ----------
  const X = 777.25
  const firstPayout = { id: null }
  await part('courier payments', async () => {
    const before = balance((await report$('cod', { from: today, to: today })).data, 'steadfast')
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/reports/courier-payments`, { waitUntil: 'networkidle' })
    await admin.getByRole('heading', { name: 'Courier payments', level: 1 }).waitFor()
    await admin.getByRole('button', { name: 'Record a payment' }).click()
    let dialog = admin.getByRole('dialog', { name: 'Record a courier payment' })
    await dialog.waitFor()
    log((await dialog.getByLabel('Courier').locator('option').allInnerTexts()).map(squash).join(', ') === 'Choose a courier, Steadfast, Pathao, RedX, Paperfly, Sundarban Courier', `the dialog's couriers: ${(await dialog.getByLabel('Courier').locator('option').allInnerTexts()).map(squash).join(', ')}`)
    log((await dialog.getByLabel('Date received').inputValue()) === today, `"Date received" starts at the store's today (${await dialog.getByLabel('Date received').inputValue()})`)
    await dialog.getByRole('button', { name: 'Record payment' }).click()
    log((await visible(dialog.getByText('Choose the courier that paid you.'))) && (await visible(dialog.getByText('Enter the amount received, more than 0, with at most 2 decimals.'))), 'empty form: "Choose the courier that paid you." and the amount error')
    await dialog.getByLabel('Courier').selectOption({ label: 'Steadfast' })
    await dialog.getByLabel(/^Amount received/).fill(String(X))
    await dialog.getByLabel('Reference (optional)').fill(REF(1))
    await dialog.getByLabel('Note (optional)').fill('Weekly payment (e2e)')
    await axe(admin, 'the Record a courier payment dialog')
    await phone(admin, 'the Record a courier payment dialog')
    await dialog.getByRole('button', { name: 'Record payment' }).click()
    const recorded = `Payment of ${taka(X)} from Steadfast recorded.`
    log(await visible(admin.getByRole('status').getByText(recorded)), `announced: "${recorded}"`)
    const mine = await suitePayouts()
    const one = mine.find((payout) => payout.reference === REF(1))
    if (one) {
      made.payouts.add(one.id)
      firstPayout.id = one.id
    }
    log(one?.carrier === 'steadfast' && one?.amount === X.toFixed(2) && one?.fees === null && one?.received_on === today && one?.currency === 'BDT' && one?.admin_name === ADMIN_USER.name && one?.note === 'Weekly payment (e2e)', `saved: ${JSON.stringify(one && { carrier: one.carrier, amount: one.amount, fees: one.fees, received_on: one.received_on, admin: one.admin_name })}`)
    const afterOne = balance((await report$('cod', { from: today, to: today })).data, 'steadfast')
    log(cents(before.owed) - cents(afterOne.owed) === cents(X) && afterOne.last_payout_on === today && cents(afterOne.payouts_all_time) - cents(before.payouts_all_time) === cents(X), `the Steadfast balance goes down by ${taka(X)} (owed ${taka(before.owed)} → ${taka(afterOne.owed)}), last payment ${afterOne.last_payout_on}`)
    const listRow = admin.getByRole('row').filter({ hasText: REF(1) })
    log(squash(await listRow.innerText().catch(() => '')).includes(`${dayWords(today)} Steadfast`) && squash(await listRow.innerText()).includes(taka(X)) && squash(await listRow.innerText()).includes(ADMIN_USER.name), `the list: "${squash(await listRow.innerText().catch(() => ''))}"`)

    // The same courier, amount and date again: the duplicate warning, then "Record it anyway".
    await admin.getByRole('button', { name: 'Record a payment' }).click()
    dialog = admin.getByRole('dialog', { name: 'Record a courier payment' })
    await dialog.getByLabel('Courier').selectOption({ label: 'Steadfast' })
    await dialog.getByLabel(/^Amount received/).fill(String(X))
    await dialog.getByLabel('Reference (optional)').fill(REF(2))
    await dialog.getByRole('button', { name: 'Record payment' }).click()
    const duplicate = admin.getByRole('dialog', { name: 'This payment may already be recorded' })
    await duplicate.waitFor()
    const duplicateText = squash(await duplicate.innerText())
    log(duplicateText.includes(`A payment of ${taka(X)} from Steadfast received on ${dayWords(today)} is already recorded (reference ${REF(1)}).`) && (await visible(duplicate.getByRole('button', { name: 'Record it anyway' }))), `the duplicate step: "${duplicateText.slice(0, 160)}…"`)
    log((await suitePayouts()).length === 1, 'nothing is saved before confirming')
    await axe(admin, 'the duplicate warning')
    await duplicate.getByRole('button', { name: 'Record it anyway' }).click()
    await duplicate.waitFor({ state: 'hidden' })
    let two = null
    for (let tries = 0; tries < 20 && !two; tries++) {
      two = (await suitePayouts()).find((payout) => payout.reference === REF(2)) ?? null
      if (!two) await sleep(250)
    }
    log(await visible(admin.getByRole('status').getByText(recorded)), `"Record it anyway" → "${recorded}"`)
    if (two) made.payouts.add(two.id)
    log(Boolean(two) && two.amount === X.toFixed(2), `a second payment of ${taka(X)} is recorded (#${two?.id})`)

    // Both hops keep duplicate_of: the API (409 duplicate_of) and the sign-in service (409 duplicateOf).
    const raw = await admin$('/courier-payouts', { method: 'POST', body: { carrier: 'steadfast', amount: X, received_on: today } })
    log(raw.status === 409 && [firstPayout.id, two?.id].includes(raw.body?.duplicate_of?.id) && raw.body?.duplicate_of?.amount === X.toFixed(2), `the API: 409 with duplicate_of #${raw.body?.duplicate_of?.id} ("${raw.body?.message}")`)
    const viaService = await admin.evaluate(
      async ([amount, day]) => {
        const response = await fetch('/api/admin/courier-payouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carrier: 'steadfast', amount, receivedOn: day }) })
        return { status: response.status, body: await response.json().catch(() => ({})) }
      },
      [X, today],
    )
    log(viaService.status === 409 && [firstPayout.id, two?.id].includes(viaService.body?.duplicateOf?.id) && viaService.body?.duplicateOf?.receivedOn === today, `the sign-in service: 409 with duplicateOf #${viaService.body?.duplicateOf?.id} (receivedOn ${viaService.body?.duplicateOf?.receivedOn})`)
    log((await suitePayouts()).length === 2, 'neither unconfirmed repeat was saved')

    // Edit the second one into more than Steadfast collected: a negative balance, said plainly.
    const now = balance((await report$('cod', { from: today, to: today })).data, 'steadfast')
    const big = (cents(now.owed) + cents(X) + 50_000) / 100 // what Steadfast owed with only the first payment, plus ৳500
    const rowTwo = admin.getByRole('row').filter({ hasText: REF(2) })
    await rowTwo.getByRole('button', { name: `Edit the payment of ${taka(X)} from Steadfast on ${dayWords(today)}` }).click()
    dialog = admin.getByRole('dialog', { name: 'Edit courier payment' })
    await dialog.waitFor()
    log((await dialog.getByLabel('Reference (optional)').inputValue()) === REF(2) && Number(await dialog.getByLabel(/^Amount received/).inputValue()) === X, 'Edit opens with the saved payment')
    await dialog.getByLabel(/^Amount received/).fill(String(big))
    await dialog.getByLabel(/^Fees kept/).fill('15')
    await dialog.getByRole('button', { name: 'Save payment' }).click()
    const savedText = `Payment of ${taka(big)} from Steadfast saved.`
    log(await visible(admin.getByRole('status').getByText(savedText)), `announced: "${savedText}"`)
    const edited = (await suitePayouts()).find((payout) => payout.id === two?.id)
    const negative = balance((await report$('cod', { from: today, to: today })).data, 'steadfast')
    const expectedOwed = cents(now.owed) + cents(X) - cents(big) - 1500
    log(edited?.amount === big.toFixed(2) && edited?.fees === '15.00' && cents(negative.owed) === expectedOwed && negative.note === 'paid_more_than_recorded' && cents(negative.fees_all_time) - cents(now.fees_all_time) === 1500, `saved ${edited?.amount} with fees ${edited?.fees}: Steadfast owed ${taka(negative.owed)} (fees typed in count), note "${negative.note}"`)
    const audit = (await admin$(`/audit?subject_type=courier_payout&subject_id=${two?.id}&per_page=50`)).body?.data ?? []
    const updatedEntry = audit.find((entry) => entry.action === 'courier_payout.updated')
    log(['courier_payout.created', 'courier_payout.updated'].every((action) => audit.some((entry) => entry.action === action)) && JSON.stringify(updatedEntry ?? {}).includes(big.toFixed(2)), `the audit log of payment #${two?.id}: ${audit.map((entry) => entry.action).join(', ')} (the change with the new amount)`)
    await admin.goto(`${BASE}/admin/reports/cod?from=${today}&to=${today}`, { waitUntil: 'networkidle' })
    const card = admin.locator('.cash-card').filter({ has: admin.getByRole('heading', { name: 'Steadfast', exact: true }) })
    await card.waitFor()
    const cardText = squash(await card.innerText())
    log(cardText.includes('Paid more than recorded — check the payments') && cardText.includes(`Steadfast has paid you ${takaCents(-expectedOwed)} more than the cash recorded for it.`) && cardText.includes(`Last payment ${dayWords(today)}`), `the Steadfast card: "Paid more than recorded — check the payments" (${takaCents(-expectedOwed)} more)`)
    await axe(admin, 'Cash on delivery with a negative balance')

    // Delete it: the balance goes back up.
    await admin.goto(`${BASE}/admin/reports/courier-payments?carrier=steadfast`, { waitUntil: 'networkidle' })
    log((await admin.getByRole('row').filter({ hasText: REF(1) }).count()) === 1, '"See Steadfast payments" filter (?carrier=steadfast) lists the payments')
    await admin.getByRole('row').filter({ hasText: REF(2) }).getByRole('button', { name: `Delete the payment of ${taka(big)} from Steadfast on ${dayWords(today)}` }).click()
    const confirm = admin.getByRole('dialog', { name: 'Delete this payment?' })
    log(/the courier's balance goes back up by that amount/.test(await confirm.innerText()), '"Delete this payment?" says the balance goes back up')
    await confirm.getByRole('button', { name: 'Delete payment' }).click()
    const deletedText = `Payment of ${taka(big)} from Steadfast deleted.`
    log(await visible(admin.getByRole('status').getByText(deletedText)), `announced: "${deletedText}"`)
    const back = balance((await report$('cod', { from: today, to: today })).data, 'steadfast')
    const left = await suitePayouts()
    if (left.every((payout) => payout.id !== two?.id) && two) made.payouts.delete(two.id)
    log(cents(back.owed) === cents(afterOne.owed) && back.note === null && left.length === 1 && left[0].id === firstPayout.id, `after the delete Steadfast owes ${taka(back.owed)} again (as after the first payment); the deleted one no longer counts`)
    await axe(admin, 'Courier payments')
    await phone(admin, 'Courier payments')
    await admin.context().close()
  })

  // ---------- 7. A Viewer sees, but can't record ----------
  await part('viewer', async () => {
    const role = ((await admin$('/roles')).body?.data ?? []).find((item) => item.name === 'Viewer')
    const created = await admin$('/admins', { method: 'POST', body: { name: 'Vera Reports', email: viewer.email, password: viewer.password, role_id: role?.id } })
    made.viewerId = created.body?.data?.id ?? null
    log(created.status === 201 && Boolean(made.viewerId), `a Viewer admin (${viewer.email}, ${created.status})`)
    if (!made.viewerId) throw new Error('no Viewer admin')
    const view = await adminPage(viewer)
    const links = (await view.getByRole('navigation', { name: 'Admin' }).getByRole('list', { name: 'Reports' }).getByRole('link').allInnerTexts()).map(squash)
    log(links.length === 4, `the Viewer has the Reports group (${links.join(', ')})`)
    await view.goto(`${BASE}/admin/reports/payments?from=${today}&to=${today}`, { waitUntil: 'networkidle' })
    log(await visible(region(view, 'By channel')), 'the Viewer opens Money in')
    await view.goto(`${BASE}/admin/reports/cod?from=${today}&to=${today}`, { waitUntil: 'networkidle' })
    log(await visible(view.locator('.cash-card').first()), 'the Viewer opens Cash on delivery')
    await view.goto(`${BASE}/admin/reports/courier-payments`, { waitUntil: 'networkidle' })
    await view.getByRole('heading', { name: 'Courier payments', level: 1 }).waitFor()
    log((await visible(view.getByText('Your role can see courier payments but not record them.'))) && (await view.getByRole('button', { name: 'Record a payment' }).count()) === 0 && (await view.getByRole('row').filter({ hasText: REF(1) }).count()) === 1 && (await view.getByRole('button', { name: /^(Edit|Delete) the payment/ }).count()) === 0, 'the Viewer sees the payments, "Your role can see courier payments but not record them.", no Record / Edit / Delete')
    const refused = await view.evaluate(
      async ([day, id]) => {
        const post = await fetch('/api/admin/courier-payouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carrier: 'steadfast', amount: 10, receivedOn: day, confirmDuplicate: true }) })
        const remove = await fetch(`/api/admin/courier-payouts/${id}`, { method: 'DELETE' })
        return { post: post.status, body: await post.json().catch(() => ({})), remove: remove.status }
      },
      [today, firstPayout.id],
    )
    log(refused.post === 403 && refused.body.code === 'permission_denied' && refused.body.permission === 'cash.manage' && refused.remove === 403, `the API refuses the Viewer: POST ${refused.post} ${refused.body.code} (${refused.body.permission}), DELETE ${refused.remove}`)
    log((await suitePayouts()).length === 1, 'nothing changed')
    await view.context().close()
  })

  // ---------- 8. The time zone: Asia/Dhaka moves a late-evening UTC order to the next day ----------
  await part('time zone', async () => {
    const DAY = '2021-02-17' // long before any order: nothing else falls on these days
    const span = { from: plusDays(DAY, -1), to: plusDays(DAY, 2), group_by: 'day' }
    const ordersOn = (sales, day) => sales.series.find((row) => row.period === day)?.orders ?? null
    const empty = (await report$('sales', span)).data
    log(empty.series.every((row) => row.orders === 0), `no orders on ${span.from} … ${span.to} before the check`)
    made.backdated = { number: O.E.number, placedAt: tinker(`echo App\\Models\\Order::where('number', '${O.E.number}')->first()->getRawOriginal('placed_at');`).split('\n').pop().trim() }
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(made.backdated.placedAt)) throw new Error(`could not read E's placed_at (${made.backdated.placedAt})`)
    tinker(`App\\Models\\Order::where('number', '${O.E.number}')->update(['placed_at' => '${DAY} 20:00:00']); echo 'ok';`)
    const utc = await report$('sales', span)
    log(utc.meta.timezone === 'UTC' ? ordersOn(utc.data, DAY) === 1 && ordersOn(utc.data, plusDays(DAY, 1)) === 0 : true, `E placed at ${DAY} 20:00 UTC: with ${utc.meta.timezone}, ${DAY} has ${ordersOn(utc.data, DAY)} order, ${plusDays(DAY, 1)} has ${ordersOn(utc.data, plusDays(DAY, 1))}`)

    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const general = admin.getByRole('form', { name: 'General' })
    const zone = general.getByLabel('Time zone')
    await zone.waitFor()
    const first = (await zone.locator('option').allInnerTexts()).slice(0, 2).map(squash)
    log(JSON.stringify(first) === JSON.stringify(['Asia/Dhaka (Bangladesh, UTC+6)', 'UTC (no offset)']), `Settings → General → Time zone offers ${first.join(' and ')} first`)
    await zone.selectOption('Asia/Dhaka')
    await general.getByRole('button', { name: 'Save general' }).click()
    log(await visible(admin.getByText('General saved.')), '"Save general" → "General saved."')
    const stored = (await admin$('/settings')).body?.data?.general?.store_timezone
    const dhaka = await report$('sales', span)
    log(stored === 'Asia/Dhaka' && dhaka.meta.timezone === 'Asia/Dhaka', `saved: store_timezone ${stored}; the reports answer in ${dhaka.meta.timezone}`)
    log(ordersOn(dhaka.data, DAY) === 0 && ordersOn(dhaka.data, plusDays(DAY, 1)) === 1, `with Asia/Dhaka, E (02:00 on ${plusDays(DAY, 1)} in Dhaka) is on ${plusDays(DAY, 1)}: ${DAY} ${ordersOn(dhaka.data, DAY)}, ${plusDays(DAY, 1)} ${ordersOn(dhaka.data, plusDays(DAY, 1))}`)
    await admin.goto(`${BASE}/admin/reports?from=${span.from}&to=${span.to}&groupBy=day`, { waitUntil: 'networkidle' })
    log(await visible(admin.getByText(/Dates in Asia\/Dhaka time\./)), 'Sales and products: "Dates in Asia/Dhaka time."')
    const table = await openTable(admin, 'Sales by day')
    const moved = await rowCells(table, shortDay(plusDays(DAY, 1)))
    const before = await rowCells(table, shortDay(DAY))
    log(moved?.[1] === '1' && before?.[1] === '0' && moved?.[2] === takaCents(O.E.total), `the page's table: ${shortDay(plusDays(DAY, 1))} ${moved?.slice(1, 3).join(' | ')}, ${shortDay(DAY)} ${before?.slice(1, 3).join(' | ')}`)
    await admin.context().close()

    // Put the setting back now (cleanup checks again): the row is removed if it wasn't stored before.
    restoreSettingRows(['store_timezone'])
    const back = await report$('sales', span)
    log(back.meta.timezone === (JSON.parse(saved.rows.store_timezone ?? '"UTC"') || 'UTC'), `the time zone is put back (${back.meta.timezone}${saved.rows.store_timezone === undefined ? ', the row removed: it was never stored' : ''})`)
    restorePlacedAt()
    const restored = tinker(`echo App\\Models\\Order::where('number', '${O.E.number}')->first()->getRawOriginal('placed_at');`).split('\n').pop().trim()
    log(restored === made.backdated?.placedAt || made.backdated === null, `E's placed-at time is put back (${restored})`)
  })
}

// ---------------------------------------------------------------- Putting things back
/** Settings rows as read at the start: changed values written back, rows that didn't exist removed. `only`: just these keys. */
function restoreSettingRows(only = null) {
  if (!saved.rows) return []
  const now = settingsRows()
  const keys = only ?? [...new Set([...Object.keys(now), ...Object.keys(saved.rows)])]
  const added = keys.filter((key) => key in now && !(key in saved.rows))
  const changed = keys.filter((key) => key in now && key in saved.rows && now[key] !== saved.rows[key])
  const missing = keys.filter((key) => !(key in now) && key in saved.rows)
  if (added.length + changed.length + missing.length === 0) return []
  const values = Object.fromEntries([...changed, ...missing].map((key) => [key, saved.rows[key]]))
  tinker(
    `$added = json_decode(${php(JSON.stringify(added))}, true); $values = json_decode(${php(JSON.stringify(values))}, true);` +
      " DB::table('settings')->whereIn('key', $added)->delete();" +
      " foreach ($values as $key => $value) { DB::table('settings')->updateOrInsert(['key' => $key], ['value' => $value, 'updated_at' => now()]); }" +
      " Cache::forget('buynest.settings'); echo 'ok';",
  )
  return [...added.map((key) => `${key} removed`), ...changed.map((key) => `${key} put back`), ...missing.map((key) => `${key} restored`)]
}
function restorePlacedAt() {
  if (!made.backdated) return
  tinker(`App\\Models\\Order::where('number', '${made.backdated.number}')->update(['placed_at' => '${made.backdated.placedAt}']); echo 'ok';`)
  const now = tinker(`echo App\\Models\\Order::where('number', '${made.backdated.number}')->first()->getRawOriginal('placed_at');`).split('\n').pop().trim()
  if (now !== made.backdated.placedAt) throw new Error(`placed_at is ${now}, not ${made.backdated.placedAt}`)
  made.backdated = null
}

async function cleanup() {
  if (!owner || cleaned) return
  cleaned = true
  const problems = []
  const fixed = []
  const attempt = async (name, body) => {
    try {
      await body()
    } catch (error) {
      problems.push(`${name}: ${error.message.split('\n')[0]}`)
    }
  }
  await attempt('courier payments', async () => {
    // This run's, and any an interrupted earlier run left (same reference prefix).
    const ids = new Set([...made.payouts, ...(await suitePayouts()).map((payout) => payout.id)])
    for (const id of ids) {
      const answer = await admin$(`/courier-payouts/${id}`, { method: 'DELETE' })
      if (answer.status !== 204 && answer.status !== 404) throw new Error(`DELETE courier-payouts/${id} answered ${answer.status}`)
    }
  })
  await attempt("E's placed-at time", () => restorePlacedAt())
  await attempt('settings', () => {
    fixed.push(...restoreSettingRows())
  })
  await attempt('courier settings', async () => {
    if (!saved.courierSettings) return
    const now = (await admin$('/couriers')).body?.settings
    if (JSON.stringify(now) === JSON.stringify(saved.courierSettings)) return
    const answer = await admin$('/couriers/settings', { method: 'PUT', body: saved.courierSettings })
    if (answer.status !== 200) throw new Error(`PUT couriers/settings answered ${answer.status}`)
  })
  const numbers = [...made.orders]
  await attempt('the throwaway customer', async () => {
    if (!made.customerId) return
    // Open orders of the customer block deleting it: unpaid ones are cancelled, paid ones moved on to delivered.
    // (D is a guest order: it stays shipped with its returned parcel.)
    for (const number of numbers) {
      const order = await orderOf(number)
      if (!order || order.email === guestEmail) continue
      if (order.status === 'pending_payment' || (order.status === 'processing' && order.payment_status !== 'paid')) await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
      else if (order.status === 'processing') {
        await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'shipped', notify_customer: false } })
        await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'delivered', notify_customer: false } })
      } else if (order.status === 'shipped') await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'delivered', notify_customer: false } })
    }
    const deleted = await admin$(`/customers/${made.customerId}`, { method: 'DELETE' })
    if (deleted.status !== 204) throw new Error(`DELETE customer answered ${deleted.status} ${JSON.stringify(deleted.body?.errors ?? deleted.body?.message)}`)
  })
  await attempt('products', async () => {
    for (const id of made.products) {
      await admin$(`/products/${id}`, { method: 'PATCH', body: { status: 'draft' } })
      await admin$(`/products/${id}`, { method: 'DELETE' })
    }
  })
  await attempt('the Viewer', async () => {
    if (!made.viewerId) return
    const answer = await admin$(`/admins/${made.viewerId}`, { method: 'PATCH', body: { is_active: false } })
    if (answer.status !== 200) throw new Error(`PATCH admins/${made.viewerId} answered ${answer.status}`)
  })
  await attempt('notifications and courier caches', () => {
    const links = numbers.map((number) => `'/orders/${number}'`).join(',')
    tinker(
      (numbers.length
        ? `$ids = App\\Models\\AdminNotification::where('type', 'courier_update')->whereIn('link', [${links}])->pluck('id'); DB::table('admin_notification_reads')->whereIn('notification_id', $ids)->delete(); App\\Models\\AdminNotification::whereIn('id', $ids)->delete();`
        : '') + " Cache::forget('couriers.pathao.token'); Cache::forget('couriers.steadfast.balance'); echo 'ok';",
    )
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  // What is left, read back.
  const left = []
  const payoutsLeft = await suitePayouts().catch(() => [])
  if (payoutsLeft.length) left.push(`${payoutsLeft.length} courier payments`)
  const rowsNow = (() => {
    try {
      return settingsRows()
    } catch {
      return null
    }
  })()
  const settingsDiff = rowsNow && saved.rows ? [...new Set([...Object.keys(rowsNow), ...Object.keys(saved.rows)])].filter((key) => rowsNow[key] !== saved.rows[key]) : ['unknown']
  if (settingsDiff.length) left.push(`settings ${settingsDiff.join(', ')}`)
  const couriersNow = (await admin$('/couriers')).body?.settings
  if (saved.courierSettings && JSON.stringify(couriersNow) !== JSON.stringify(saved.courierSettings)) left.push(`courier settings ${JSON.stringify(couriersNow)}`)
  if (made.backdated) left.push(`${made.backdated.number} placed_at`)
  const leftCustomer = ((await admin$(`/customers?search=${encodeURIComponent(customer.email)}`)).body?.data ?? []).length
  if (leftCustomer) left.push(`${leftCustomer} customer`)
  const leftProducts = ((await admin$(`/products?search=${encodeURIComponent(run)}`)).body?.data ?? []).length
  if (leftProducts) left.push(`${leftProducts} products`)
  if (made.viewerId && (await admin$(`/admins/${made.viewerId}`)).body?.data?.is_active !== false) left.push('the Viewer is still active')
  const openCustomerOrders = []
  for (const number of numbers) {
    const order = await orderOf(number)
    if (order && order.email !== guestEmail && ['pending_payment', 'processing', 'shipped'].includes(order.status)) openCustomerOrders.push(number)
  }
  if (openCustomerOrders.length) left.push(`open orders ${openCustomerOrders.join(', ')}`)
  let notes = 0
  try {
    notes = numbers.length ? Number(tinker(`echo App\\Models\\AdminNotification::where('type', 'courier_update')->whereIn('link', [${numbers.map((number) => `'/orders/${number}'`).join(',')}])->count();`).split('\n').pop()) : 0
  } catch {
    notes = -1
  }
  if (notes !== 0) left.push(`${notes} courier notifications`)
  log(
    problems.length === 0 && left.length === 0,
    `cleanup: courier payments deleted, settings rows as at the start${fixed.length ? ` (${fixed.join(', ')})` : ''}, courier settings unchanged, E's placed-at time put back, the throwaway customer and products removed, the Viewer deactivated, courier notifications and the Pathao token cleared, carts and stock put back (orders ${numbers.join(', ')} stay)${problems.length || left.length ? ` — left: ${[...problems, ...left].join('; ')}` : ''}`,
  )
}
