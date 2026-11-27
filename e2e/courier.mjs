// Phase 18, end to end in a real browser: courier bookings with Steadfast and Pathao (docs/backend/PHASE18_CONTRACT.md).
// Nothing reaches a real courier.
//
// The suite starts its own servers and stops them at the end (also on failure and Ctrl+C), like taka.mjs:
//   - a stand-in for Steadfast's merchant API on http://127.0.0.1:12151/api/v1 (create_order, status_by_cid, get_balance:
//     what SteadfastGateway calls, with the Api-Key / Secret-Key headers checked), recording every request
//   - a stand-in for Pathao's merchant API on http://127.0.0.1:12152 (issue-token, city / zone / area lists, orders,
//     order info, with the Bearer token checked: an unknown token gets a 401 like Pathao's), recording every request
//   - a second Laravel API on :8014 with BUYNEST_CURRENCY=BDT and both couriers set up through the process environment
//     (STEADFAST_*, PATHAO_* with PATHAO_MODE=sandbox, the API URLs = the stand-ins), which wins over backend/.env, so the
//     usual API on :8000 stays as it is (no courier set up)
//   - a second storefront dev server on :5184 pointed at it (BUYNEST_LARAVEL_URL); the admin comes through it at /admin
// Both APIs share the dev database. No .env file is changed. The couriers' webhooks are posted by the suite straight to
// the API on :8014, signed like the couriers do (Bearer token / X-PATHAO-Signature).
//
// Checks: Settings → Couriers (Set up, Sandbox, webhook URLs, Steadfast balance, booking defaults saved); a cash on
// delivery order placed at checkout with a Bangladesh address, booked with Steadfast from the order page (a refusal
// first: the courier's own text, nothing saved; then the booking: the body Steadfast got, the order shipped, the parcel
// card); a second booking refused; Pathao booked with City → Zone → Area (pre-matched city and zone, changed by hand) and
// its webhooks (integration check, wrong secret, picked up, delivered with the cash); Steadfast webhooks (missing and
// wrong token refused, delivered → order delivered, invoiced and paid, collected amount, "by Steadfast" in the history,
// the same webhook twice changes nothing); the customer's tracker in English and Bangla and the order list label;
// bulk "Book with Steadfast" with one success and one refusal; the Delivery progress filter and column; "Refresh
// status"; buynest:couriers:sync --dry-run; axe and 390px on the dialog, the parcel card and the tracker.
//
// Left behind on purpose: orders A, B, C (delivered and paid by the couriers' reports), their shipments, timelines,
// invoices, audit entries and emails (like the other suites). Put back or removed: Settings → Checkout default country
// (set to Bangladesh for the run, for the Division → District → Area form) and the courier settings (as read at
// the start), the orders grid column preference of the demo Owner, order D (refused by the stand-in: cancelled), the
// throwaway customer (deleted), courier notifications of the test orders, the Pathao token / places and Steadfast
// balance cached by the suite's API (forgotten, so no stand-in data outlives the run), saved carts, stock.
import { spawn, spawnSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'

const STEADFAST_PORT = 12151
const PATHAO_PORT = 12152
const API_PORT = 8014
const STORE_PORT = 5184
const PORTS = [STEADFAST_PORT, PATHAO_PORT, API_PORT, STORE_PORT]
const API = `http://127.0.0.1:${API_PORT}`
const STORE = `http://localhost:${STORE_PORT}`
const USUAL_API = 'http://127.0.0.1:8000'
const BACKEND = join(import.meta.dirname, '..', 'backend')
const FRONTEND = join(import.meta.dirname, '..', 'frontend')

const SF = { key: 'e2e-steadfast-key', secret: 'e2e-steadfast-secret', webhook: 'e2e-steadfast-webhook-token' }
const PA = { clientId: 'e2e-pathao-client', clientSecret: 'e2e-pathao-client-secret', username: 'e2e@buynest.test', password: 'e2e-pathao-password', storeId: '7788', webhook: 'e2e-pathao-webhook-secret' }

// lib.mjs reads these when it loads: this suite's storefront and API, not the usual ones.
process.env.BASE_URL = STORE
process.env.LARAVEL_URL = API
const lib = await import('./lib.mjs')
const { ADMIN_USER, BASE, LARAVEL, SHOPPER, SHOPPER_2, adminSignIn, axeViolations, clearSavedCart, latestCode, preserveStock, reporter, sidewaysOverflow, storefrontSignIn, visible, watchErrors } = lib

const report = reporter('courier: Steadfast and Pathao bookings (stand-ins), webhooks, tracking')
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

/** The API's environment: also used for the artisan command, so it sees the same couriers. */
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

/*
 * Steadfast (Packzy): just enough for SteadfastGateway, in Steadfast's shapes. `sf` is shared with the checks:
 * they read what was sent and set what the next answers are.
 */
const sf = {
  orders: [], // { headers, body, answer }
  refuseNext: null, // message of the next create_order refused
  refuseInvoice: {}, // invoice → message: always refused
  statusOf: {}, // consignment_id → raw delivery_status answered by status_by_cid
  statusCalls: [],
  balanceCalls: 0,
  unauthorized: 0,
  nextConsignment: 50_000_000 + Math.floor(Math.random() * 1_000_000) * 10,
}
const steadfastApi = createHttpServer(async (req, res) => {
  const raw = await readBody(req)
  const url = new URL(req.url, 'http://stand-in')
  if (req.headers['api-key'] !== SF.key || req.headers['secret-key'] !== SF.secret) {
    sf.unauthorized++
    return sendJson(res, 401, { status: 401, message: 'Unauthorized' })
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/create_order') {
    const body = parse(raw)
    const record = { headers: { ...req.headers }, body, answer: null }
    sf.orders.push(record)
    const answer = (status, json) => {
      record.answer = json
      return sendJson(res, status, json)
    }
    if (!body || typeof body !== 'object') return answer(400, { status: 400, message: 'Invalid JSON body.' })
    const refusal = sf.refuseNext ?? sf.refuseInvoice[body.invoice]
    if (refusal) {
      sf.refuseNext = null
      return answer(400, { status: 400, message: refusal })
    }
    const missing = ['invoice', 'recipient_name', 'recipient_phone', 'recipient_address', 'cod_amount'].filter((field) => body[field] === undefined || body[field] === null || body[field] === '')
    if (missing.length) return answer(422, { status: 422, errors: Object.fromEntries(missing.map((field) => [field, [`The ${field.replace('_', ' ')} field is required.`]])) })
    if (!/^01\d{9}$/.test(String(body.recipient_phone))) return answer(422, { status: 422, errors: { recipient_phone: ['The recipient phone must be 11 digits.'] } })
    if (sf.orders.some((other) => other !== record && other.answer?.status === 200 && other.body?.invoice === body.invoice)) {
      return answer(422, { status: 422, errors: { invoice: ['The invoice has already been taken.'] } })
    }
    sf.nextConsignment += 7
    const consignment = { consignment_id: sf.nextConsignment, invoice: body.invoice, tracking_code: nextId('SF').toLowerCase(), recipient_name: body.recipient_name, recipient_phone: body.recipient_phone, recipient_address: body.recipient_address, cod_amount: body.cod_amount, status: 'in_review', note: body.note ?? null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    return answer(200, { status: 200, message: 'Consignment has been created successfully.', consignment })
  }
  const status = url.pathname.match(/^\/api\/v1\/status_by_cid\/([^/]+)$/)
  if (req.method === 'GET' && status) {
    const id = decodeURIComponent(status[1])
    sf.statusCalls.push(id)
    const known = sf.orders.some((order) => String(order.answer?.consignment?.consignment_id) === id)
    if (!known) return sendJson(res, 404, { status: 404, message: 'Consignment not found.' })
    return sendJson(res, 200, { status: 200, delivery_status: sf.statusOf[id] ?? 'in_review' })
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/get_balance') {
    sf.balanceCalls++
    return sendJson(res, 200, { status: 200, current_balance: 12500.5 })
  }
  return sendJson(res, 404, { status: 404, message: `No stand-in for ${req.method} ${url.pathname}` })
})

/* Pathao ("Aladdin" merchant API): just enough for PathaoGateway, in Pathao's shapes. */
const PATHAO_CITIES = [
  { city_id: 1, city_name: 'Dhaka' },
  { city_id: 2, city_name: 'Chattogram' },
]
const PATHAO_ZONES = {
  1: [
    { zone_id: 101, zone_name: 'Banani' },
    { zone_id: 102, zone_name: 'Gulshan' },
    { zone_id: 103, zone_name: 'Dhanmondi' },
  ],
  2: [{ zone_id: 201, zone_name: 'Agrabad' }],
}
const PATHAO_AREAS = {
  101: [{ area_id: 1011, area_name: 'Banani Road 11', home_delivery_available: true, pickup_available: true }],
  102: [
    { area_id: 1021, area_name: 'Gulshan 1', home_delivery_available: true, pickup_available: true },
    { area_id: 1022, area_name: 'Gulshan 2', home_delivery_available: false, pickup_available: true },
  ],
  103: [{ area_id: 1031, area_name: 'Dhanmondi 27', home_delivery_available: true, pickup_available: true }],
  201: [],
}
const pa = {
  tokens: new Set(),
  tokenRequests: [], // the bodies of issue-token
  refusedTokens: 0, // 401s for an unknown token
  orders: [], // { body, answer }
  lists: [], // paths of the location lists asked
  info: [], // consignment ids asked
  statusOf: {}, // consignment_id → order_status of /info
}
const pathaoApi = createHttpServer(async (req, res) => {
  const raw = await readBody(req)
  const url = new URL(req.url, 'http://stand-in')
  const path = url.pathname
  if (req.method === 'POST' && path === '/aladdin/api/v1/issue-token') {
    const body = parse(raw) ?? {}
    pa.tokenRequests.push(body)
    if (body.client_id !== PA.clientId || body.client_secret !== PA.clientSecret || body.username !== PA.username || body.password !== PA.password || body.grant_type !== 'password') {
      return sendJson(res, 401, { message: 'Client authentication failed', type: 'error', code: 401 })
    }
    const token = `pathao-e2e-${nextId('T').toLowerCase()}`
    pa.tokens.add(token)
    return sendJson(res, 200, { token_type: 'Bearer', expires_in: 432000, access_token: token, refresh_token: `${token}-refresh` })
  }
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!pa.tokens.has(token)) {
    pa.refusedTokens++
    return sendJson(res, 401, { message: 'Unauthenticated.', type: 'error', code: 401 })
  }
  if (req.method === 'GET' && path === '/aladdin/api/v1/city-list') {
    pa.lists.push(path)
    return sendJson(res, 200, { message: 'City successfully fetched.', type: 'success', code: 200, data: { data: PATHAO_CITIES } })
  }
  const zones = path.match(/^\/aladdin\/api\/v1\/cities\/(\d+)\/zone-list$/)
  if (req.method === 'GET' && zones) {
    pa.lists.push(path)
    return sendJson(res, 200, { message: 'Zone list fetched.', type: 'success', code: 200, data: { data: PATHAO_ZONES[zones[1]] ?? [] } })
  }
  const areas = path.match(/^\/aladdin\/api\/v1\/zones\/(\d+)\/area-list$/)
  if (req.method === 'GET' && areas) {
    pa.lists.push(path)
    return sendJson(res, 200, { message: 'Area list fetched.', type: 'success', code: 200, data: { data: PATHAO_AREAS[areas[1]] ?? [] } })
  }
  if (req.method === 'POST' && path === '/aladdin/api/v1/orders') {
    const body = parse(raw) ?? {}
    const record = { body, answer: null }
    pa.orders.push(record)
    const errors = {}
    for (const field of ['store_id', 'merchant_order_id', 'recipient_name', 'recipient_phone', 'recipient_address', 'recipient_city', 'recipient_zone', 'delivery_type', 'item_type', 'item_quantity', 'item_weight', 'amount_to_collect']) {
      if (body[field] === undefined || body[field] === null || body[field] === '') errors[field] = [`The ${field.replaceAll('_', ' ')} field is required.`]
    }
    if (!errors.recipient_phone && !/^01\d{9}$/.test(String(body.recipient_phone))) errors.recipient_phone = ['The recipient phone format is invalid.']
    if (!errors.amount_to_collect && !Number.isInteger(body.amount_to_collect)) errors.amount_to_collect = ['The amount to collect must be an integer.']
    if (Object.keys(errors).length) {
      record.answer = { message: 'Please fix the given errors', type: 'error', code: 422, errors }
      return sendJson(res, 422, record.answer)
    }
    const consignment = nextId('DL')
    record.answer = { message: 'Order Created Successfully', type: 'success', code: 200, data: { consignment_id: consignment, merchant_order_id: body.merchant_order_id, order_status: 'Pending', delivery_fee: 80 } }
    return sendJson(res, 200, record.answer)
  }
  const info = path.match(/^\/aladdin\/api\/v1\/orders\/([^/]+)\/info$/)
  if (req.method === 'GET' && info) {
    const id = decodeURIComponent(info[1])
    pa.info.push(id)
    const order = pa.orders.find((item) => item.answer?.data?.consignment_id === id)
    if (!order) return sendJson(res, 404, { message: 'Order not found', type: 'error', code: 404 })
    const status = pa.statusOf[id] ?? 'Pending'
    return sendJson(res, 200, { message: 'Order info', type: 'success', code: 200, data: { consignment_id: id, merchant_order_id: order.body.merchant_order_id, order_status: status, order_status_slug: status, updated_at: new Date().toISOString() } })
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
const call = async (base, path, { method = 'GET', token, body, headers = {} } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
      body: body && JSON.stringify(body),
    })
    if (response.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, (Number(response.headers.get('retry-after')) || 5) * 1000))
      continue
    }
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
/** An artisan command with the suite API's environment. Asynchronous: the stand-ins run in this process. */
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
    const found = mailsTo(email, after).filter((mail) => match(mail))
    if (found.length) return found.at(-1)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}
const lastMailId = (email) => mailsTo(email).at(-1)?.id ?? 0
const taka = (value) => `৳${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()
const hasBanglaDigits = (text) => /[০-৯]/.test(text ?? '')

const DRESS = 166 // Tartan Dress (plenty of stock): its price reads as taka in this store
const customer = { firstName: 'Nusrat', lastName: `Courierson${run}`, email: `courier.${run}@example.com`, password: 'CourierPass2026', phone: '+880 1711 223344' }
const PHONE_11 = '01711223344'
const made = { orders: new Set(), customerId: null }
const saved = { courierSettings: null, gridPrefs: undefined, defaultCountry: undefined }
const ids = {} // Bangladesh place ids (Dhaka division / district, Banani)
let browser
let restoreStock = async () => 0
let owner
let shopperToken = null
const errors = []
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const steadfastHook = (body, token = SF.webhook) => api('/api/v1/couriers/steadfast/webhook', { method: 'POST', body, headers: token === null ? {} : { Authorization: `Bearer ${token}` } })
const pathaoHook = (body, secret = PA.webhook) => api('/api/v1/couriers/pathao/webhook', { method: 'POST', body, headers: secret === null ? {} : { 'X-PATHAO-Signature': secret } })
const bdAddress = (extra = {}) => ({ first_name: 'Karim', last_name: 'Uddin', line1: 'House 7, Road 11', country: 'Bangladesh', division_id: ids.dhakaDivision, district_id: ids.dhakaDistrict, area_id: ids.banani, ...extra })
const latestShipment = (order) => (order?.shipments ?? []).at(-1) ?? null

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
  const couriersAtStart = (await admin$('/couriers')).body
  saved.courierSettings = couriersAtStart?.settings ?? null
  if (!saved.courierSettings) throw new Error('could not read the courier settings')
  saved.gridPrefs = (await admin$('/preferences/orders_grid')).body?.data?.value ?? null
  // The Bangladesh address form (Division → District → Area) is on when the store's default country is Bangladesh.
  const checkout = (await admin$('/settings')).body?.data?.checkout
  if (!checkout) throw new Error('could not read Settings → Checkout')
  saved.defaultCountry = checkout.default_country ?? null
  if (saved.defaultCountry !== 'Bangladesh') {
    const set = await admin$('/settings', { method: 'PATCH', body: { checkout: { default_country: 'Bangladesh' } } })
    if (set.status !== 200) throw new Error(`could not set the default country: ${set.status} ${JSON.stringify(set.body?.errors ?? set.body?.message)}`)
  }
  restoreStock = await preserveStock()
  browser = await lib.launch()
  await runChecks(couriersAtStart)
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
async function runChecks(couriersAtStart) {
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
      if (process.env.COURIER_DEBUG) console.log(name, error.stack, await lastPage?.url(), await lastPage?.screenshot({ path: `${process.env.COURIER_DEBUG}/${name.replace(/\W+/g, '-')}.png`, fullPage: true }).then(() => 'shot', () => 'no shot'))
    }
  }
  let lastPage = null
  async function newPage({ viewport = { width: 1280, height: 900 }, lang } = {}) {
    const context = await browser.newContext({ viewport, bypassCSP: true })
    context.setDefaultTimeout(15000)
    // This suite starts its own storefront dev server: under a full run its first page compiles can take over 15 s (SQA S2).
    context.setDefaultNavigationTimeout(45000)
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
  async function closeMiniCart(page) {
    const drawer = page.getByRole('dialog', { name: /Your cart|আপনার কার্ট/ })
    if (await visible(drawer, 3000)) {
      await page.keyboard.press('Escape')
      await drawer.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }
  /** Chooses `label` in the <select name=…> once its list has it. */
  async function pick(page, name, label) {
    await page.waitForFunction(
      ([selector, wanted]) => {
        const element = document.querySelector(selector)
        return element && !element.disabled && [...element.options].some((option) => option.textContent.trim() === wanted)
      },
      [`select[name="${name}"]`, label],
      { timeout: 15000 },
    )
    await page.locator(`select[name="${name}"]`).selectOption({ label })
  }
  const priced = (page) => page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking prices|দাম যাচাই/.test(b.textContent)), null, { timeout: 20000 }).catch(() => {})
  const placeButton = (page) => page.locator('button[type="submit"][form="checkout-form"]')
  const parcelCard = (page, courier) => page.getByRole('region', { name: new RegExp(`^${courier} parcel · SHP-`) })
  const bookingDialog = (page, number) => page.getByRole('dialog', { name: `Book a courier for order ${number}` })
  /** Opens "Book courier" on the order page and waits for the booking form. */
  async function openBooking(page, number) {
    await page.goto(`${BASE}/admin/orders/${number}`, { waitUntil: 'networkidle' })
    const button = page.getByRole('button', { name: 'Book courier', exact: true })
    await button.and(page.locator(':enabled')).waitFor({ timeout: 15000 })
    await button.click()
    const dialog = bookingDialog(page, number)
    await dialog.getByRole('radiogroup', { name: 'Courier' }).or(dialog.getByRole('group', { name: 'Courier' })).first().waitFor()
    return dialog
  }

  // ---------- 0. The isolated setup ----------
  await part('setup', async () => {
    const apiStore = (await api('/api/v1/store')).body?.data
    log(apiStore?.currency?.code === 'BDT', `API on :${API_PORT} charges in taka (${apiStore?.currency?.code})`)
    const summary = couriersAtStart?.data ?? []
    const steadfast = summary.find((item) => item.key === 'steadfast')
    const pathao = summary.find((item) => item.key === 'pathao')
    log(steadfast?.configured === true && pathao?.configured === true && pathao?.mode === 'sandbox', `GET /couriers on :${API_PORT}: Steadfast and Pathao set up, Pathao in sandbox (${JSON.stringify(summary.map((item) => [item.key, item.configured, item.mode]))})`)
    const text = JSON.stringify(couriersAtStart)
    log(![SF.key, SF.secret, SF.webhook, PA.clientSecret, PA.password, PA.webhook].some((secret) => text.includes(secret)), 'GET /couriers never sends a credential or webhook secret')
    const usual = await call(USUAL_API, '/api/v1/store').catch(() => null)
    const usualOwner = usual ? (await call(USUAL_API, '/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token : null
    const usualCouriers = usualOwner ? (await call(USUAL_API, '/api/admin/v1/couriers', { token: usualOwner })).body?.data : null
    log(!usualCouriers || usualCouriers.every((item) => item.configured === false), `the usual API on :8000 has no courier set up (${usualCouriers ? JSON.stringify(usualCouriers.map((item) => [item.key, item.configured])) : 'not running'})`)
    const fromStore = await fetch(`${STORE}/api/catalog/store`).then((r) => r.json(), () => null)
    log((fromStore?.data?.currency?.code ?? fromStore?.currency?.code) === 'BDT', `storefront on :${STORE_PORT} talks to :${API_PORT}`)

    // Places (Dhaka → Dhaka → Banani), and the throwaway customer.
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
    log(verified.status === 200 && Boolean(made.customerId), `a throwaway customer signed up and confirmed (${customer.email}, #${made.customerId})`)
    if (!made.customerId) throw new Error(`the throwaway customer could not sign up (${registered.status} ${JSON.stringify(registered.body?.errors ?? registered.body?.message)})`)
    shopperToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: customer.email, password: customer.password } })).body?.data?.tokens?.access_token
  })

  // ---------- 1. Settings → Couriers ----------
  await part('settings', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings/couriers`, { waitUntil: 'networkidle' })
    const steadfast = admin.getByRole('region', { name: 'Steadfast', exact: true })
    const pathao = admin.getByRole('region', { name: 'Pathao', exact: true })
    await steadfast.waitFor()
    log((await steadfast.getByText('Set up', { exact: true }).isVisible()) && (await steadfast.getByText('Not set up', { exact: true }).count()) === 0, 'Settings → Couriers: the Steadfast card says "Set up"')
    log((await pathao.getByText('Set up', { exact: true }).isVisible()) && (await pathao.getByText('Sandbox (test bookings)').isVisible()), 'the Pathao card says "Set up" and "Sandbox (test bookings)"')
    const hook = await steadfast.getByRole('textbox', { name: 'Webhook URL' }).inputValue()
    const pathaoHookUrl = await pathao.getByRole('textbox', { name: 'Webhook URL' }).inputValue()
    log(hook === `${API}/api/v1/couriers/steadfast/webhook` && pathaoHookUrl === `${API}/api/v1/couriers/pathao/webhook`, `webhook URLs are the API's own (${hook}, ${pathaoHookUrl})`)
    log(await visible(steadfast.getByRole('button', { name: 'Copy webhook URL for Steadfast' })), '"Copy webhook URL for Steadfast"')
    const pageText = await admin.locator('main').evaluate((element) => element.textContent)
    log(![SF.key, SF.secret, SF.webhook, PA.clientSecret, PA.password, PA.webhook].some((secret) => pageText.includes(secret)) && /STEADFAST_API_KEY/.test(pageText), 'the page names the env variables but shows no credential')
    const balanceCallsBefore = sf.balanceCalls
    await steadfast.getByRole('button', { name: 'Check balance' }).click()
    log(await visible(steadfast.getByRole('status').filter({ hasText: 'Balance: ৳12,500.50' })), `"Check balance" → "Balance: ৳12,500.50" (the stand-in was asked ${sf.balanceCalls - balanceCallsBefore} time)`)
    await axe(admin, 'Settings → Couriers')
    await phone(admin, 'Settings → Couriers')

    // Booking defaults: Steadfast first, a note for the courier.
    const form = admin.getByRole('form', { name: 'Booking defaults' })
    await form.getByLabel('Default courier').selectOption({ label: 'Steadfast' })
    await form.getByLabel('Default note for the courier (optional)').fill('Handle with care (e2e)')
    await form.getByLabel('Pathao item type').selectOption('parcel')
    await form.getByLabel('Pathao delivery type').selectOption('normal')
    const sync = form.getByRole('checkbox', { name: 'Check booked parcels with the courier every 30 minutes' })
    log(await visible(sync), 'the auto-check checkbox is there')
    await form.getByRole('button', { name: 'Save courier settings' }).click()
    log(await visible(form.getByText('Courier settings saved.')), '"Save courier settings" → "Courier settings saved."')
    const after = (await admin$('/couriers')).body?.settings
    log(after?.courier_default === 'steadfast' && after?.courier_note_template === 'Handle with care (e2e)' && after?.courier_auto_sync === saved.courierSettings.courier_auto_sync, `saved: ${JSON.stringify(after)}`)
    await admin.context().close()
  })

  // ---------- 2. A cash on delivery order at checkout, booked with Steadfast ----------
  let orderA = null
  let bookedA = null // { consignment, tracking, shipment }
  await part('checkout and Steadfast booking', async () => {
    const shop = await newPage()
    await storefrontSignIn(shop, customer)
    await shop.goto(`${BASE}/products/${DRESS}`, { waitUntil: 'networkidle' })
    await shop.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
    await closeMiniCart(shop)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await shop.locator('[name="email"]').waitFor()
    const country = shop.locator('[name="shipping.country"]')
    if ((await country.inputValue()) !== 'Bangladesh') await country.selectOption('Bangladesh')
    await shop.locator('select[name="shipping.divisionId"]').waitFor()
    await shop.locator('[name="shipping.firstName"]').fill('Nusrat')
    await shop.locator('[name="shipping.lastName"]').fill('Jahan')
    await pick(shop, 'shipping.divisionId', 'Dhaka')
    await pick(shop, 'shipping.districtId', 'Dhaka')
    await pick(shop, 'shipping.areaId', 'Banani')
    await shop.locator('[name="shipping.line1"]').fill('House 12, Road 11, Block C')
    const phoneField = shop.locator('[name="phone"]')
    if (!(await phoneField.inputValue())) await phoneField.fill(customer.phone)
    await priced(shop)
    await shop.locator('input[name="shippingMethod"][value="standard"]').check()
    await priced(shop)
    await shop.waitForFunction(() => document.querySelector('input[name="paymentMethod"][value="cod"]')?.disabled === false, null, { timeout: 15000 }).catch(() => {})
    await shop.locator('input[name="paymentMethod"][value="cod"]').check()
    await priced(shop)
    await placeButton(shop).and(shop.locator(':enabled')).waitFor({ timeout: 20000 })
    await placeButton(shop).click()
    await shop.waitForURL((url) => url.pathname.startsWith('/order-confirmation/'), { timeout: 45000 }).catch(async (error) => {
      const shown = await shop.locator('[role="alert"], .form-field__error').allInnerTexts().catch(() => [])
      throw new Error(`the order wasn't placed (at ${shop.url()}; shown: ${JSON.stringify(shown.filter(Boolean)).slice(0, 300)}): ${error.message.split('\n')[0]}`)
    })
    orderA = new URL(shop.url()).pathname.match(/BN-\d+/)?.[0] ?? null
    if (orderA) made.orders.add(orderA)
    await shop.context().close()
    let placed = orderA ? await orderOf(orderA) : null
    log(placed?.payment_method === 'cod' && placed?.status === 'processing' && placed?.currency === 'BDT' && placed?.phone === '+8801711223344', `placed ${orderA} at checkout: cash on delivery, processing, BDT, phone ${placed?.phone}`)
    if (!placed) throw new Error('no order placed')
    if (placed.confirmation?.status && placed.confirmation.status !== 'confirmed' && placed.confirmation.status !== 'not_required') {
      const confirmed = await admin$(`/orders/${orderA}/confirmation`, { method: 'POST', body: { outcome: 'confirmed', notify_customer: false } })
      log(confirmed.status === 200 || confirmed.status === 201, `COD confirmation is on: ${orderA} confirmed by phone first (${confirmed.status})`)
      placed = await orderOf(orderA)
    }

    // The order page and the dialog.
    const admin = await adminPage()
    const defaults = (await admin$(`/orders/${orderA}/courier-booking`)).body?.data
    log(defaults?.courier_default === 'steadfast' && defaults?.phone === PHONE_11 && defaults?.cod_amount === placed.totals.total && /Banani/.test(defaults?.address_line ?? '') && defaults?.note === 'Handle with care (e2e)' && defaults?.problem === null, `booking defaults: Steadfast, phone ${defaults?.phone}, cash ${defaults?.cod_amount} (total ${placed.totals.total}), "${defaults?.address_line}", the saved note`)
    log(defaults?.pathao_match?.city_id === 1 && defaults?.pathao_match?.zone_id === 101, `Pathao match by name: Dhaka → city 1, Banani → zone 101 (${JSON.stringify(defaults?.pathao_match)})`)
    let dialog = await openBooking(admin, orderA)
    log(await dialog.getByRole('radio', { name: /^Steadfast/ }).isChecked(), 'the dialog starts with Steadfast (the default courier)')
    log(await visible(dialog.getByRole('radio', { name: /^Pathao.*sandbox \(test bookings\)/ })), 'Pathao is offered as "sandbox (test bookings)"')
    const recipient = squash(await dialog.getByRole('region', { name: 'Recipient' }).innerText())
    log(recipient.includes('Nusrat Jahan') && recipient.includes(PHONE_11) && /Banani/.test(recipient), `Recipient: "${recipient.slice(0, 160)}"`)
    log(Number(await dialog.getByLabel('Cash to collect (BDT)').inputValue()) === Number(placed.totals.total) && Number(await dialog.getByLabel('Weight (kg)').inputValue()) > 0, `Cash to collect (BDT) ${await dialog.getByLabel('Cash to collect (BDT)').inputValue()}, Weight (kg) ${await dialog.getByLabel('Weight (kg)').inputValue()}`)
    log((await dialog.getByLabel('Note for the courier (optional)').inputValue()) === 'Handle with care (e2e)', 'the note comes from Settings → Couriers')
    log(await dialog.getByRole('checkbox', { name: 'Email the customer the tracking details' }).isChecked(), '"Email the customer the tracking details" is ticked')
    log((await dialog.getByRole('checkbox', { name: 'Book without confirmation' }).count()) === 0, 'a confirmed (or no-confirmation) order has no "Book without confirmation"')
    await axe(admin, 'the booking dialog')
    await phone(admin, 'the booking dialog')

    // Steadfast refuses: its own words, nothing saved.
    sf.refuseNext = 'Insufficient balance in the merchant account (e2e)'
    const callsBefore = sf.orders.length
    await dialog.getByRole('button', { name: 'Book with Steadfast' }).click()
    const refusal = 'Steadfast refused the booking: Insufficient balance in the merchant account (e2e)'
    log(await visible(dialog.getByRole('alert').filter({ hasText: refusal }), 25000), `a refusal shows the courier's text: "${refusal}"`)
    const unchanged = await orderOf(orderA)
    log(sf.orders.length === callsBefore + 1 && unchanged?.status === 'processing' && (unchanged?.shipments ?? []).length === 0, `…the stand-in was asked once, the order is unchanged (${unchanged?.status}, ${(unchanged?.shipments ?? []).length} shipments)`)

    // Again: booked.
    const mailBefore = lastMailId(customer.email)
    await dialog.getByRole('button', { name: 'Book with Steadfast' }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 30000 })
    const sent = sf.orders.at(-1)
    const consignment = sent?.answer?.consignment
    const notice = admin.getByText(/^Booked with Steadfast \(consignment /)
    await notice.first().waitFor()
    const noticeText = squash(await notice.first().innerText())
    log(new RegExp(`^Booked with Steadfast \\(consignment ${consignment?.consignment_id}, tracking code ${consignment?.tracking_code}\\)\\. Shipment SHP-\\S+ created and the order is now shipped\\.`).test(noticeText), `success: "${noticeText}"`)
    const body = sent?.body ?? {}
    log(body.invoice === orderA && body.recipient_phone === PHONE_11 && body.recipient_name === 'Nusrat Jahan' && /Banani/.test(body.recipient_address ?? '') && !/Bangladesh/.test(body.recipient_address ?? '') && body.note === 'Handle with care (e2e)', `the stand-in got invoice ${body.invoice}, phone ${body.recipient_phone} (11 digits), "${body.recipient_address}", note "${body.note}"`)
    log(typeof body.cod_amount === 'number' && body.cod_amount === Number(placed.totals.total), `…cod_amount ${body.cod_amount} (a number, the order total ${placed.totals.total})`)
    log(sent?.headers?.['api-key'] === SF.key && sent?.headers?.['secret-key'] === SF.secret && /application\/json/.test(sent?.headers?.['content-type'] ?? ''), '…with the Api-Key and Secret-Key headers, as JSON')
    const shipped = await orderOf(orderA)
    const shipment = latestShipment(shipped)
    log(shipped?.status === 'shipped' && shipment?.carrier === 'steadfast' && shipment?.tracking_number === consignment?.tracking_code && shipment?.courier?.consignment_id === String(consignment?.consignment_id) && shipment?.courier?.delivery_status === 'booked' && shipment?.courier?.booked_via_api === true, `${orderA} is shipped; shipment ${shipment?.number}: Steadfast, tracking ${shipment?.tracking_number}, consignment ${shipment?.courier?.consignment_id}, booked`)
    bookedA = { consignment: String(consignment?.consignment_id), tracking: consignment?.tracking_code, shipment: shipment?.number }
    const mail = await waitForMail(customer.email, (item) => (item.text ?? '').includes(consignment?.tracking_code ?? '#'), { after: mailBefore })
    log(Boolean(mail), `the customer was emailed the tracking code ("${mail?.subject}")`)

    // The parcel card.
    const card = parcelCard(admin, 'Steadfast')
    await card.waitFor()
    log((await card.getAttribute('aria-labelledby')) !== null && (await visible(card.getByText('Booked', { exact: true }))), `the parcel card "Steadfast parcel · ${shipment?.number}" shows "Booked"`)
    log(await visible(card.getByRole('button', { name: `Copy consignment ID ${bookedA.consignment}` })), `"Copy consignment ID ${bookedA.consignment}"`)
    log(await visible(card.getByRole('button', { name: `Copy tracking code ${bookedA.tracking}` })), `"Copy tracking code ${bookedA.tracking}"`)
    const track = card.getByRole('link', { name: /Track on Steadfast/ })
    log((await track.getAttribute('href')) === `https://steadfast.com.bd/t/${bookedA.tracking}` && /noopener/.test((await track.getAttribute('rel')) ?? ''), `"Track on Steadfast" → ${await track.getAttribute('href')}`)
    const cardText = squash(await card.innerText())
    log(cardText.includes(`Cash to collect ${taka(placed.totals.total)}`) && /Courier fee Not reported yet/.test(cardText) && /Collected Nothing reported yet/.test(cardText) && /Last update/.test(cardText), `the card: Cash to collect ${taka(placed.totals.total)}, Courier fee, Collected, Last update`)
    log(await visible(card.getByRole('list', { name: 'Tracking history' })), 'the card has its "Tracking history" list')
    log((await admin.getByRole('button', { name: 'Book courier', exact: true }).count()) === 0, '"Book courier" is gone once the order is shipped')
    await axe(admin, 'the order page with the parcel card')
    await phone(admin, 'the order page with the parcel card')
    await admin.context().close()

    // A second booking is refused, and the stand-in isn't asked.
    const again = await admin$(`/orders/${orderA}/courier-booking`, { method: 'POST', body: { courier: 'steadfast' } })
    const expected = `This order is already booked with Steadfast (${bookedA.consignment}).`
    log(again.status === 422 && (again.body?.errors?.order?.[0] === expected || again.body?.errors?.order?.[0]?.includes('already')), `booking ${orderA} again: 422 "${again.body?.errors?.order?.[0]}"`)
  })

  // ---------- 3. Pathao: City → Zone → Area ----------
  let orderB = null
  await part('Pathao booking', async () => {
    const placed = await api('/api/v1/orders', { method: 'POST', token: shopperToken, body: { email: customer.email, phone: '01811 223344', items: [{ product_id: DRESS, quantity: 2 }], shipping_address: bdAddress({ first_name: 'Rafiq', last_name: 'Hasan' }), shipping_method: 'standard', payment_method: 'cod' } })
    orderB = placed.body?.data?.number ?? null
    if (orderB) made.orders.add(orderB)
    log(placed.status === 201 && Boolean(orderB), `${orderB}: a second cash on delivery order (through the API, ${placed.status})`)
    if (!orderB) throw new Error(`order B not placed: ${JSON.stringify(placed.body?.errors ?? placed.body?.message)}`)
    let order = await orderOf(orderB)
    if (order.confirmation?.status && !['confirmed', 'not_required'].includes(order.confirmation.status)) {
      await admin$(`/orders/${orderB}/confirmation`, { method: 'POST', body: { outcome: 'confirmed', notify_customer: false } })
      order = await orderOf(orderB)
    }
    const admin = await adminPage()
    const dialog = await openBooking(admin, orderB)
    await dialog.getByRole('radio', { name: /^Pathao/ }).check()
    const places = dialog.getByRole('group', { name: 'Pathao delivery area' })
    await places.waitFor()
    const city = places.getByLabel('City', { exact: true })
    const zone = places.getByLabel('Zone', { exact: true })
    const area = places.getByLabel('Area (optional)')
    await admin.waitForFunction(() => [...document.querySelectorAll('.pathao-places select')].some((select) => select.options.length > 2), null, { timeout: 15000 }).catch(() => {})
    await zone.locator('option', { hasText: 'Gulshan' }).first().waitFor({ state: 'attached' })
    log((await city.inputValue()) === '1' && (await zone.inputValue()) === '101', `City and Zone are pre-matched from the address: ${await city.locator('option:checked').innerText()} / ${await zone.locator('option:checked').innerText()}`)
    log((await city.locator('option').allInnerTexts()).some((text) => text.trim() === 'Chattogram'), "the City list comes from Pathao (the stand-in's Chattogram is there)")
    await zone.selectOption({ label: 'Gulshan' })
    await area.locator('option', { hasText: 'Gulshan 1' }).first().waitFor({ state: 'attached' })
    const areaOptions = (await area.locator('option').allInnerTexts()).map((text) => text.trim())
    log(areaOptions.includes('Gulshan 1') && areaOptions.includes('Gulshan 2 (no home delivery)'), `Zone Gulshan loads its areas (${areaOptions.join(', ')})`)
    await area.selectOption({ label: 'Gulshan 1' })
    log(await visible(dialog.getByText('Pathao takes 0.5 to 10 kg.')), 'the weight hint for Pathao: "Pathao takes 0.5 to 10 kg."')
    await axe(admin, 'the booking dialog with Pathao chosen')
    await phone(admin, 'the booking dialog with Pathao chosen')
    const before = pa.orders.length
    await dialog.getByRole('button', { name: 'Book with Pathao' }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 30000 })
    const sent = pa.orders.at(-1)
    const consignment = sent?.answer?.data?.consignment_id
    const notice = admin.getByText(/^Booked with Pathao \(consignment /)
    log(await visible(notice) && pa.orders.length === before + 1, `success: "${squash(await notice.first().innerText().catch(() => ''))}"`)
    const body = sent?.body ?? {}
    log(body.store_id === Number(PA.storeId) && body.merchant_order_id === orderB && body.recipient_city === 1 && body.recipient_zone === 102 && body.recipient_area === 1021 && body.delivery_type === 48 && body.item_type === 2, `the stand-in got store_id ${body.store_id}, merchant_order_id ${body.merchant_order_id}, city/zone/area ${body.recipient_city}/${body.recipient_zone}/${body.recipient_area}, delivery_type ${body.delivery_type}, item_type ${body.item_type}`)
    log(body.recipient_phone === '01811223344' && body.amount_to_collect === Math.ceil(Number(order.totals.total)) && body.item_quantity === 2 && body.item_weight >= 0.5 && body.item_weight <= 10 && body.special_instruction === 'Handle with care (e2e)', `…phone ${body.recipient_phone}, amount_to_collect ${body.amount_to_collect} (whole taka, total ${order.totals.total}), quantity ${body.item_quantity}, weight ${body.item_weight} kg`)
    log(pa.tokenRequests.length === 0 || pa.tokenRequests.every((item) => item.grant_type === 'password' && item.client_id === PA.clientId), `Pathao sign-in: password grant (${pa.tokenRequests.length} token requests, ${pa.refusedTokens} stale tokens refused)`)
    const shipped = await orderOf(orderB)
    const shipment = latestShipment(shipped)
    log(shipped?.status === 'shipped' && shipment?.carrier === 'pathao' && shipment?.tracking_number === consignment && shipment?.courier?.courier_fee === '80.00', `${orderB} is shipped with Pathao (consignment ${shipment?.courier?.consignment_id}, fee ${shipment?.courier?.courier_fee})`)
    const card = parcelCard(admin, 'Pathao')
    await card.waitFor()
    log(squash(await card.innerText()).includes(`Courier fee ${taka(80)}`), `the Pathao parcel card shows the courier fee ${taka(80)}`)
    await admin.context().close()

    // Pathao's webhooks: the integration check, a wrong secret, picked up, delivered with the cash.
    const check = await pathaoHook({ event: 'webhook_integration' })
    log(check.status === 202 && check.headers.get('x-pathao-merchant-webhook-integration-secret') === PA.webhook, `Pathao's integration check: 202 with X-Pathao-Merchant-Webhook-Integration-Secret (${check.status})`)
    const wrong = await pathaoHook({ consignment_id: consignment, merchant_order_id: orderB, event: 'order.delivered', order_status: 'Delivered', collected_amount: body.amount_to_collect }, 'not-the-secret')
    const stillShipped = await orderOf(orderB)
    log(wrong.status === 401 && stillShipped?.status === 'shipped' && latestShipment(stillShipped)?.courier?.delivery_status === 'booked', `Pathao webhook with a wrong X-PATHAO-Signature: ${wrong.status}, nothing changed`)
    const picked = await pathaoHook({ consignment_id: consignment, merchant_order_id: orderB, event: 'order.picked', order_status: 'Picked', updated_at: new Date().toISOString() })
    log(picked.status === 202 && latestShipment(await orderOf(orderB))?.courier?.delivery_status === 'picked_up', `"Picked" → picked up (${picked.status})`)
    const delivered = await pathaoHook({ consignment_id: consignment, merchant_order_id: orderB, event: 'order.delivered', order_status: 'Delivered', collected_amount: body.amount_to_collect, delivery_fee: 80, updated_at: new Date().toISOString() })
    const done = await orderOf(orderB)
    log(delivered.status === 202 && done?.status === 'delivered' && done?.payment_status === 'paid' && latestShipment(done)?.courier?.collected === body.amount_to_collect?.toFixed(2), `"Delivered" with collected_amount ${body.amount_to_collect} → ${done?.status}, ${done?.payment_status}, collected ${latestShipment(done)?.courier?.collected}`)
  })

  // ---------- 4. Steadfast webhooks: refused without the token, then delivered ----------
  await part('Steadfast webhooks', async () => {
    if (!orderA || !bookedA?.consignment) throw new Error('no Steadfast booking to report on')
    const placed = await orderOf(orderA)
    const payload = { notification_type: 'delivery_status', consignment_id: Number(bookedA.consignment), invoice: orderA, cod_amount: Number(placed.totals.total), status: 'delivered', delivery_charge: 60, tracking_message: 'Delivered to the customer (e2e)', updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) }
    const missing = await steadfastHook(payload, null)
    const wrong = await steadfastHook(payload, 'not-the-token')
    const unchanged = await orderOf(orderA)
    log(missing.status === 401 && wrong.status === 401 && unchanged?.status === 'shipped' && unchanged?.payment_status !== 'paid' && latestShipment(unchanged)?.courier?.delivery_status === 'booked' && (latestShipment(unchanged)?.events ?? []).length === 1, `Steadfast webhook without / with a wrong Bearer token: ${missing.status} / ${wrong.status}, nothing changed`)
    const unknown = await steadfastHook({ ...payload, consignment_id: 999999999 })
    log(unknown.status === 200, `an unknown consignment is answered 200 (a no-op, so Steadfast doesn't retry forever) (${unknown.status})`)
    const mailBefore = lastMailId(customer.email)
    const answer = await steadfastHook(payload)
    log(answer.status === 200 && answer.body?.status === 'success' && answer.body?.message === 'Webhook received successfully.', `"delivered" with the right token: ${answer.status} ${JSON.stringify(answer.body)}`)
    const delivered = await orderOf(orderA)
    const shipment = latestShipment(delivered)
    log(delivered?.status === 'delivered' && delivered?.payment_status === 'paid' && (delivered?.invoices ?? []).length >= 1, `${orderA}: delivered, ${delivered?.payment_status}, ${(delivered?.invoices ?? []).length} invoice`)
    log(shipment?.courier?.delivery_status === 'delivered' && shipment?.courier?.collected === placed.totals.total && shipment?.courier?.courier_fee === '60.00' && shipment?.courier?.courier_status === 'delivered', `the shipment: delivered, collected ${shipment?.courier?.collected}, fee ${shipment?.courier?.courier_fee}`)
    const history = (delivered?.history ?? []).find((entry) => entry.status === 'delivered')
    log(history?.admin_name === 'Steadfast' && /Delivered — reported by Steadfast/.test(history?.note ?? ''), `history: "${history?.note}" by ${history?.admin_name}`)
    const eventsBefore = (shipment?.events ?? []).length
    const repeat = await steadfastHook(payload)
    const after = await orderOf(orderA)
    log(repeat.status === 200 && (latestShipment(after)?.events ?? []).length === eventsBefore && (after?.invoices ?? []).length === (delivered?.invoices ?? []).length, `the same webhook again: 200, still ${eventsBefore} events, no second collection`)
    const mail = await waitForMail(customer.email, (item) => /deliver/i.test(`${item.subject} ${item.text}`), { after: mailBefore })
    log(Boolean(mail), `the customer was emailed that the order was delivered ("${mail?.subject}")`)

    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders/${orderA}`, { waitUntil: 'networkidle' })
    const card = parcelCard(admin, 'Steadfast')
    await card.waitFor()
    const cardText = squash(await card.innerText())
    log(cardText.includes(`Collected ${taka(placed.totals.total)}`) && cardText.includes(`Courier fee ${taka(60)}`) && /Delivered/.test(cardText) && cardText.includes('Delivered to the customer (e2e)'), `the parcel card: Delivered, Collected ${taka(placed.totals.total)}, Courier fee ${taka(60)}, the courier's message in the history`)
    const historyPanel = admin.getByRole('list', { name: 'History', exact: true })
    log(/by Steadfast/.test(await historyPanel.innerText()), 'the order history shows "by Steadfast"')
    await axe(admin, 'the order page (delivered by Steadfast)')
    await admin.context().close()
  })

  // ---------- 5. The customer's tracker, English and Bangla ----------
  await part('customer tracker', async () => {
    if (!orderA) throw new Error('no order to track')
    const shop = await newPage()
    await storefrontSignIn(shop, customer)
    await shop.goto(`${BASE}/account/orders/${orderA}`, { waitUntil: 'networkidle' })
    const steps = shop.getByRole('list', { name: 'Delivery progress' })
    await steps.waitFor()
    const items = (await steps.getByRole('listitem').allInnerTexts()).map(squash)
    log(items.length === 5 && /^Booked/.test(items[0]) && /^Picked up/.test(items[1]) && /^On the way/.test(items[2]) && /^Out for delivery/.test(items[3]) && /^Delivered/.test(items[4]), `"Delivery progress": ${items.join(' → ')}`)
    const current = await steps.locator('[aria-current="step"]').allInnerTexts()
    log(current.length === 1 && /^Delivered/.test(squash(current[0])), `aria-current="step" on "${squash(current[0] ?? '')}"`)
    log(await visible(shop.getByText('Status: Delivered')), '"Status: Delivered"')
    log(await visible(shop.getByText('Sent with Steadfast')), '"Sent with Steadfast"')
    log(await visible(shop.getByRole('button', { name: 'Copy tracking code' })) && (await shop.getByText(bookedA?.tracking ?? '#').count()) > 0, `the tracking code ${bookedA?.tracking} with "Copy tracking code"`)
    const link = shop.getByRole('link', { name: /Track on Steadfast/ })
    log((await link.getAttribute('href')) === `https://steadfast.com.bd/t/${bookedA?.tracking}` && /noopener/.test((await link.getAttribute('rel')) ?? ''), `"Track on Steadfast" → ${await link.getAttribute('href')} (rel="${await link.getAttribute('rel')}")`)
    log(await visible(shop.getByRole('heading', { name: 'Delivery updates' })), '"Delivery updates" heading')
    const main = squash(await shop.locator('main').innerText())
    log(main.includes('Delivered to the customer (e2e)') && !main.includes(taka(60)) && !/Courier fee/i.test(main), "the updates show the courier's message; no courier fee or raw status for the customer")
    await axe(shop, 'the customer order page with the tracker')
    await phone(shop, 'the customer tracker')
    await shop.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
    await shop.getByText(orderA).first().waitFor()
    log(await visible(shop.getByText('Delivery: Delivered')), 'Account → Orders: "Delivery: Delivered"')

    // Bangla: the buynest_lang cookie.
    await shop.context().addCookies([{ name: 'buynest_lang', value: 'bn', url: BASE }])
    await shop.goto(`${BASE}/account/orders/${orderA}`, { waitUntil: 'networkidle' })
    const bnSteps = shop.getByRole('list', { name: 'ডেলিভারির অগ্রগতি' })
    log(await visible(bnSteps), 'in Bangla: "ডেলিভারির অগ্রগতি"')
    log(await visible(shop.getByText('অবস্থা: ডেলিভারি হয়েছে')), '"অবস্থা: ডেলিভারি হয়েছে"')
    log(await visible(shop.getByRole('heading', { name: 'ডেলিভারির হালনাগাদ' })), '"ডেলিভারির হালনাগাদ" heading')
    const bnCurrent = await bnSteps.locator('[aria-current="step"]').allInnerTexts().catch(() => [])
    log(/ডেলিভারি হয়েছে/.test(bnCurrent[0] ?? ''), `aria-current on "${squash(bnCurrent[0] ?? '')}"`)
    const times = await shop.locator('.delivery-tracker__events time').allInnerTexts()
    log(times.length > 0 && times.every(hasBanglaDigits), `the update times in Bangla digits (${times[0]})`)
    await axe(shop, 'the customer tracker in Bangla')
    await phone(shop, 'the customer tracker in Bangla')
    await shop.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
    log(await visible(shop.getByText('ডেলিভারি: ডেলিভারি হয়েছে')), 'the order list in Bangla: "ডেলিভারি: ডেলিভারি হয়েছে"')
    await shop.context().close()
  })

  // ---------- 6. Bulk "Book with Steadfast": one booked, one refused ----------
  let orderC = null
  let orderD = null
  await part('bulk booking', async () => {
    for (const label of ['C', 'D']) {
      const placed = await api('/api/v1/orders', { method: 'POST', token: shopperToken, body: { email: customer.email, phone: '01911 223344', items: [{ product_id: DRESS, quantity: 1 }], shipping_address: bdAddress({ first_name: `Bulk${label}` }), shipping_method: 'standard', payment_method: 'cod' } })
      const number = placed.body?.data?.number ?? null
      if (!number) throw new Error(`order ${label} not placed: ${JSON.stringify(placed.body?.errors ?? placed.body?.message)}`)
      made.orders.add(number)
      const order = await orderOf(number)
      if (order.confirmation?.status && !['confirmed', 'not_required'].includes(order.confirmation.status)) await admin$(`/orders/${number}/confirmation`, { method: 'POST', body: { outcome: 'confirmed', notify_customer: false } })
      if (label === 'C') orderC = number
      else orderD = number
    }
    sf.refuseInvoice[orderD] = 'The recipient address is outside our delivery area (e2e)'
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' })
    for (const number of [orderC, orderD]) await admin.getByRole('checkbox', { name: `Select order ${number}` }).check()
    const bar = admin.locator('form.bulk-bar')
    await bar.getByLabel('Action').selectOption({ label: 'Book with Steadfast' })
    await bar.getByRole('button', { name: 'Apply' }).click()
    const results = admin.getByRole('dialog', { name: 'Steadfast booking results' })
    await results.waitFor({ timeout: 30000 })
    const text = squash(await results.innerText())
    log(await visible(results.getByRole('heading', { name: 'Booked (1)' })) && (await visible(results.getByRole('heading', { name: 'Not booked (1)' }))), `"Steadfast booking results": Booked (1), Not booked (1)`)
    const bookedC = sf.orders.find((item) => item.body?.invoice === orderC && item.answer?.status === 200)?.answer?.consignment
    log(text.includes(`${orderC} · consignment ${bookedC?.consignment_id} · tracking code ${bookedC?.tracking_code}`), `${orderC} booked (consignment ${bookedC?.consignment_id})`)
    log(text.includes(`${orderD}: Steadfast refused the booking: The recipient address is outside our delivery area (e2e)`), `${orderD} not booked, with Steadfast's reason`)
    await axe(admin, 'the bulk booking results')
    await phone(admin, 'the bulk booking results')
    await results.getByRole('button', { name: 'Close' }).click()
    await results.waitFor({ state: 'hidden' })
    const c = await orderOf(orderC)
    const d = await orderOf(orderD)
    log(c?.status === 'shipped' && latestShipment(c)?.courier?.delivery_status === 'booked' && sf.orders.find((item) => item.body?.invoice === orderC)?.body?.recipient_phone === '01911223344', `${orderC}: shipped, booked (phone sent as 01911223344)`)
    log(d?.status === 'processing' && (d?.shipments ?? []).length === 0, `${orderD}: unchanged (${d?.status}, no shipment)`)

    // The Delivery progress filter and the Delivery status column.
    await admin.goto(`${BASE}/admin/orders?delivery=booked`, { waitUntil: 'networkidle' })
    log((await admin.getByLabel('Delivery progress').inputValue()) === 'booked', 'the "Delivery progress" filter reads ?delivery=booked')
    await admin.locator('tbody tr').first().waitFor()
    const rows = await admin.locator('tbody tr').allInnerTexts()
    log(rows.some((row) => row.includes(orderC)) && !rows.some((row) => row.includes(orderA ?? '#')) && !rows.some((row) => row.includes(orderD)), `filtered by Booked: ${orderC} listed, ${orderA} (delivered) and ${orderD} (not booked) not`)
    await admin.locator('summary', { hasText: 'Columns' }).click()
    const column = admin.getByRole('checkbox', { name: 'Delivery status' })
    await column.click()
    const header = admin.getByRole('columnheader', { name: 'Delivery status' })
    log(await visible(header), 'the "Delivery status" column can be shown')
    const rowC = admin.locator('tbody tr').filter({ hasText: orderC })
    log(/Booked/.test(await rowC.innerText()), `${orderC}'s row says "Booked"`)
    // The column choice is the Owner's own preference: put back in cleanup.
    await admin.context().close()

    // The sync command lists what it would ask.
    const dry = await artisan(['buynest:couriers:sync', '--dry-run'])
    const cShipment = latestShipment(c)?.number
    log(dry.status === 0 && dry.output.includes(`${cShipment}: Steadfast ${bookedC?.consignment_id} (booked)`) && /Would check \d+ parcels\./.test(dry.output) && !dry.output.includes(bookedA?.shipment ?? '#'), `buynest:couriers:sync --dry-run lists ${cShipment} (not the delivered ones): "${dry.output.trim().split('\n').pop()}"`)
  })

  // ---------- 7. Refresh status ----------
  await part('refresh status', async () => {
    if (!orderC) throw new Error('no bulk-booked order to refresh')
    const order = await orderOf(orderC)
    const shipment = latestShipment(order)
    sf.statusOf[shipment.courier.consignment_id] = 'delivered'
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/orders/${orderC}`, { waitUntil: 'networkidle' })
    const card = parcelCard(admin, 'Steadfast')
    await card.waitFor()
    const asked = sf.statusCalls.length
    await card.getByRole('button', { name: `Refresh status of ${shipment.number}` }).click()
    log(await visible(card.getByRole('status').filter({ hasText: 'Steadfast says: Delivered.' }), 25000), '"Refresh status" → "Steadfast says: Delivered."')
    log(sf.statusCalls.slice(asked).includes(shipment.courier.consignment_id), `the API asked status_by_cid/${shipment.courier.consignment_id}`)
    const after = await orderOf(orderC)
    log(after?.status === 'delivered' && after?.payment_status === 'paid' && (after?.invoices ?? []).length >= 1, `${orderC}: delivered, ${after?.payment_status} and invoiced (the booked cash collected)`)
    log(await visible(card.getByText(/checked with the courier/)), 'the tracking history says "checked with the courier"')
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
  await attempt('courier settings', async () => {
    if (!saved.courierSettings) return
    const answer = await admin$('/couriers/settings', { method: 'PUT', body: saved.courierSettings })
    if (answer.status !== 200) throw new Error(`PUT couriers/settings answered ${answer.status} ${JSON.stringify(answer.body?.errors ?? answer.body?.message)}`)
  })
  await attempt('default country', async () => {
    if (saved.defaultCountry === undefined || saved.defaultCountry === 'Bangladesh') return
    const answer = await admin$('/settings', { method: 'PATCH', body: { checkout: { default_country: saved.defaultCountry } } })
    if (answer.status !== 200) throw new Error(`PATCH settings answered ${answer.status} ${JSON.stringify(answer.body?.errors ?? answer.body?.message)}`)
  })
  await attempt('orders grid columns', async () => {
    if (saved.gridPrefs === undefined) return
    if (saved.gridPrefs === null) tinker("App\\Models\\AdminPreference::where('key', 'orders_grid')->where('admin_id', App\\Models\\Admin::where('email', 'admin@buynest.test')->value('id'))->delete();")
    else await admin$('/preferences/orders_grid', { method: 'PUT', body: { value: saved.gridPrefs } })
  })
  const numbers = [...made.orders].filter(Boolean)
  await attempt('test orders', async () => {
    // Orders still waiting (D, or any a failed part left) are cancelled; shipped ones move on to Delivered so the customer can be deleted.
    for (const number of numbers) {
      const order = (await admin$(`/orders/${number}`)).body?.data
      if (!order) continue
      if (order.status === 'pending_payment' || order.status === 'processing') await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
      else if (order.status === 'shipped') await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'delivered', notify_customer: false } })
    }
  })
  await attempt('the throwaway customer', async () => {
    if (!made.customerId) return
    const deleted = await admin$(`/customers/${made.customerId}`, { method: 'DELETE' })
    if (deleted.status !== 204) throw new Error(`DELETE customer answered ${deleted.status} ${JSON.stringify(deleted.body?.errors ?? deleted.body?.message)}`)
  })
  await attempt('notifications and courier caches', () => {
    const links = numbers.map((number) => `'/orders/${number}'`).join(',')
    tinker(
      (numbers.length
        ? `$ids = App\\Models\\AdminNotification::where('type', 'courier_update')->whereIn('link', [${links}])->pluck('id'); DB::table('admin_notification_reads')->whereIn('notification_id', $ids)->delete(); App\\Models\\AdminNotification::whereIn('id', $ids)->delete();`
        : '') +
        " Cache::forget('couriers.pathao.token'); Cache::forget('couriers.pathao.cities'); Cache::forget('couriers.steadfast.balance');" +
        ` foreach ([${Object.keys(PATHAO_ZONES).join(', ')}] as $c) { Cache::forget("couriers.pathao.zones.$c"); }` +
        ` foreach ([${Object.keys(PATHAO_AREAS).join(', ')}] as $z) { Cache::forget("couriers.pathao.areas.$z"); }`,
    )
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  const settingsNow = (await admin$('/couriers')).body?.settings
  const countryNow = (await admin$('/settings')).body?.data?.checkout?.default_country ?? null
  const settingsBack = (!saved.courierSettings || JSON.stringify(settingsNow) === JSON.stringify(saved.courierSettings)) && (saved.defaultCountry === undefined || countryNow === saved.defaultCountry)
  const open = []
  for (const number of numbers) if (['pending_payment', 'processing', 'shipped'].includes((await orderOf(number))?.status)) open.push(number)
  const leftCustomer = ((await admin$(`/customers?search=${encodeURIComponent(customer.email)}`)).body?.data ?? []).length
  const prefsNow = (await admin$('/preferences/orders_grid')).body?.data?.value ?? null
  const prefsBack = saved.gridPrefs === undefined || JSON.stringify(prefsNow) === JSON.stringify(saved.gridPrefs)
  const cached = tinker("echo json_encode([Cache::has('couriers.pathao.token'), Cache::has('couriers.pathao.cities'), Cache::has('couriers.steadfast.balance')]);")
  const cacheClear = cached.includes('[false,false,false]')
  log(
    problems.length === 0 && settingsBack && open.length === 0 && leftCustomer === 0 && prefsBack && cacheClear,
    `cleanup: courier settings back to ${JSON.stringify(saved.courierSettings)} and the default country to ${JSON.stringify(saved.defaultCountry)}, the Owner's orders grid columns as before, open test orders cancelled, the throwaway customer deleted, courier caches forgotten, stock put back (orders A–C, shipments, invoices stay)${problems.length || !settingsBack || open.length || leftCustomer || !prefsBack || !cacheClear ? ` — left: ${[...problems, `settings ${JSON.stringify(settingsNow)} country ${countryNow}`, ...open, `${leftCustomer} customer`, `prefs ${JSON.stringify(prefsNow)}`, `cache ${cached}`].join('; ')}` : ''}`,
  )
}
