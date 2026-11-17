// Phase 9: launch readiness and customer self-service, in a real browser.
//   1. Two-step sign-in for admins: enrolment on Account → Two-step sign-in (the key read from the page,
//      codes made here with RFC 6238), recovery codes shown once and downloaded, the second sign-in step
//      (wrong code, right code, a recovery code once and not twice, expired and burned challenges), the
//      store requiring two-step (a second admin gets the forced-setup screen), the Owner's reset.
//   2. Resized product photos: the 320/960 copies of a large upload, srcset in the store, removed with the image.
//   3. Browser errors reach the API (path only), the store's /api/client-errors limits.
//   4. Backups: Back up now, the list, a download link (gzip), a tampered link refused, Owner only.
//   5–7. A throwaway customer (signed up in the store) changes email, cancels an order, downloads their data,
//      and deletes the account; a guest cancels through order tracking; a paid order can't be cancelled.
//   8. "Email me when it's back": guest and customer, Account → Stock alerts, the admin report and product
//      page, the emails on restock (once), the unsubscribe link.
//   9. axe on every new page and dialog, 390px layouts.
// Needs the BuyNest API (E2E_ACCOUNTS=laravel), its test inbox, php (tinker for checks and cleanup), and GD.
// The demo accounts are never changed: test admins are made through the API by the Owner and the customer
// through the store's sign-up. Everything is put back at the end (orders stay, like in the other suites).
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  SHOPPER,
  SHOPPER_2,
  adminSignIn,
  axeViolations,
  fillEmptyAddress,
  latestCode,
  launch,
  preserveStock,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('launch: two-step sign-in, photos, error reports, backups, email change, cancel, my data, stock alerts')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const BACKEND = join(import.meta.dirname, '..', 'backend')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const api = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
      body: body && JSON.stringify(body),
    })
    // A busy run can hit the API's per-minute limit: wait as asked, then retry (not the two-step answers this suite counts).
    if (response.status === 429 && attempt < 4 && !path.includes('two-factor')) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers }
  }
}
const signInApi = async (email, password) => (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email, password } })).body?.data?.tokens?.access_token
const owner = await signInApi(ADMIN_USER.email, ADMIN_USER.password)
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const adminOf = async (id) => (await admin$(`/admins/${id}`)).body?.data
const productOf = async (id) => (await admin$(`/products/${id}`)).body?.data
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const findCustomer = async (email) => ((await admin$(`/customers?search=${encodeURIComponent(email)}`)).body?.data ?? []).find((customer) => customer.email === email)
/** Runs PHP in the backend (local development only): checks and cleanup that have no endpoint. */
function tinker(code) {
  const run = spawnSync('php', ['artisan', 'tinker', `--execute=${code}`], { cwd: BACKEND, encoding: 'utf8', timeout: 60_000 })
  if (run.status !== 0) throw new Error(`tinker failed: ${(run.stderr || run.stdout).trim().slice(0, 200)}`)
  return run.stdout.trim()
}
/** The newest email to an address in the Laravel test inbox (local development only), or null. */
async function latestMail(email, { after = 0, tries = 20 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const response = await fetch(`${LARAVEL_URL}/dev/mailbox/latest?to=${encodeURIComponent(email.toLowerCase())}`)
    if (response.ok) {
      const { data } = await response.json()
      if (data.id > after) return data
    }
    await sleep(250)
  }
  return null
}
const latestMailId = async (email) => (await latestMail(email, { tries: 1 }))?.id ?? 0
/** How many emails with this subject the address got (test inbox). */
const mailCount = (email, subject) => Number(tinker(`echo App\\Models\\DevMail::where('to', '${email.toLowerCase()}')->where('subject', '${subject.replace(/'/g, "\\'")}')->count();`))

// ---------------------------------------------------------------- TOTP (RFC 6238), made here like an authenticator app
function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of text.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}
function hotp(key, counter, digits = 6) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const hash = createHmac('sha1', key).update(message).digest()
  const offset = hash[hash.length - 1] & 15
  const number = ((hash[offset] & 127) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3]
  return String(number % 10 ** digits).padStart(digits, '0')
}
const stepNow = () => Math.floor(Date.now() / 30_000)
const totp = (secret, step = stepNow()) => hotp(base32Decode(secret), step)
/** A code from a time step newer than the last one used (the API refuses a code twice): waits up to 30 s. */
async function freshCode(account) {
  while (stepNow() <= account.lastStep) await sleep(500)
  account.lastStep = stepNow()
  return totp(account.secret, account.lastStep)
}
/** A 6-digit code that isn't valid now (nor one step either side). */
function wrongCode(secret, salt = 0) {
  const valid = new Set([-2, -1, 0, 1, 2].map((offset) => totp(secret, stepNow() + offset)))
  for (let step = stepNow() + 1000 + salt; ; step++) if (!valid.has(totp(secret, step))) return totp(secret, step)
}

// ---------------------------------------------------------------- a large photo, made here
function crcTable() {
  return Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
}
const CRC = crcTable()
const crc32 = (buffer) => {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
/** A width×height RGB PNG with a gradient (so it isn't trivially small). */
function bigPng(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const pixels = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      pixels[row + 1 + x * 3] = (x * 255) / width
      pixels[row + 2 + x * 3] = (y * 255) / height
      pixels[row + 3 + x * 3] = ((x + y) * 7) & 255
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}

// ---------------------------------------------------------------- test data
const run = Date.now().toString(36)
const marker = `e2e${run}`
const owner2 = { name: 'Otto Owner', email: `owner.${marker}@buynest.test`, password: 'OttoCheck2026pass', secret: null, lastStep: 0, recovery: [] }
const viewer = { name: 'Vera Viewer', email: `viewer.${marker}@buynest.test`, password: 'VeraCheck2026pass', secret: null, lastStep: 0 }
const cleo = { firstName: 'Cleo', lastName: 'Marsh', email: `cleo.${marker}@buynest.test`, password: 'CleoCheck2026', phone: '+1 555 010 6611' }
const cleoNewEmail = `cleo.new.${marker}@buynest.test`
const guestEmail = `guest.${marker}@buynest.test`
const lampName = `E2E Launch Lamp ${marker}`
const vaseName = `E2E Launch Vase ${marker}`
const files = mkdtempSync(join(tmpdir(), 'buynest-launch-'))
const photoPath = join(files, 'lamp-large.png')
writeFileSync(photoPath, bigPng(1600, 1000))

// What this suite changes, recorded first so it can be put back
const restoreStock = await preserveStock()
const settingsBefore = (await admin$('/settings')).body?.data
const backupsBefore = new Set(((await admin$('/backups')).body?.data ?? []).map((backup) => backup.name))
const backupRunsBefore = Number(tinker("echo App\\Models\\BackupRun::max('id') ?? 0;")) || 0
const made = { admins: [], products: [], orders: [], ownerToken: null }

const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const status = (page, text) => page.getByRole('status').filter({ hasText: text })
async function newPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, bypassCSP: true, acceptDownloads: true })
  context.setDefaultTimeout(15000)
  return watchErrors(await context.newPage(), errors)
}
/** One part of the suite: a failure is reported and the next part still runs. */
async function part(name, body) {
  try {
    await body()
  } catch (error) {
    log(false, `${name} stopped early: ${error.message.split('\n')[0]}`)
  }
}
/** Store: adds a product from its page and closes the mini cart. */
async function addToCart(page, id) {
  await page.goto(`${BASE}/products/${id}`, { waitUntil: 'networkidle' })
  await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
  const miniCart = page.getByRole('dialog')
  if (await visible(miniCart, 3000)) {
    await page.keyboard.press('Escape')
    await miniCart.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }
}
/** Store: checkout with cash on delivery → the order number (or null). */
async function checkoutCod(page, email) {
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
  const placeOrder = page.getByRole('button', { name: /^Place order · / })
  await placeOrder.waitFor({ timeout: 20000 })
  if (email) await page.locator('[name="email"]').fill(email)
  const phone = page.locator('[name="phone"]')
  if (!(await phone.inputValue())) await phone.fill('+1 555 010 6622')
  for (const [name, value] of [['firstName', 'Cleo'], ['lastName', 'Marsh']]) {
    const input = page.locator(`[name="shipping.${name}"]`)
    if (!(await input.inputValue())) await input.fill(value)
  }
  await fillEmptyAddress(page)
  await page.getByRole('radio', { name: /Cash on delivery/ }).check()
  await placeOrder.click()
  await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
  const number = /\/order-confirmation\/(BN-\d+)/.exec(page.url())?.[1] ?? null
  if (number) made.orders.push(number)
  return number
}
/** Nothing secret in the browser's storage: no key, recovery code, challenge, or token. */
async function storageIsClean(page, secrets) {
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
  return !secrets.filter(Boolean).some((secret) => stored.includes(secret)) && !/access_?token|refresh_?token|"challenge"/i.test(stored)
}
/** The admin session's token cookies are HttpOnly (buynest_admin_session is only a "signed in" flag for the page). */
const adminCookiesHttpOnly = async (context) => {
  const cookies = await context.cookies()
  const tokens = cookies.filter((cookie) => ['buynest_admin_at', 'buynest_admin_rt'].includes(cookie.name))
  const flag = cookies.find((cookie) => cookie.name === 'buynest_admin_session')
  return tokens.length === 2 && tokens.every((cookie) => cookie.httpOnly) && (!flag || flag.value.length < 20)
}

let ownerPage // the Owner (admin@buynest.test) in the admin, until "require two-step" is turned on and off again
let lamp // the photo and order product
let vase // the sold-out product
try {
  // RFC 6238's own test vector (SHA-1, T = 59 s): this suite's codes are what an authenticator app makes.
  log(hotp(Buffer.from('12345678901234567890'), Math.floor(59 / 30), 8) === '94287082', 'TOTP helper matches the RFC 6238 test vector (94287082 at T=59)')

  ownerPage = await newPage({ width: 1440, height: 900 })
  await adminSignIn(ownerPage, ADMIN_USER)
  await ownerPage.getByRole('heading', { name: 'Overview' }).waitFor()

  // Test admins (API, as the Owner): a second Owner who sets up two-step, and a Viewer
  const roles = (await admin$('/roles')).body?.data ?? []
  for (const [account, roleName] of [
    [owner2, 'Owner'],
    [viewer, 'Viewer'],
  ]) {
    const role = roles.find((item) => item.name === roleName)
    const created = await admin$('/admins', { method: 'POST', body: { name: account.name, email: account.email, password: account.password, role_id: role?.id } })
    account.id = created.body?.data?.id ?? null
    if (account.id) made.admins.push(account.id)
    log(created.status === 201, `test admin (API): ${account.name}, ${roleName} (${created.status})`)
  }

  // Test products (API): a lamp in stock (photos, orders) and a sold-out vase (stock alerts)
  for (const [name, stock, sku] of [
    [lampName, 50, `E2E-LAMP-${run}`],
    [vaseName, 0, `E2E-VASE-${run}`],
  ]) {
    const created = await admin$('/products', { method: 'POST', body: { name, category: 'home-decoration', price: 20, stock_quantity: stock, status: 'active', sku: sku.toUpperCase(), brand: 'NestWorks' } })
    if (created.body?.data?.id) made.products.push(created.body.data.id)
    log(created.status === 201, `test product (API): ${name}, ${stock} in stock (#${created.body?.data?.id})`)
  }
  ;[lamp, vase] = made.products

  // ---------- 1. Two-step sign-in ----------
  await part('two-step sign-in', async () => {
    const page = await newPage({ width: 1440, height: 900 })
    const context = page.context()
    await adminSignIn(page, owner2)
    await page.getByRole('heading', { name: 'Overview' }).waitFor()
    await page.getByRole('link', { name: 'Two-step sign-in' }).click()
    await page.getByRole('heading', { name: 'Two-step sign-in', level: 1 }).waitFor()
    log(await visible(page.getByText('You sign in with your password only.')), 'Account → Two-step sign-in: Off')
    await axe(page, 'admin two-step sign-in (off)')

    // Set up: the key for manual entry → a code made here, like an authenticator app would
    await page.getByRole('button', { name: 'Set up two-step sign-in' }).click()
    const key = page.locator('.two-step__secret')
    await key.waitFor()
    owner2.secret = (await key.innerText()).replace(/\s+/g, '')
    log(/^[A-Z2-7]{32}$/.test(owner2.secret), `the key for manual entry is shown (32 Base32 characters, grouped: "${(await key.innerText()).slice(0, 9)}…")`)
    log(await visible(page.getByRole('img', { name: /QR code to add BuyNest Admin/ })), 'a QR code (the server\'s own SVG, as an image)')
    await axe(page, 'admin two-step setup (key and QR)')
    await page.getByLabel('6-digit code').fill(wrongCode(owner2.secret))
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click()
    log(await visible(page.getByRole('alert').filter({ hasText: "That code isn't right" })), 'setup: a wrong code is refused')
    await page.getByLabel('6-digit code').fill(await freshCode(owner2))
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click()
    const codesList = page.getByRole('list', { name: 'Recovery codes' })
    await codesList.waitFor()
    owner2.recovery = (await codesList.locator('code').allInnerTexts()).map((code) => code.trim())
    log(owner2.recovery.length === 10 && owner2.recovery.every((code) => /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(code)), `10 recovery codes shown (${owner2.recovery[0]}, …)`)
    log(await visible(page.getByText('These codes are shown only once.')), '"These codes are shown only once."')
    await axe(page, 'admin recovery codes')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download as .txt' }).click()])
    const text = readFileSync(await download.path(), 'utf8')
    log(download.suggestedFilename() === 'buynest-admin-recovery-codes.txt' && owner2.recovery.every((code) => text.includes(code)) && text.includes(owner2.email), `download: ${download.suggestedFilename()} holds all 10 codes and the account`)
    log(await page.getByRole('button', { name: 'Continue' }).isDisabled(), '"Continue" waits for "I saved my recovery codes"')
    await page.getByLabel('I saved my recovery codes').check()
    await page.getByRole('button', { name: 'Continue' }).click()
    log(await visible(status(page, 'Two-step sign-in is on.')), 'two-step is on')
    log(await visible(page.getByText('10 recovery codes left.')), '"10 recovery codes left."')
    const me = await adminOf(owner2.id)
    log(me?.two_factor_enabled === true, 'the API lists the admin with two-step on')
    log((await storageIsClean(page, [owner2.secret, ...owner2.recovery])) && (await adminCookiesHttpOnly(context)), 'nothing secret in web storage (key, recovery codes, tokens); admin cookies are HttpOnly')
    await page.setViewportSize({ width: 390, height: 844 })
    log((await sidewaysOverflow(page)) <= 0, `390px: the two-step page fits (overflow ${await sidewaysOverflow(page)}px)`)
    await page.setViewportSize({ width: 1440, height: 900 })

    // From the Overview, so signing in again lands there (not on the page signed out from).
    const signOut = async () => {
      await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Sign out' }).click()
      await page.waitForURL(/\/admin\/login/)
    }
    const secondStep = page.getByRole('heading', { name: 'Two-step sign-in', level: 1 })
    const codeField = page.getByLabel('Authentication code')
    const verify = () => page.getByRole('button', { name: 'Verify and sign in' }).click()
    const passwordStep = async () => {
      await adminSignIn(page, owner2)
      return visible(secondStep)
    }

    // The second step: wrong code, then the right one
    await signOut()
    log(await passwordStep(), 'sign in again: the password is followed by "Two-step sign-in"')
    log(await visible(page.getByText('Enter the 6-digit code from your authenticator app.')), '"Enter the 6-digit code from your authenticator app."')
    log(!(await adminCookiesHttpOnly(context)), 'no session cookies yet after the password alone')
    await axe(page, 'admin sign-in second step')
    await codeField.fill(wrongCode(owner2.secret))
    await verify()
    log(await visible(page.getByRole('alert').filter({ hasText: "That code isn't right" })), 'a wrong code is refused: "That code isn\'t right…"')
    await codeField.fill(await freshCode(owner2))
    await verify()
    log(await visible(page.getByRole('heading', { name: 'Overview' })), 'the right code signs in')
    log((await adminCookiesHttpOnly(context)) && (await storageIsClean(page, [owner2.secret, ...owner2.recovery])), 'signed in with HttpOnly cookies; nothing secret in web storage')
    const audit = (await admin$(`/audit?action=admin.signed_in&subject_type=admin&subject_id=${owner2.id}`)).body?.data ?? []
    log(audit.some((entry) => /two-step/.test(entry.description ?? entry.summary ?? JSON.stringify(entry))), 'audit: "signed in with two-step sign-in"')

    // A recovery code works once
    await signOut()
    await passwordStep()
    await page.getByRole('button', { name: 'Use a recovery code' }).click()
    await page.getByLabel('Recovery code').fill(owner2.recovery[0].toUpperCase())
    await verify()
    log(await visible(page.getByRole('heading', { name: 'Overview' })), 'a recovery code signs in (typed in capitals)')
    await signOut()
    await passwordStep()
    await page.getByRole('button', { name: 'Use a recovery code' }).click()
    await page.getByLabel('Recovery code').fill(owner2.recovery[0])
    await verify()
    log(await visible(page.getByRole('alert').filter({ hasText: "That recovery code isn't right or was already used." })), '…but not twice: "That recovery code isn\'t right or was already used."')
    await axe(page, 'admin sign-in with a recovery code')

    // 5 wrong codes burn the challenge
    await page.getByRole('button', { name: 'Back to sign in' }).click()
    await passwordStep()
    const shown = []
    for (let attempt = 1; attempt <= 5; attempt++) {
      await codeField.fill(wrongCode(owner2.secret, attempt))
      await verify()
      if (attempt < 5) {
        await page.getByRole('alert').filter({ hasText: "That code isn't right" }).waitFor().catch(() => {})
        shown.push(await codeField.isVisible())
      }
    }
    log(shown.length === 4 && shown.every(Boolean), 'wrong codes 1–4: still on the second step')
    log(await visible(page.getByRole('alert').filter({ hasText: 'Too many wrong codes. Please sign in again.' })), 'the 5th wrong code burns the sign-in: "Too many wrong codes. Please sign in again." (back to the password)')
    log(await page.getByLabel('Password').isVisible(), 'the password field is shown again')

    // The same through the API: after 5 wrong codes even the right code is refused
    const challenge = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: owner2.email, password: owner2.password } })).body?.data
    log(challenge?.two_factor_required === true && challenge.challenge?.length === 64 && !challenge.tokens, 'API: password only → two_factor_required with a 64-character challenge, no tokens')
    for (let attempt = 1; attempt <= 5; attempt++) await api('/api/admin/v1/auth/two-factor', { method: 'POST', body: { challenge: challenge?.challenge, code: wrongCode(owner2.secret, 10 + attempt) } })
    const burned = await api('/api/admin/v1/auth/two-factor', { method: 'POST', body: { challenge: challenge?.challenge, code: totp(owner2.secret) } })
    log(burned.status === 422 && Boolean(burned.body?.errors?.challenge), `API: a burned challenge refuses the right code (${burned.status}: ${burned.body?.errors?.challenge?.[0]})`)

    // An expired challenge (backdated here: 5 minutes is long to wait)
    await passwordStep()
    tinker(`App\\Models\\AdminTwoFactorChallenge::where('admin_id', ${owner2.id})->update(['expires_at' => now()->subMinute()]);`)
    await codeField.fill(totp(owner2.secret))
    await verify()
    log(await visible(page.getByRole('alert').filter({ hasText: 'This sign-in has expired. Please sign in again.' })), 'an expired challenge: "This sign-in has expired. Please sign in again."')

    // Signed in again (another recovery code: no wait for a new time step)
    await passwordStep()
    await page.getByRole('button', { name: 'Use a recovery code' }).click()
    await page.getByLabel('Recovery code').fill(owner2.recovery[1])
    await verify()
    await page.getByRole('heading', { name: 'Overview' }).waitFor()
    // The test Owner's own API token, for the API checks while the store requires two-step
    const pending = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: owner2.email, password: owner2.password } })).body?.data
    made.ownerToken = (await api('/api/admin/v1/auth/two-factor', { method: 'POST', body: { challenge: pending?.challenge, recovery_code: owner2.recovery[2].replace('-', '') } })).body?.data?.tokens?.access_token ?? null
    log(Boolean(made.ownerToken), 'API: a recovery code without its dash also works (test Owner token)')
    const otto$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: made.ownerToken, ...options })

    // The store requires two-step (Settings → Security, Owner only)
    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const security = page.getByRole('form', { name: 'Security' })
    await security.getByLabel('Require two-step sign-in for every admin').check()
    const turningOn = page.waitForResponse((response) => response.url().endsWith('/api/admin/settings') && response.request().method() === 'PATCH')
    await security.getByRole('button', { name: 'Save security' }).click()
    await turningOn
    log(await visible(security.getByRole('status').filter({ hasText: 'Security saved.' })), '"Security saved."')
    const settingsOn = (await otto$('/settings')).body?.data?.security?.require_admin_two_factor
    log(settingsOn === true, 'Settings → Security: "Require two-step sign-in for every admin" saved')
    await axe(page, 'admin settings with Security')
    const blocked = await admin$('/orders')
    log(blocked.status === 403 && blocked.body?.code === 'two_factor_setup_required', `an admin without two-step is now limited (${blocked.status} ${blocked.body?.code})`)

    // The Viewer (no two-step yet) gets the forced-setup screen
    const vera = await newPage({ width: 1280, height: 900 })
    await adminSignIn(vera, viewer)
    const gate = vera.getByRole('heading', { name: 'Set up two-step sign-in', level: 1 })
    log(await visible(gate), 'a second admin without two-step: "Set up two-step sign-in" after the password')
    await axe(vera, 'admin forced two-step setup')
    await vera.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' })
    log((await visible(gate)) && !(await vera.getByRole('heading', { name: 'Orders' }).isVisible()), "…and can't open other pages (Orders shows the setup screen)")
    const limited = await vera.evaluate(async () => {
      const response = await fetch('/api/admin/orders')
      return { status: response.status, code: (await response.json().catch(() => ({}))).code }
    })
    log(limited.status === 403 && limited.code === 'two_factor_setup_required', `the limited session's API calls are refused (${limited.status} ${limited.code})`)
    await vera.getByRole('button', { name: 'Set up two-step sign-in' }).click()
    const veraKey = vera.locator('.two-step__secret')
    await veraKey.waitFor()
    viewer.secret = (await veraKey.innerText()).replace(/\s+/g, '')
    await vera.getByLabel('6-digit code').fill(await freshCode(viewer))
    await vera.getByRole('button', { name: 'Turn on two-step sign-in' }).click()
    await vera.getByRole('list', { name: 'Recovery codes' }).waitFor()
    await vera.getByLabel('I saved my recovery codes').check()
    await vera.getByRole('button', { name: 'Continue' }).click()
    log(await visible(vera.getByRole('heading', { name: 'Orders', level: 1 })), 'after setting it up, the admin opens on the page she asked for (Orders)')
    log(!(await gate.isVisible()) && (await adminCookiesHttpOnly(vera.context())), 'the setup screen is gone; the new full session is in HttpOnly cookies')

    // 4 (Viewer part): Backups is the Owner's
    await vera.goto(`${BASE}/admin/backups`, { waitUntil: 'networkidle' })
    log(await visible(vera.getByRole('heading', { name: "You don't have access" })), 'Backups as a Viewer: "You don\'t have access"')
    log(!(await vera.getByRole('link', { name: 'Backups' }).isVisible()), 'the Viewer has no Backups link in the menu')
    const viewerBackups = await vera.evaluate(async () => (await fetch('/api/admin/backups')).status)
    log(viewerBackups === 403, `the Viewer's backups API call: ${viewerBackups}`)

    // The requirement off again
    await security.getByLabel('Require two-step sign-in for every admin').uncheck()
    const saving = page.waitForResponse((response) => response.url().endsWith('/api/admin/settings') && response.request().method() === 'PATCH')
    await security.getByRole('button', { name: 'Save security' }).click()
    await saving
    log((await admin$('/settings')).body?.data?.security?.require_admin_two_factor === false, 'the requirement is off again (the Owner without two-step is no longer limited)')

    // The Owner resets the Viewer's two-step on Admin users
    await page.goto(`${BASE}/admin/admins`, { waitUntil: 'networkidle' })
    await page.getByLabel('Search admin users').fill(viewer.email)
    await page.getByRole('search').getByRole('button', { name: 'Search' }).click()
    await page.getByRole('button', { name: `Reset two-step sign-in for ${viewer.name}` }).click()
    const dialog = page.getByRole('dialog')
    log(await visible(dialog.getByText(`Reset two-step sign-in for ${viewer.name}?`)), 'Admin users: "Reset two-step sign-in for Vera Viewer?"')
    await axe(page, 'admin reset two-step dialog')
    await dialog.getByRole('button', { name: 'Reset two-step' }).click()
    log(await visible(page.getByText(`Two-step sign-in was turned off for ${viewer.name}`)), 'reset: "Two-step sign-in was turned off for Vera Viewer…"')
    const veraNow = await adminOf(viewer.id)
    log(veraNow?.two_factor_enabled === false, 'the API shows her two-step off')
    await vera.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
    log(/\/admin\/login/.test(vera.url()) || (await visible(vera.getByLabel('Password'), 5000)), 'and she was signed out everywhere')
    await vera.context().close()
    await page.context().close()
  })

  // Whatever happened above, the requirement is off before the Owner (no two-step) carries on.
  if ((await admin$('/settings')).status === 403) {
    if (made.ownerToken) await api('/api/admin/v1/settings', { method: 'PATCH', token: made.ownerToken, body: { security: { require_admin_two_factor: false } } })
    else tinker("app(App\\Services\\Settings::class)->put(['require_admin_two_factor' => false]);")
  }

  // ---------- 4. Backups (the Owner) ----------
  await part('backups', async () => {
    const page = ownerPage
    await page.goto(`${BASE}/admin/backups`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Backups' }).waitFor()
    log(await visible(page.getByRole('link', { name: 'Backups' })), 'System → Backups is in the Owner\'s menu')
    await page.getByRole('button', { name: 'Back up now' }).click()
    const ready = page.getByRole('status').filter({ hasText: /Backup buynest-\d{8}-\d{6}\.sql\.gz is ready\./ })
    log(await visible(ready, 180000), `"Back up now": ${(await ready.innerText().catch(() => '')).trim()}`)
    const name = (await ready.innerText().catch(() => '')).match(/buynest-\d{8}-\d{6}\.sql\.gz/)?.[0]
    log(Boolean(name) && (await visible(page.getByRole('rowheader', { name }))), `the list shows ${name}`)
    await axe(page, 'admin backups')
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: `Download ${name}` }).click()])
    const bytes = readFileSync(await download.path())
    log(download.suggestedFilename() === name && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes.length > 100, `download: ${download.suggestedFilename()}, ${bytes.length} bytes, gzip (1f 8b)`)
    log(await visible(status(page, `Downloading ${name}. The link works for 5 minutes.`)), '"The link works for 5 minutes."')
    const links = await page.evaluate(async (file) => {
      const { url } = await (await fetch(`/api/admin/backups/${file}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
      const tampered = url.replace(/signature=([a-f0-9]+)/, (_, sig) => `signature=${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`)
      const later = url.replace(/expires=(\d+)/, (_, expires) => `expires=${Number(expires) + 3600}`)
      return { url, tampered: (await fetch(tampered)).status, later: (await fetch(later)).status, real: (await fetch(url)).status }
    }, name)
    log(/^\/api\/admin\/backups\/buynest-.*\/file\?expires=\d+&signature=[a-f0-9]{64}$/.test(links.url) && links.real === 200, `a fresh link works (${links.real})`)
    log(links.tampered === 403 && links.later === 403, `a tampered link is refused (signature changed: ${links.tampered}, expiry moved: ${links.later})`)
    const direct = await admin$(`/backups/${name}/download?expires=${Math.floor(Date.now() / 1000) + 300}&signature=${'0'.repeat(64)}`)
    log(direct.status === 403, `the API refuses a made-up signature (${direct.status})`)
    const audit = (await admin$('/audit?action=backup.downloaded')).body?.data ?? []
    log(audit.length > 0, 'audit: backup.downloaded')
    await page.setViewportSize({ width: 390, height: 844 })
    log((await sidewaysOverflow(page)) <= 0, `390px: Backups fits (overflow ${await sidewaysOverflow(page)}px)`)
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  // ---------- 2. Resized product photos ----------
  await part('photos', async () => {
    const page = ownerPage
    await page.goto(`${BASE}/admin/products/${lamp}`, { waitUntil: 'networkidle' })
    const images = page.locator('section[aria-labelledby="images-title"]')
    await images.locator('input[type="file"]').setInputFiles(photoPath)
    await images.getByRole('button', { name: 'Upload 1 image' }).click()
    log(await visible(images.getByRole('status').filter({ hasText: '1 image uploaded.' })), 'a 1600×1000 PNG uploaded in the admin')
    const image = (await productOf(lamp))?.images?.[0]
    const [hex] = /[a-f0-9]{32}/.exec(image?.url ?? '') ?? []
    const variants = image?.variants ?? {}
    const pattern = (width) => new RegExp(`^/media/products/${lamp}/${hex}-${width}\\.(webp|png)$`)
    log(Boolean(hex) && pattern(320).test(variants['320'] ?? '') && pattern(960).test(variants['960'] ?? ''), `the 320 and 960 copies exist (${variants['320']}, ${variants['960']})`)
    const product = (await api(`/api/v1/products/${lamp}`)).body?.data
    log(product?.thumbnail_variants?.['320'] === variants['320'] && product?.images?.[0]?.variants?.['960'] === variants['960'], 'the store API sends thumbnail_variants and image variants')
    const onDisk = (url) => join(BACKEND, 'storage', 'app', 'public', url.replace(/^\/media\//, ''))
    log([variants['320'], variants['960']].every((url) => url && existsSync(onDisk(url))), 'both copies are on disk next to the original')

    // The store: the card (search) and the gallery use srcset
    const shop = await newPage()
    await shop.goto(`${BASE}/products?q=${encodeURIComponent(marker)}`, { waitUntil: 'networkidle' })
    const card = shop.locator('.product-card').filter({ hasText: lampName }).locator('.product-card__media img')
    await card.scrollIntoViewIfNeeded().catch(() => {})
    const cardSrcset = (await card.getAttribute('srcset').catch(() => null)) ?? ''
    log(cardSrcset.includes(`${variants['320']} 320w`) && cardSrcset.includes(`${variants['960']} 960w`) && Boolean(await card.getAttribute('sizes')), `the product card's srcset lists the copies ("${cardSrcset.slice(0, 80)}…")`)
    await shop.waitForFunction((selector) => document.querySelector(selector)?.complete, '.product-card__media img').catch(() => {})
    const cardLoaded = await card.evaluate((img) => img.complete && img.naturalWidth > 0 && /-(320|960)\./.test(img.currentSrc))
    log(cardLoaded, `the card loads a resized copy (${await card.evaluate((img) => img.currentSrc.replace(location.origin, ''))})`)
    await shop.goto(`${BASE}/products/${lamp}`, { waitUntil: 'networkidle' })
    const gallery = shop.locator(`.product-details img[srcset*="${variants['960']}"]`).first()
    log(await visible(gallery), 'the product gallery uses srcset with the 960 copy')
    for (const url of [variants['320'], variants['960']]) {
      const response = await shop.request.get(`${BASE}${url}`)
      log(response.status() === 200 && /^image\//.test(response.headers()['content-type'] ?? ''), `${url} loads (${response.status()}, ${response.headers()['content-type']})`)
    }
    await shop.context().close()

    // Deleting the image removes the copies
    await images.getByRole('button', { name: 'Delete image 1' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete image' }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => {})
    await sleep(500)
    const gone = [image.url, variants['320'], variants['960']].every((url) => !existsSync(onDisk(url)))
    const media = await fetch(`${BASE}${variants['960']}`)
    log(gone && media.status === 404 && ((await productOf(lamp))?.images ?? []).length === 0, `deleting the image removes the original and both copies (/media answers ${media.status})`)
  })

  // ---------- 3. Browser errors reach the API ----------
  await part('error reports', async () => {
    const logFile = join(BACKEND, 'storage', 'logs', 'laravel.log')
    const logLine = async (text) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const line = readFileSync(logFile, 'utf8').split('\n').reverse().find((row) => row.includes(text))
        if (line) return line
        await sleep(250)
      }
      return null
    }
    const shop = await newPage()
    await shop.goto(`${BASE}/products?e2e_token=hush${run}`, { waitUntil: 'networkidle' })
    const storeMessage = `e2e-launch-store-${run}`
    await shop.evaluate((message) => setTimeout(() => { throw new Error(message) }), storeMessage)
    const storeLine = await logLine(storeMessage)
    log(Boolean(storeLine) && storeLine.includes('Browser error (store) on /products:') && !storeLine.includes(`hush${run}`), `a store error reached the API, path only: "${storeLine?.match(/Browser error[^{]*/)?.[0]?.slice(0, 90)}"`)
    await shop.context().close()

    const adminMessage = `e2e-launch-admin-${run}`
    await ownerPage.goto(`${BASE}/admin/orders?search=hush${run}`, { waitUntil: 'networkidle' })
    await ownerPage.evaluate((message) => setTimeout(() => { throw new Error(message) }), adminMessage)
    const adminLine = await logLine(adminMessage)
    log(Boolean(adminLine) && adminLine.includes('Browser error (admin) on /admin/orders:') && !adminLine.includes(`hush${run}`), `an admin error reached the API, path only: "${adminLine?.match(/Browser error[^{]*/)?.[0]?.slice(0, 90)}"`)

    // The store's /api/client-errors: 413 for a big body, otherwise always 202
    const post = (body) => fetch(`${BASE}/api/client-errors`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    const huge = await post({ message: 'e2e-launch-huge', app: 'store', url: '/', stack: 'x'.repeat(20000) })
    log(huge.status === 413, `an oversized report (20 KB) is refused: ${huge.status}`)
    const statuses = []
    for (let n = 0; n < 12; n++) statuses.push((await post({ message: `e2e-launch-flood-${run}-${n % 3}`, app: 'store', url: `/x?token=${run}` })).status)
    log(statuses.every((code) => code === 202), `12 reports in a row (repeats and over the limit) all answer 202 (${[...new Set(statuses)].join(',')})`)
    const direct = await api('/api/v1/client-errors', { method: 'POST', body: { message: 'e2e-launch-direct', app: 'store' } })
    log(direct.status === 403 && direct.body?.code === 'store_only', `the API refuses reports that don't come through the store (${direct.status} ${direct.body?.code})`)
  })

  // ---------- A throwaway customer: the real sign-up ----------
  const cleoPage = await newPage()
  await cleoPage.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  await cleoPage.getByLabel('First name').fill(cleo.firstName)
  await cleoPage.getByLabel('Last name').fill(cleo.lastName)
  await cleoPage.getByLabel('Email').fill(cleo.email)
  await cleoPage.getByLabel('Phone number').fill(cleo.phone)
  await cleoPage.getByLabel('Password', { exact: true }).fill(cleo.password)
  await cleoPage.getByLabel('Confirm password').fill(cleo.password)
  await cleoPage.getByLabel(/I agree to the terms/).check()
  await cleoPage.getByRole('button', { name: 'Create account' }).click()
  await cleoPage.getByRole('heading', { name: 'Check your email' }).waitFor()
  await cleoPage.getByLabel('6-digit code').fill((await latestCode(cleo.email)).code)
  await cleoPage.getByRole('button', { name: 'Confirm and sign in' }).click()
  log(await visible(cleoPage.getByRole('heading', { name: /Hi, Cleo/ })), `a throwaway customer signed up in the store (${cleo.email})`)

  // ---------- 8. Stock alerts ----------
  await part('stock alerts', async () => {
    const guest = await newPage()
    const askAsGuest = async () => {
      await guest.goto(`${BASE}/products/${vase}`, { waitUntil: 'networkidle' })
      const form = guest.locator('section.stock-alert')
      await form.getByLabel('Your email').fill(guestEmail)
      await form.getByRole('button', { name: "Email me when it's back" }).click()
      return (await visible(form.getByRole('status').filter({ hasText: "We'll email you when it's back in stock." }))) ? (await form.getByRole('status').innerText()).trim() : null
    }
    await guest.goto(`${BASE}/products/${vase}`, { waitUntil: 'networkidle' })
    log(await visible(guest.getByRole('heading', { name: 'Sold out for now' })), 'a sold-out product page: "Sold out for now" with "Email me when it\'s back"')
    await axe(guest, 'store product page with the stock alert form')
    const first = await askAsGuest()
    const again = await askAsGuest()
    log(Boolean(first) && first === again, `a guest asks twice: the same message both times ("${first}")`)
    const apiAnswers = await Promise.all([guestEmail, `nobody.${marker}@buynest.test`].map((email) => api(`/api/v1/products/${vase}/stock-alerts`, { method: 'POST', body: { email } })))
    log(apiAnswers.every((answer) => answer.status === 202) && apiAnswers[0].body?.data?.message === apiAnswers[1].body?.data?.message, `API: listed and new addresses get the same 202 answer ("${apiAnswers[0].body?.data?.message}")`)
    tinker(`App\\Models\\StockAlert::where('email', 'nobody.${marker}@buynest.test')->delete();`)
    const inStock = await api(`/api/v1/products/${lamp}/stock-alerts`, { method: 'POST', body: { email: guestEmail } })
    log(inStock.status === 422 && Boolean(inStock.body?.errors?.stock), `an in-stock product is refused (${inStock.status}: ${inStock.body?.errors?.stock?.[0]})`)

    // Signed in: the account's email, no field
    await cleoPage.goto(`${BASE}/products/${vase}`, { waitUntil: 'networkidle' })
    const form = cleoPage.locator('section.stock-alert')
    log((await form.getByLabel('Your email').count()) === 0, 'signed in: no email field (the account email is used)')
    await form.getByRole('button', { name: "Email me when it's back" }).click()
    const signedIn = (await visible(form.getByRole('status').filter({ hasText: "We'll email you" }))) ? (await form.getByRole('status').innerText()).trim() : null
    await cleoPage.reload({ waitUntil: 'networkidle' })
    await form.getByRole('button', { name: "Email me when it's back" }).click()
    const signedInAgain = (await visible(form.getByRole('status').filter({ hasText: "We'll email you" }))) ? (await form.getByRole('status').innerText()).trim() : null
    log(signedIn === first && signedInAgain === first, 'the signed-in customer gets the same message, twice')
    const waiting = Number(tinker(`echo App\\Models\\StockAlert::where('product_id', ${vase})->whereNull('notified_at')->count();`))
    log(waiting === 2, `one waiting alert each, however often they asked (${waiting})`)

    await cleoPage.goto(`${BASE}/account/stock-alerts`, { waitUntil: 'networkidle' })
    log(await visible(cleoPage.getByRole('link', { name: vaseName })), 'Account → Stock alerts lists the product')
    await axe(cleoPage, 'store account stock alerts')
    await cleoPage.setViewportSize({ width: 390, height: 844 })
    log((await sidewaysOverflow(cleoPage)) <= 0, `390px: Stock alerts fits (overflow ${await sidewaysOverflow(cleoPage)}px)`)
    await cleoPage.setViewportSize({ width: 1280, height: 900 })

    // The admin: Reports → Stock alerts, and the product page
    await ownerPage.goto(`${BASE}/admin/reports`, { waitUntil: 'networkidle' })
    const panel = ownerPage.locator('section').filter({ has: ownerPage.getByRole('heading', { name: 'Stock alerts', exact: true }) }).last()
    const row = panel.getByRole('row').filter({ hasText: vaseName })
    log((await visible(row)) && (await row.locator('td.table__number').last().innerText()).trim() === '2', `Reports → Stock alerts: ${vaseName} with 2 waiting`)
    await axe(ownerPage, 'admin reports with stock alerts')
    await ownerPage.goto(`${BASE}/admin/products/${vase}`, { waitUntil: 'networkidle' })
    log(await visible(ownerPage.getByText('2 shoppers are waiting')), 'the product page: "2 shoppers are waiting"')

    // Restock in the admin: the emails go out once
    const subject = `${vaseName} is back in stock`
    const restock = async (units) => {
      await ownerPage.goto(`${BASE}/admin/products/${vase}`, { waitUntil: 'networkidle' })
      await ownerPage.getByLabel('Units in stock').fill(String(units))
      await ownerPage.getByRole('button', { name: 'Save changes' }).click()
      for (let attempt = 0; attempt < 40 && (await productOf(vase))?.stock_quantity !== units; attempt++) await sleep(250)
    }
    await restock(10)
    await latestMail(guestEmail, { tries: 20 })
    const sent = [mailCount(guestEmail, subject), mailCount(cleo.email, subject)]
    log(sent[0] === 1 && sent[1] === 1, `restocked to 10 in the admin: "${subject}" sent to the guest and the customer (${sent.join(', ')})`)
    await restock(12)
    await sleep(500)
    const sentAgain = [mailCount(guestEmail, subject), mailCount(cleo.email, subject)]
    log(sentAgain[0] === 1 && sentAgain[1] === 1, `another stock change sends nothing more (${sentAgain.join(', ')})`)
    const notified = Number(tinker(`echo App\\Models\\StockAlert::where('product_id', ${vase})->whereNotNull('notified_at')->count();`))
    log(notified === 2, `both alerts are marked notified (${notified})`)
    const reportAfter = (await admin$(`/reports/stock-alerts?q=${encodeURIComponent(marker)}`)).body?.data ?? []
    log(reportAfter.length === 0, 'the report no longer lists the product')
    const mail = await latestMail(guestEmail, { tries: 1 })
    const link = mail?.text?.match(/https?:\/\/[^\s"<>]*\/stock-alerts\/unsubscribe\?token=[^\s"<>)\]]+/)?.[0]
    log(Boolean(link) && /List-Unsubscribe/i.test(JSON.stringify(mail?.headers ?? {})), `the email has a "stop these alerts" link and a List-Unsubscribe header`)

    // The unsubscribe link: sold out again, the guest asks again, then stops every waiting alert
    await admin$(`/products/${vase}`, { method: 'PATCH', body: { stock_quantity: 0 } })
    await api(`/api/v1/products/${vase}/stock-alerts`, { method: 'POST', body: { email: guestEmail } })
    const token = new URL(link).searchParams.get('token')
    await guest.goto(`${BASE}/stock-alerts/unsubscribe?token=${encodeURIComponent(token)}`, { waitUntil: 'networkidle' })
    await axe(guest, 'store stop back-in-stock emails')
    await guest.getByRole('button', { name: 'Stop these emails' }).click()
    log(await visible(guest.getByRole('status').filter({ hasText: "You won't get any more back-in-stock emails for these products." })), 'the unsubscribe page: "You won\'t get any more back-in-stock emails…"')
    const left = Number(tinker(`echo App\\Models\\StockAlert::where('email', '${guestEmail}')->whereNull('notified_at')->count();`))
    log(left === 0, `the guest's waiting alert is gone (${left})`)
    await guest.goto(`${BASE}/stock-alerts/unsubscribe?token=1.${'x'.repeat(40)}`, { waitUntil: 'networkidle' })
    await guest.getByRole('button', { name: 'Stop these emails' }).click()
    log(await visible(guest.getByRole('alert').filter({ hasText: "This link isn't valid" })), 'a made-up link: "This link isn\'t valid…"')
    await guest.context().close()
  })

  // ---------- 5. Change email ----------
  const cleoOther = await newPage()
  await part('change email', async () => {
    await storefrontSignIn(cleoOther, cleo)
    log(await visible(cleoOther.getByRole('heading', { name: /Hi, Cleo/ })), 'the customer is also signed in on a second device')
    await cleoPage.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    const section = cleoPage.locator('section.change-email')
    await section.getByRole('button', { name: 'Change email' }).click()
    const request = cleoPage.getByRole('form', { name: 'Change your email' })
    await request.getByLabel('New email').fill(SHOPPER.email)
    await request.getByLabel('Current password').fill(cleo.password)
    await request.getByRole('button', { name: 'Send code' }).click()
    log(await visible(request.getByText('An account with this email already exists.')), "another customer's email: the sign-up answer (\"An account with this email already exists…\")")
    await request.getByLabel('New email').fill(cleoNewEmail)
    await request.getByLabel('Current password').fill('WrongPass2026')
    await request.getByRole('button', { name: 'Send code' }).click()
    log(await visible(request.getByText('Your password is incorrect.')), 'a wrong password is refused')
    await axe(cleoPage, 'store change email (step 1)')
    const before = await latestMailId(cleoNewEmail)
    await request.getByLabel('Current password').fill(cleo.password)
    await request.getByRole('button', { name: 'Send code' }).click()
    const confirm = cleoPage.getByRole('form', { name: 'Confirm your new email' })
    await confirm.waitFor()
    log(await visible(confirm.getByText(cleoNewEmail)), 'step 2: "Enter the 6-digit code we sent to" the new address')
    const code = await latestCode(cleoNewEmail, { after: before })
    log(/Confirm your new email/.test(code.subject), `the code went to the NEW address ("${code.subject}")`)
    log((await findCustomer(cleo.email))?.email === cleo.email, 'the account keeps the old email until the code is entered')
    await axe(cleoPage, 'store change email (step 2)')
    await confirm.getByLabel('Code').fill(String((Number(code.code) + 1) % 1_000_000).padStart(6, '0'))
    await confirm.getByRole('button', { name: 'Confirm new email' }).click()
    log(await visible(confirm.getByText('That code is incorrect or has expired.')), 'a wrong code is refused')
    const oldBefore = await latestMailId(cleo.email)
    await confirm.getByLabel('Code').fill(code.code)
    await confirm.getByRole('button', { name: 'Confirm new email' }).click()
    log(await visible(status(cleoPage, `Your email is now ${cleoNewEmail}.`)), `"Your email is now ${cleoNewEmail}."`)
    const notice = await latestMail(cleo.email, { after: oldBefore })
    log(notice?.subject === 'Your BuyNest email was changed' && notice.text.includes(cleoNewEmail), `the old address got "${notice?.subject}"`)
    await cleoOther.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    await cleoOther.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {})
    log(/\/login/.test(cleoOther.url()), 'the other device was signed out')
    await cleoPage.reload({ waitUntil: 'networkidle' })
    log(await visible(cleoPage.getByRole('heading', { name: /Hi, Cleo/ })), 'this device stays signed in')
    const oldLogin = await api('/api/v1/auth/login', { method: 'POST', body: { email: cleo.email, password: cleo.password } })
    log(oldLogin.status !== 200, `the old email no longer signs in (${oldLogin.status})`)
    cleo.email = cleoNewEmail
    await storefrontSignIn(cleoOther, cleo)
    log(await visible(cleoOther.getByRole('heading', { name: /Hi, Cleo/ })), 'the new email signs in')
    await cleoPage.setViewportSize({ width: 390, height: 844 })
    log((await sidewaysOverflow(cleoPage)) <= 0, `390px: Profile with "Change email" fits (overflow ${await sidewaysOverflow(cleoPage)}px)`)
    await cleoPage.setViewportSize({ width: 1280, height: 900 })
  })

  // ---------- 6 and 7. Cancel an order; my data; delete my account ----------
  await part('cancel order and privacy', async () => {
    const stock = async () => (await productOf(lamp))?.stock_quantity
    const stockStart = await stock()
    await addToCart(cleoPage, lamp)
    const number = await checkoutCod(cleoPage)
    log(Boolean(number) && (await stock()) === stockStart - 1, `the customer places a cash-on-delivery order (${number}, stock ${stockStart} → ${await stock()})`)
    log(await visible(cleoPage.getByRole('button', { name: 'Cancel order' })), 'the confirmation page offers "Cancel order"')

    // Privacy: my data, and deletion refused while the order is open
    await cleoPage.goto(`${BASE}/account/privacy`, { waitUntil: 'networkidle' })
    await axe(cleoPage, 'store privacy page')
    const [download] = await Promise.all([cleoPage.waitForEvent('download'), cleoPage.getByRole('button', { name: 'Download my data' }).click()])
    const raw = readFileSync(await download.path(), 'utf8')
    const data = JSON.parse(raw)
    const sections = ['exported_at', 'profile', 'newsletter', 'addresses', 'orders', 'reviews', 'saved_cart', 'stock_alerts']
    log(/^buynest-my-data-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()) && sections.every((key) => key in data), `Download my data: ${download.suggestedFilename()} with ${sections.join(', ')}`)
    log(data.profile?.email === cleo.email && data.orders?.some((order) => order.number === number) && data.stock_alerts?.some((alert) => alert.product === vaseName), 'it holds her profile, her order, and her stock alert')
    const hasIds = (value) => (Array.isArray(value) ? value.some(hasIds) : value && typeof value === 'object' ? Object.entries(value).some(([key, inner]) => key === 'id' || key.endsWith('_id') || hasIds(inner)) : false)
    log(![SHOPPER.email, SHOPPER_2.email, guestEmail, ADMIN_USER.email].some((email) => raw.includes(email)) && !hasIds(data), 'no other customer\'s or staff data, and no database ids')
    log(await visible(status(cleoPage, `Your file ${download.suggestedFilename()} was downloaded.`)), '"Your file … was downloaded."')

    const deleteForm = cleoPage.getByRole('form', { name: 'Delete my account' })
    await deleteForm.getByLabel('Your password').fill(cleo.password)
    await deleteForm.getByLabel('Type DELETE to confirm').fill('delete')
    await deleteForm.getByRole('button', { name: 'Delete my account' }).click()
    log(await visible(deleteForm.getByText('Type DELETE to confirm.')), 'deletion needs DELETE typed exactly')
    await deleteForm.getByLabel('Type DELETE to confirm').fill('DELETE')
    await deleteForm.getByRole('button', { name: 'Delete my account' }).click()
    log(await visible(deleteForm.getByRole('alert').filter({ hasText: 'You have 1 open order' })), 'refused while an order is open: "You have 1 open order…"')
    await cleoPage.setViewportSize({ width: 390, height: 844 })
    log((await sidewaysOverflow(cleoPage)) <= 0, `390px: Privacy fits (overflow ${await sidewaysOverflow(cleoPage)}px)`)
    await cleoPage.setViewportSize({ width: 1280, height: 900 })

    // Cancel it on the account order page
    const mailBefore = await latestMailId(cleo.email)
    await cleoPage.goto(`${BASE}/account/orders/${number}`, { waitUntil: 'networkidle' })
    await cleoPage.getByRole('button', { name: 'Cancel order' }).click()
    const dialog = cleoPage.getByRole('dialog', { name: `Cancel order ${number}?` })
    log(await visible(dialog), `the dialog asks "Cancel order ${number}?"`)
    await axe(cleoPage, 'store cancel order dialog')
    await dialog.getByRole('button', { name: 'Keep my order' }).click()
    log((await orderOf(number))?.status !== 'cancelled', '"Keep my order" changes nothing')
    await cleoPage.getByRole('button', { name: 'Cancel order' }).click()
    await dialog.getByLabel(/Why are you cancelling/).fill('Ordered by mistake')
    await dialog.getByRole('button', { name: 'Yes, cancel it' }).click()
    log(await visible(status(cleoPage, `Order ${number} was cancelled.`)), `"Order ${number} was cancelled. We've emailed you a confirmation."`)
    const cancelled = await orderOf(number)
    log(cancelled?.status === 'cancelled' && (await stock()) === stockStart, `cancelled, and the stock is back (${await stock()})`)
    log((cancelled?.history ?? []).some((entry) => /Cancelled by the customer\. Reason: Ordered by mistake/.test(entry.note ?? entry.comment ?? '')), 'history: "Cancelled by the customer. Reason: Ordered by mistake"')
    const again = await api(`/api/v1/orders/${number}/cancel`, { method: 'POST', body: { email: cleo.email } })
    log(again.status === 422 && (await stock()) === stockStart, `cancelling again: ${again.status} "${again.body?.errors?.order?.[0]}", the stock came back once`)
    const cancelMail = await latestMail(cleo.email, { after: mailBefore })
    log(cancelMail?.subject === `Your order was cancelled (${number})`, `email: "${cancelMail?.subject}"`)

    // A guest cancels through order tracking; a paid order can't be cancelled online
    const guest = await newPage()
    const guestOrder = async () => {
      await addToCart(guest, lamp)
      return checkoutCod(guest, guestEmail)
    }
    const g1 = await guestOrder()
    const track = async (orderNumber) => {
      await guest.goto(`${BASE}/track-order`, { waitUntil: 'networkidle' })
      await guest.getByLabel('Order number').fill(orderNumber)
      await guest.getByLabel('Email').fill(guestEmail.toUpperCase())
      await guest.getByRole('button', { name: 'Find my order' }).click()
      await guest.getByRole('heading', { name: `Order ${orderNumber}` }).waitFor()
    }
    await track(g1)
    await axe(guest, 'store order tracking with Cancel order')
    await guest.getByRole('button', { name: 'Cancel order' }).click()
    await guest.getByRole('dialog').getByRole('button', { name: 'Yes, cancel it' }).click()
    log((await visible(status(guest, `Order ${g1} was cancelled.`))) && (await orderOf(g1))?.status === 'cancelled', `a guest cancels ${g1} through order tracking with the order's email`)
    log((await stock()) === stockStart, 'the stock is back again')
    const g2 = await guestOrder()
    await track(g2)
    await guest.getByRole('button', { name: 'Cancel order' }).click()
    const paidDialog = guest.getByRole('dialog')
    await paidDialog.waitFor()
    // Paid while the dialog is open (staff invoice it)
    const invoiced = await admin$(`/orders/${g2}/invoices`, { method: 'POST', body: { notify_customer: false } })
    await paidDialog.getByRole('button', { name: 'Yes, cancel it' }).click()
    const refusal = paidDialog.getByRole('alert').filter({ hasText: 'Contact us to cancel it' })
    log(invoiced.status === 201 && (await visible(refusal)), `a paid (invoiced) order: "${(await refusal.innerText().catch(() => '')).trim().slice(0, 90)}…"`)
    log((await orderOf(g2))?.status !== 'cancelled', 'and it is not cancelled')
    await paidDialog.getByRole('button', { name: 'Keep my order' }).click()
    await track(g2)
    log(!(await guest.getByRole('button', { name: 'Cancel order' }).isVisible()), 'looked up again, the paid order offers no "Cancel order"')
    await guest.context().close()

    // Delete my account (no open order now)
    const deletedBefore = await latestMailId(cleo.email)
    await cleoPage.goto(`${BASE}/account/privacy`, { waitUntil: 'networkidle' })
    await deleteForm.getByLabel('Your password').fill('WrongPass2026')
    await deleteForm.getByLabel('Type DELETE to confirm').fill('DELETE')
    await deleteForm.getByRole('button', { name: 'Delete my account' }).click()
    log(await visible(deleteForm.getByText('Your password is incorrect.')), 'a wrong password is refused')
    await deleteForm.getByLabel('Your password').fill(cleo.password)
    await deleteForm.getByRole('button', { name: 'Delete my account' }).click()
    log(await visible(cleoPage.getByRole('heading', { name: 'Your account was deleted' })), 'deleted: the goodbye page')
    await axe(cleoPage, 'store goodbye page')
    log(await visible(cleoPage.locator('.site-header').getByRole('link', { name: /sign in/i })), 'signed out (the header offers Sign in)')
    const goodbye = await latestMail(cleo.email, { after: deletedBefore })
    log(goodbye?.subject === 'Your BuyNest account was deleted', `email: "${goodbye?.subject}"`)
    log(!(await findCustomer(cleo.email)) && (await orderOf(number))?.number === number, 'the account is gone; the order stays')
    await cleoOther.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    log(/\/login/.test(cleoOther.url()), 'the other device is signed out too')
    await cleoOther.getByLabel('Email').fill(cleo.email)
    await cleoOther.getByLabel('Password', { exact: true }).fill(cleo.password)
    await cleoOther.getByRole('button', { name: /^sign in$/i }).click()
    log(await visible(cleoOther.getByRole('alert')), "the deleted account can't sign in")
  })
  await cleoOther.context().close()
  await cleoPage.context().close()
} catch (error) {
  log(false, `the suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  // Put everything back: the require setting, test admins (two-step off, deactivated), the customer, stock
  // alerts, test products, backups and their runs, notifications, stock. Orders stay.
  const cleanupProblems = []
  const attempt = async (what, body) => {
    try {
      await body()
    } catch (error) {
      cleanupProblems.push(`${what}: ${error.message.split('\n')[0]}`)
    }
  }
  await attempt('require two-step setting', async () => {
    const before = settingsBefore?.security?.require_admin_two_factor === true
    if ((await admin$('/settings')).status === 403 && made.ownerToken) {
      await api('/api/admin/v1/settings', { method: 'PATCH', token: made.ownerToken, body: { security: { require_admin_two_factor: before } } })
    }
    if ((await admin$('/settings')).body?.data?.security?.require_admin_two_factor !== before) tinker(`app(App\\Services\\Settings::class)->put(['require_admin_two_factor' => ${before}]);`)
  })
  await attempt('test admins', async () => {
    for (const id of made.admins) {
      const row = await adminOf(id)
      if (row?.two_factor_enabled) await admin$(`/admins/${id}/two-factor/reset`, { method: 'POST' })
      if (row?.is_active) await admin$(`/admins/${id}`, { method: 'PATCH', body: { is_active: false } })
    }
    if (made.admins.length) tinker(`App\\Models\\Admin::whereIn('id', [${made.admins.join(',')}])->update(['is_active' => false, 'two_factor_secret' => null, 'two_factor_confirmed_at' => null, 'two_factor_recovery_codes' => null]);`)
  })
  await attempt('customer', async () => {
    for (const email of [cleo.email, cleoNewEmail, `cleo.${marker}@buynest.test`]) {
      const customer = await findCustomer(email)
      if (customer) await admin$(`/customers/${customer.id}`, { method: 'DELETE' })
    }
  })
  await attempt('stock alerts', () => tinker(`App\\Models\\StockAlert::where('email', 'like', '%${marker}%')->orWhereIn('product_id', [${made.products.join(',') || 0}])->delete();`))
  await attempt('test products', async () => {
    for (const id of made.products) {
      for (const image of (await productOf(id))?.images ?? []) await admin$(`/products/${id}/images/${image.id}`, { method: 'DELETE' })
      await admin$(`/products/${id}`, { method: 'PATCH', body: { category: 'home-decoration', status: 'draft' } })
      await admin$(`/products/${id}`, { method: 'DELETE' })
    }
  })
  await attempt('notifications', () => {
    const links = made.products.map((id) => `'/products/${id}'`).join(',') || "''"
    tinker(`$ids = App\\Models\\AdminNotification::whereIn('link', [${links}])->pluck('id'); DB::table('admin_notification_reads')->whereIn('notification_id', $ids)->delete(); App\\Models\\AdminNotification::whereIn('id', $ids)->delete();`)
  })
  await attempt('backups', async () => {
    const now = ((await admin$('/backups')).body?.data ?? []).map((backup) => backup.name).filter((name) => !backupsBefore.has(name))
    if (now.length) tinker(`Illuminate\\Support\\Facades\\Storage::disk('backups')->delete([${now.map((name) => `'${name}'`).join(',')}]);`)
    tinker(`App\\Models\\BackupRun::where('id', '>', ${backupRunsBefore})->delete();`)
  })
  await attempt('stock', () => restoreStock())
  rmSync(files, { recursive: true, force: true })

  const settingsAfter = (await admin$('/settings')).body?.data?.security?.require_admin_two_factor
  const adminsAfter = await Promise.all(made.admins.map(adminOf))
  const mainAdmin = ((await admin$(`/admins?search=${encodeURIComponent(ADMIN_USER.email)}`)).body?.data ?? []).find((item) => item.email === ADMIN_USER.email)
  const checks = {
    requireSetting: settingsAfter === (settingsBefore?.security?.require_admin_two_factor ?? false),
    admins: adminsAfter.every((item) => item && item.is_active === false && item.two_factor_enabled === false),
    mainAdmin: mainAdmin?.two_factor_enabled === false && mainAdmin?.is_active === true,
    customer: !(await findCustomer(cleoNewEmail)) && !(await findCustomer(`cleo.${marker}@buynest.test`)),
    stockAlerts: Number(tinker(`echo App\\Models\\StockAlert::where('email', 'like', '%${marker}%')->count();`)) === 0,
    products: ((await admin$(`/products?search=${marker}`)).body?.data ?? []).length === 0,
    backups: ((await admin$('/backups')).body?.data ?? []).every((backup) => backupsBefore.has(backup.name)) && Number(tinker(`echo App\\Models\\BackupRun::where('id', '>', ${backupRunsBefore})->count();`)) === 0,
  }
  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  log(
    failedChecks.length === 0 && cleanupProblems.length === 0,
    `cleanup: require-two-step setting, test admins (off, deactivated), customer, stock alerts, products, backups, notifications, stock put back (orders stay)${failedChecks.length || cleanupProblems.length ? ` — left: ${[...failedChecks, ...cleanupProblems].join('; ')}` : ''}`,
  )
}

// The errors this suite throws on purpose (to check error reports) aren't page errors.
const pageErrors = errors.filter((message) => !message.includes('e2e-launch-'))
log(pageErrors.length === 0, `no page errors ${JSON.stringify(pageErrors)}`)
report.done()
await browser.close()
