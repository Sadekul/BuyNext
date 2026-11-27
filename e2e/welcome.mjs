// Phase 19, end to end in a real browser: the welcome coupon (docs/backend/PHASE19_CONTRACT.md §4).
//
// Switches the offer on through Marketing → Welcome coupon (10% off, both ways of earning it, first order only,
// a $10 minimum) and checks the preview; the store's promises (the newsletter band and the sign-up note, in
// English and once in Bangla); a throwaway newsletter address gets no code before it confirms, then the code
// email (read from the dev mailbox), the confirmation page's note, and the admin codes list and stats; a guest
// checkout with that code (refused for another email, accepted for its own: the order carries the discount; a
// second use refused); a throwaway sign-up → verify → the code email in English, the account card (Active, Copy,
// Use by); no second code for the same address (re-subscribing, the account's newsletter switch); first order
// only (an order without the code, then the code refused); Coupons → "Welcome codes" tab, disabling a code there
// (Expired on the card and refused); switching it off removes every promise. axe and 390px on the admin page,
// the sign-up note, the newsletter band and the account card; no page errors.
//
// Needs the BuyNest API (E2E_ACCOUNTS=laravel), its dev mailbox, and php (cleanup through `php artisan tinker`).
//
// Left behind on purpose (like the other suites): the two test orders (a guest order with the code, and the
// throwaway customer's order without it), both cancelled; audit entries; and the emails in the dev mailbox.
// Put back or removed: the welcome coupon settings (exactly as read at the start: the stored rows, or none, so the
// defaults apply), the throwaway customer, the suite's newsletter subscribers, the suite's welcome-code grants and
// codes (cancelling the guest order releases its code, which is then unused and removed too; a code still used by
// an order would stay), saved carts and stock. The demo accounts are never touched.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  SHOPPER,
  SHOPPER_2,
  adminSignIn,
  axeViolations,
  clearSavedCart,
  fillEmptyAddress,
  latestCode,
  launch,
  preserveStock,
  reporter,
  sidewaysOverflow,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('welcome coupon: settings, store promises, newsletter and sign-up codes, checkout, admin lists')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const BACKEND = join(import.meta.dirname, '..', 'backend')
const api = async (path, { method = 'GET', token, body } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
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
const owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const welcomeState = async () => (await admin$('/marketing/welcome-coupon')).body?.data
const codesFor = async (search) => (await admin$(`/marketing/welcome-coupon/codes?search=${encodeURIComponent(search)}&per_page=100`)).body?.data ?? []
const findCustomer = async (email) => ((await admin$(`/customers?search=${encodeURIComponent(email)}`)).body?.data ?? []).find((customer) => customer.email === email)
/** Runs PHP in the backend (local development only): reading and putting back the suite's own rows. */
function tinker(code) {
  const run = spawnSync('php', ['artisan', 'tinker', `--execute=${code}`], { cwd: BACKEND, encoding: 'utf8', timeout: 60_000 })
  if (run.status !== 0) throw new Error(`tinker failed: ${(run.stderr || run.stdout).trim().slice(0, 200)}`)
  return run.stdout.trim()
}
/** The newest email to an address in the Laravel test inbox, newer than `after`, or null. */
async function latestMail(email, { after = 0, tries = 20 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const response = await fetch(`${LARAVEL_URL}/dev/mailbox/latest?to=${encodeURIComponent(email.toLowerCase())}`)
    if (response.ok) {
      const { data } = await response.json()
      if (data.id > after) return data
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}
const latestMailId = async (email) => (await latestMail(email, { tries: 1 }))?.id ?? 0
const WELCOME_CODE = /WELCOME-[A-HJ-NP-Z2-9]{6}/

const run = Date.now().toString(36)
const marker = `welcome${run}`
const subscriberEmail = `news.${marker}@example.com`
const otherEmail = `other.${marker}@example.com`
const member = { firstName: 'Wanda', lastName: 'Welcome', email: `member.${marker}@example.com`, password: 'WelcomePass2026', phone: '+1 555 010 7788' }
const DRESS = 166 // Tartan Dress ($39.99, minimum order 1): above the $10 minimum on its own
const KEYS = ['welcome_coupon_enabled', 'welcome_coupon_triggers', 'welcome_coupon_type', 'welcome_coupon_value', 'welcome_coupon_min_subtotal', 'welcome_coupon_valid_days', 'welcome_coupon_first_order_only']
const keyList = KEYS.map((key) => `'${key}'`).join(',')

// What this suite changes, recorded first so it can be put back exactly
const restoreStock = await preserveStock()
const settingsBefore = (await welcomeState())?.settings
const rowsBefore = JSON.parse(tinker(`echo json_encode(DB::table('settings')->whereIn('key', [${keyList}])->pluck('value', 'key'));`) || '{}')
const made = { orders: [], customerId: null }

const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const overflowAt390 = async (page, name) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  const overflow = await sidewaysOverflow(page)
  log(overflow <= 0, `390px ${name}: no sideways scroll (${overflow}px)`)
  await page.setViewportSize({ width: 1280, height: 900 })
}
async function newPage({ viewport = { width: 1280, height: 900 }, permissions } = {}) {
  const context = await browser.newContext({ viewport, bypassCSP: true, ...(permissions && { permissions }) })
  context.setDefaultTimeout(15000)
  context.setDefaultNavigationTimeout(45000)
  return watchErrors(await context.newPage(), errors)
}
async function part(name, body) {
  try {
    await body()
  } catch (error) {
    log(false, `${name} stopped early: ${error.message.split('\n')[0]}`)
  }
}
const text = async (locator) => ((await locator.first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
async function addToCart(page, id) {
  await page.goto(`${BASE}/products/${id}`, { waitUntil: 'networkidle' })
  await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
  const miniCart = page.getByRole('dialog')
  if (await visible(miniCart, 3000)) {
    await page.keyboard.press('Escape')
    await miniCart.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  }
}
async function emptyCart(page) {
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
  const lines = page.locator('.cart-page__list .cart-line')
  for (let guard = 0; guard < 20 && (await lines.count()) > 0; guard++) {
    await lines.first().getByRole('button', { name: /^Remove / }).click()
    await page.waitForTimeout(300)
  }
}
async function fillCheckout(page, { email } = {}) {
  await page.locator('[name="email"]').waitFor()
  if (email) await page.locator('[name="email"]').fill(email)
  const phoneField = page.locator('[name="phone"]')
  if (!(await phoneField.inputValue())) await phoneField.fill('+1 555 010 2030')
  for (const [name, value] of Object.entries({ firstName: 'Wanda', lastName: 'Welcome' })) {
    const input = page.locator(`[name="shipping.${name}"]`)
    if ((await input.count()) > 0 && !(await input.inputValue())) await input.fill(value)
  }
  await fillEmptyAddress(page)
}
const settled = (page) => page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking prices/.test(b.textContent)), null, { timeout: 20000 }).catch(() => {})
async function placeOrder(page) {
  const button = page.getByRole('button', { name: /^Place order · / })
  await button.waitFor({ timeout: 20000 })
  await settled(page)
  await button.click()
  await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 })
  const number = new URL(page.url()).pathname.split('/').pop()
  made.orders.push(number)
  return number
}
/** Applies a code in the coupon box on the page (cart or checkout). */
async function applyCode(page, code) {
  const box = page.locator('.coupon-form').filter({ has: page.getByLabel('Discount code', { exact: true }) })
  await box.getByLabel('Discount code', { exact: true }).fill(code)
  await box.getByRole('button', { name: 'Apply', exact: true }).click()
}
const couponError = (page, pattern) => page.locator('.coupon-form__error').filter({ hasText: pattern })
const couponSuccess = (page) => page.locator('.coupon-form__success')

async function adminPage() {
  const admin = await newPage({ viewport: { width: 1440, height: 900 } })
  await adminSignIn(admin, ADMIN_USER)
  await admin.getByRole('heading', { name: 'Overview' }).waitFor()
  return admin
}
const statOf = async (page, label) => Number((await text(page.locator('dl.stats > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd.stat__value'))).replace(/,/g, ''))
/** Saves the settings form and waits for its notice. */
async function saveWelcome(admin) {
  await admin.getByRole('button', { name: 'Save welcome coupon' }).click()
  return visible(admin.getByRole('status').filter({ hasText: 'Welcome coupon saved.' }))
}

let admin
let newsletterCode = null
let memberCode = null
let statsBefore = null
try {
  log(settingsBefore?.welcome_coupon_enabled === false || settingsBefore?.welcome_coupon_enabled === true, `settings read first (enabled ${settingsBefore?.welcome_coupon_enabled}, ${Object.keys(rowsBefore).length} stored rows)`)
  statsBefore = (await welcomeState())?.stats

  // ---------- 1. Marketing → Welcome coupon: switch it on ----------
  await part('admin settings', async () => {
    admin = await adminPage()
    await admin.getByRole('link', { name: 'Welcome coupon', exact: true }).first().click()
    await admin.waitForURL(/\/admin\/welcome-coupon/)
    log(await visible(admin.getByRole('heading', { level: 1, name: 'Welcome coupon' })), 'the "Welcome coupon" nav link opens the page (h1 "Welcome coupon")')
    const tiles = {}
    for (const label of ['Issued', 'Used', 'Active', 'Expired']) tiles[label] = await statOf(admin, label)
    log(
      tiles.Issued === statsBefore?.issued && tiles.Used === statsBefore?.used && tiles.Active === statsBefore?.active && tiles.Expired === statsBefore?.expired,
      `stat tiles match the API (Issued ${tiles.Issued}, Used ${tiles.Used}, Active ${tiles.Active}, Expired ${tiles.Expired})`,
    )
    const form = admin.getByRole('form', { name: 'Settings' })
    const toggle = form.getByRole('switch', { name: 'Welcome coupon' })
    if (await toggle.isChecked()) {
      // Started on (someone switched it on): switch it off first, so the suite sees the "off" store too.
      await toggle.click()
      await saveWelcome(admin)
    }
    log(!(await form.getByRole('switch', { name: 'Welcome coupon' }).isChecked()) && (await text(form.locator('#welcome-state'))) === 'Off', 'the switch is off ("Off")')
    await form.getByRole('switch', { name: 'Welcome coupon' }).click()
    log((await text(form.locator('#welcome-state'))) === 'On: new customers get a code', 'switched on: "On: new customers get a code"')
    const earn = form.getByRole('group', { name: 'How customers earn it' })
    for (const name of ['When someone creates an account', 'When someone confirms the newsletter']) await earn.getByRole('checkbox', { name }).check()
    await form.getByLabel('Discount type').selectOption({ label: 'Percentage' })
    await form.getByLabel('Percent off').fill('10')
    await form.getByLabel(/^Minimum order \(.*optional\)/).fill('10')
    await form.getByLabel('Valid for (days)').fill('30')
    await form.getByRole('checkbox', { name: 'First order only' }).check()
    const preview = await text(form.getByRole('region', { name: 'Preview: what shoppers see' }))
    log(
      preview.includes('Get 10% off your first order') && /Orders over \$10(\.00)?\./.test(preview) && preview.includes("Confirm your email and we'll send your personal code.") && preview.includes('Create an account and get 10% off your first order.'),
      `the preview shows the promise ("${preview.slice(0, 160)}")`,
    )
    // Fixed amount relabels the value field (then back)
    await form.getByLabel('Discount type').selectOption({ label: 'Fixed amount' })
    log(await visible(form.getByLabel(/^Amount off \(USD\)/), 3000), 'Fixed amount: the field becomes "Amount off (USD)"')
    await form.getByLabel('Discount type').selectOption({ label: 'Percentage' })
    await form.getByLabel('Percent off').fill('10')
    log(await saveWelcome(admin), 'Save welcome coupon → "Welcome coupon saved."')
    const saved = (await welcomeState())?.settings
    log(
      saved?.welcome_coupon_enabled === true && saved.welcome_coupon_triggers.join() === 'signup,newsletter' && saved.welcome_coupon_type === 'percent' && saved.welcome_coupon_value === '10.00' && saved.welcome_coupon_min_subtotal === '10.00' && saved.welcome_coupon_valid_days === 30 && saved.welcome_coupon_first_order_only === true,
      `saved on the server (${JSON.stringify(saved)})`,
    )
    const offer = (await api('/api/v1/store')).body?.data?.welcome_offer
    log(offer?.type === 'percent' && offer.label === '10% off' && offer.min_subtotal === '$10' && offer.first_order_only === true && offer.triggers?.length === 2, `GET /store welcome_offer: ${JSON.stringify(offer)}`)
    await axe(admin, 'Welcome coupon page')
    await overflowAt390(admin, 'Welcome coupon page')
  })

  // ---------- 2. The store's promises ----------
  await part('store promises', async () => {
    const guest = await newPage()
    await guest.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const title = guest.locator('#newsletter-title').first()
    await title.filter({ hasText: 'Get 10% off your first order' }).waitFor().catch(() => {})
    log((await text(title)) === 'Get 10% off your first order', `newsletter band: "${await text(title)}"`)
    const band = guest.locator('section.newsletter').first()
    const bandText = await text(band.locator('.newsletter__text'))
    log(bandText.includes("Confirm your email and we'll send your personal code.") && /Orders over \$10\./.test(bandText), `and "${bandText}"`)
    await band.scrollIntoViewIfNeeded()
    await axe(guest, 'home with the newsletter promise')
    await overflowAt390(guest, 'home newsletter band')

    await guest.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
    const note = guest.locator('.auth-welcome')
    await note.waitFor().catch(() => {})
    const noteText = await text(note)
    log(noteText.includes('Create an account and get 10% off your first order.') && noteText.includes("We'll email your personal code once you confirm your email."), `sign-up note: "${noteText}"`)
    await axe(guest, 'sign-up with the welcome note')
    await overflowAt390(guest, 'sign-up with the welcome note')

    // Bangla, once: the header switch, then the newsletter heading and the sign-up note
    await guest.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await guest.locator('.site-header').getByRole('button', { name: 'বাংলা', exact: true }).click()
    await guest.waitForFunction(() => document.documentElement.lang === 'bn', null, { timeout: 10000 }).catch(() => {})
    await title.filter({ hasText: 'আপনার প্রথম অর্ডারে' }).waitFor().catch(() => {})
    log((await text(title)) === 'আপনার প্রথম অর্ডারে ১০% ছাড় পান', `Bangla newsletter band: "${await text(title)}"`)
    await guest.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
    const bnNote = await text(guest.locator('.auth-welcome'))
    log(bnNote.includes('অ্যাকাউন্ট খুলুন আর আপনার প্রথম অর্ডারে ১০% ছাড় পান।'), `Bangla sign-up note: "${bnNote.slice(0, 80)}"`)
    await guest.context().close()
  })

  // ---------- 3. Newsletter: no code before confirming, the code after ----------
  await part('newsletter code', async () => {
    const guest = await newPage()
    await guest.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const form = guest.locator('section.newsletter').first()
    await form.getByLabel('Email address').fill(subscriberEmail)
    await form.getByRole('button', { name: 'Subscribe' }).click()
    const modal = guest.getByRole('dialog', { name: 'Check your inbox' })
    await modal.waitFor()
    await modal.getByRole('button', { name: 'Continue shopping' }).click()
    const confirmMail = await latestMail(subscriberEmail)
    const confirmPath = confirmMail?.text.match(/\/newsletter\/confirm\?token=[^\s"<>)\]]+/)?.[0]
    log(Boolean(confirmPath) && !WELCOME_CODE.test(confirmMail.text), `subscribed: only the confirmation email ("${confirmMail?.subject}"), no code yet`)
    log((await codesFor(subscriberEmail)).length === 0, 'and no welcome code issued yet (admin codes list)')

    await guest.goto(`${BASE}${confirmPath}`, { waitUntil: 'networkidle' })
    log(await visible(guest.getByText("You're subscribed to the BuyNest newsletter.")), 'the link confirms the subscription')
    log(await visible(guest.getByRole('status').filter({ hasText: 'Your welcome code is on its way to your inbox.' })), 'the confirmation page: "Your welcome code is on its way to your inbox."')
    const codeMail = await latestMail(subscriberEmail, { after: confirmMail.id })
    newsletterCode = codeMail?.text.match(WELCOME_CODE)?.[0] ?? null
    log(/^Your welcome code: 10% off/.test(codeMail?.subject ?? '') && Boolean(newsletterCode), `the code email arrives: "${codeMail?.subject}" with ${newsletterCode}`)
    await axe(guest, 'newsletter confirmation with the welcome note')

    const listed = await codesFor(subscriberEmail)
    log(listed.length === 1 && listed[0].code === newsletterCode && listed[0].trigger === 'newsletter' && listed[0].status === 'active', `API codes list: ${listed.map((item) => `${item.code} ${item.trigger} ${item.status}`).join(', ')}`)

    // The same address again: already subscribed, no second email
    const lastId = await latestMailId(subscriberEmail)
    await guest.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await form.getByLabel('Email address').fill(subscriberEmail)
    await form.getByRole('button', { name: 'Subscribe' }).click()
    await guest.getByRole('dialog', { name: 'Check your inbox' }).waitFor()
    await guest.waitForTimeout(1500)
    log((await latestMailId(subscriberEmail)) === lastId && (await codesFor(subscriberEmail)).length === 1, 'subscribing the same address again: no new email, still one code')
    await guest.context().close()

    // Admin: codes list and stats
    await admin.goto(`${BASE}/admin/welcome-coupon`, { waitUntil: 'networkidle' })
    log((await statOf(admin, 'Issued')) === (statsBefore?.issued ?? 0) + 1 && (await statOf(admin, 'Active')) === (statsBefore?.active ?? 0) + 1, `stats: Issued ${await statOf(admin, 'Issued')}, Active ${await statOf(admin, 'Active')} (one more each)`)
    const codes = admin.getByRole('region', { name: 'Codes sent' })
    await codes.getByRole('searchbox', { name: 'Search welcome codes' }).fill(subscriberEmail)
    await codes.getByRole('button', { name: 'Search' }).click()
    const row = codes.getByRole('table', { name: 'Welcome codes sent, newest first' }).locator('tbody tr').filter({ hasText: subscriberEmail })
    await row.waitFor().catch(() => {})
    const rowText = await text(row)
    log(rowText.includes(newsletterCode) && rowText.includes('Newsletter') && rowText.includes('Active') && (await admin.locator('tbody tr').count()) === 1, `admin codes list: "${rowText}"`)
    await codes.getByLabel('Status').selectOption({ label: 'Used' })
    log(await visible(codes.getByText('No codes match.')), 'Status "Used": no match yet')
    await codes.getByLabel('Status').selectOption({ label: 'All codes' })
  })

  // ---------- 4. Guest checkout with the code ----------
  await part('guest checkout', async () => {
    if (!newsletterCode) throw new Error('no newsletter code')
    const guest = await newPage()
    await addToCart(guest, DRESS)
    await guest.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(guest, { email: otherEmail })
    await applyCode(guest, newsletterCode)
    log(await visible(couponError(guest, "This code isn't available for your account.")), 'another email at checkout: "This code isn\'t available for your account."')
    await guest.locator('[name="email"]').fill(subscriberEmail)
    log(await visible(couponSuccess(guest)), 'its own email: the code applies')
    await settled(guest)
    const number = await placeOrder(guest)
    const order = await orderOf(number)
    const rule = order?.applied_rules?.find((item) => item.code === newsletterCode)
    log(Boolean(rule) && Number(order.totals?.discount) === Math.round(Number(order.totals?.subtotal) * 10) / 100, `order ${number}: ${newsletterCode} took 10% off (subtotal ${order?.totals?.subtotal}, discount ${order?.totals?.discount})`)
    const listed = (await codesFor(subscriberEmail))[0]
    log(listed?.status === 'used' && listed.used_on_order === number, `codes list: ${listed?.status} on ${listed?.used_on_order}`)

    // A second use (another guest cart) is refused
    const again = await newPage()
    await addToCart(again, DRESS)
    await again.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    await applyCode(again, newsletterCode)
    const refusal = couponError(again, /fully used|already used|first order only/)
    log(await visible(refusal), `a second use is refused ("${await text(refusal)}")`)
    await again.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(again, { email: subscriberEmail })
    const checkoutRefusal = couponError(again, /first order only|already used|fully used/)
    log(await visible(checkoutRefusal), `and at checkout with its own email ("${await text(checkoutRefusal)}")`)
    await again.context().close()
    await guest.context().close()

    await admin.goto(`${BASE}/admin/welcome-coupon?q=${encodeURIComponent(subscriberEmail)}`, { waitUntil: 'networkidle' })
    const row = admin.locator('tbody tr').filter({ hasText: subscriberEmail })
    await row.filter({ hasText: number }).waitFor().catch(() => {})
    const rowText = await text(row)
    log(rowText.includes('Used') && rowText.includes(number), `admin codes list: Used, with the order ("${rowText}")`)
  })

  // ---------- 5. Sign-up → verify → the code email and the account card ----------
  let shop
  await part('sign-up code', async () => {
    shop = await newPage({ permissions: ['clipboard-read', 'clipboard-write'] })
    await shop.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
    await shop.getByLabel('First name').fill(member.firstName)
    await shop.getByLabel('Last name').fill(member.lastName)
    await shop.getByLabel('Email').fill(member.email)
    await shop.getByLabel('Phone number').fill(member.phone)
    await shop.getByLabel('Password', { exact: true }).fill(member.password)
    await shop.getByLabel('Confirm password').fill(member.password)
    await shop.getByLabel(/I agree to the terms/).check()
    await shop.getByRole('button', { name: 'Create account' }).click()
    await shop.getByRole('heading', { name: 'Check your email' }).waitFor()
    const verify = await latestCode(member.email)
    log((await codesFor(member.email)).length === 0, 'created but not confirmed: no code yet')
    await shop.getByLabel('6-digit code').fill(verify.code)
    await shop.getByRole('button', { name: 'Confirm and sign in' }).click()
    log(await visible(shop.getByRole('heading', { name: /Hi, Wanda/ })), 'confirmed and signed in')
    made.customerId = (await findCustomer(member.email))?.id ?? null
    const codeMail = await latestMail(member.email, { after: verify.id })
    memberCode = codeMail?.text.match(WELCOME_CODE)?.[0] ?? null
    log(/^Your welcome code: 10% off/.test(codeMail?.subject ?? '') && codeMail.text.includes('Wanda') && Boolean(memberCode), `the code email in English: "${codeMail?.subject}" (${memberCode})`)
    const listed = await codesFor(member.email)
    log(listed.length === 1 && listed[0].trigger === 'signup' && listed[0].customer?.id === made.customerId, `codes list: earned by ${listed[0]?.trigger}, linked to the customer`)

    await shop.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    const card = shop.getByRole('region', { name: 'Your welcome code' })
    await card.waitFor()
    const cardText = await text(card)
    log((await text(card.locator('code'))) === memberCode && cardText.includes('Status: Active') && cardText.includes('10% off your first order') && /Use by /.test(cardText), `account card: "${cardText.slice(0, 160)}"`)
    await card.getByRole('button', { name: `Copy welcome code ${memberCode}` }).click()
    log(await visible(card.getByRole('status').filter({ hasText: `Code ${memberCode} copied.` })), `Copy → "Code ${memberCode} copied."`)
    log((await shop.evaluate(() => navigator.clipboard.readText()).catch(() => '')) === memberCode, 'and the code is on the clipboard')
    const me = (await api('/api/v1/auth/login', { method: 'POST', body: { email: member.email, password: member.password } })).body?.data
    log(me?.customer?.welcome_coupon?.code === memberCode && me.customer.welcome_coupon.status === 'active', `sign-in answer carries welcome_coupon (${JSON.stringify(me?.customer?.welcome_coupon)})`)
    await axe(shop, 'account with the welcome code card')
    await overflowAt390(shop, 'account with the welcome code card')

    // The account's newsletter switch: subscribed, but no second code
    const before = await latestMailId(member.email)
    await shop.getByLabel('Email me new arrivals, deals, and style tips').click()
    await shop.getByRole('status').filter({ hasText: "You're subscribed to the newsletter." }).waitFor().catch(() => {})
    await shop.waitForTimeout(1500)
    const after = await latestMail(member.email, { tries: 1 })
    log((after?.id ?? 0) === before && (await codesFor(member.email)).length === 1, 'newsletter switch on: subscribed, no second code email')
  })

  // ---------- 6. First order only ----------
  await part('first order only', async () => {
    if (!shop || !memberCode) throw new Error('no signed-in account with a code')
    await addToCart(shop, DRESS)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(shop)
    const number = await placeOrder(shop)
    log(/^BN-/.test(number) && ((await orderOf(number))?.applied_rules ?? []).length === 0, `an order without the code: ${number}`)
    await addToCart(shop, DRESS)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    await applyCode(shop, memberCode)
    log(await visible(couponError(shop, 'This code is for your first order only.')), 'then the code: "This code is for your first order only."')
    await shop.getByRole('button', { name: `Remove code ${memberCode}` }).click().catch(() => {})
    await emptyCart(shop)
  })

  // ---------- 7. Coupons → Welcome codes, and switching one off ----------
  await part('coupons tabs and disabling a code', async () => {
    if (!memberCode) throw new Error('no member code')
    await admin.goto(`${BASE}/admin/coupons`, { waitUntil: 'networkidle' })
    const tabs = admin.getByRole('tablist', { name: 'Coupon lists' })
    log((await tabs.getByRole('tab', { name: 'Your coupons' }).getAttribute('aria-selected')) === 'true', 'Coupons: tabs "Your coupons" (selected) and "Welcome codes"')
    log((await admin.getByText(`Sent to ${member.email}`).count()) === 0, '"Your coupons" lists no welcome codes')
    await tabs.getByRole('tab', { name: 'Welcome codes' }).click()
    await admin.waitForURL(/source=welcome/)
    await admin.getByRole('searchbox', { name: 'Search welcome codes' }).fill(member.email)
    await admin.getByRole('button', { name: 'Search' }).click()
    const row = admin.locator('tbody tr').filter({ hasText: `Sent to ${member.email}` })
    log(await visible(row), `Welcome codes tab: "Sent to ${member.email}"`)
    log((await row.getByRole('button', { name: /^Delete / }).count()) === 0, 'a welcome code has no Delete, only View and Disable')
    await axe(admin, 'Coupons, Welcome codes tab')
    await row.getByRole('button', { name: `Disable ${memberCode}` }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Disable', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' }).catch(() => {})
    await row.filter({ hasText: 'Disabled' }).waitFor().catch(() => {})
    log((await text(row)).includes('Disabled') && (await row.getByRole('button', { name: `Disable ${memberCode}` }).count()) === 0, `disabled: the coupon row says Disabled ("${(await text(row)).slice(-40)}")`)
    const listed = (await codesFor(member.email))[0]
    log(listed?.status === 'expired', `Welcome coupon codes list: ${listed?.status}`)
    await row.getByRole('link', { name: `View ${memberCode}` }).click()
    await admin.getByRole('heading', { level: 1, name: memberCode }).waitFor()
    const page = admin.locator('form[aria-labelledby="welcome-code-title"]')
    const active = page.getByRole('checkbox', { name: 'Active (the customer can use it until it expires)' })
    log((await page.locator('input:not([type="hidden"]), select, textarea').count()) === 1 && !(await active.isChecked()) && (await page.getByRole('button', { name: 'Save changes' }).isDisabled()), 'the code page: only the Active checkbox (off) and Save changes')
    await axe(admin, 'welcome code page')

    await shop.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    const card = shop.getByRole('region', { name: 'Your welcome code' })
    await card.waitFor()
    log((await text(card)).includes('Status: Expired') && (await card.getByRole('button', { name: /^Copy welcome code/ }).count()) === 0, `account card: "Status: Expired", no Copy ("${(await text(card)).slice(0, 100)}")`)
    await addToCart(shop, DRESS)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    await applyCode(shop, memberCode)
    const refusal = couponError(shop, /not valid|expired/)
    log(await visible(refusal), `the disabled code is refused ("${await text(refusal)}")`)
    await shop.getByRole('button', { name: `Remove code ${memberCode}` }).click().catch(() => {})
    await emptyCart(shop)
  })

  // ---------- 8. Switched off: every promise gone ----------
  await part('switched off', async () => {
    await admin.goto(`${BASE}/admin/welcome-coupon?q=${encodeURIComponent(marker)}`, { waitUntil: 'networkidle' })
    const rows = admin.getByRole('table', { name: 'Welcome codes sent, newest first' }).locator('tbody tr')
    await rows.first().waitFor().catch(() => {})
    const memberRow = await text(rows.filter({ hasText: member.email }))
    const newsRow = await text(rows.filter({ hasText: subscriberEmail }))
    log(memberRow.includes('Expired') && memberRow.includes('Account sign-up') && newsRow.includes('Used'), `admin codes list: the disabled code Expired, the guest's Used (${await rows.count()} rows)`)
    await admin.getByRole('region', { name: 'Codes sent' }).getByLabel('Status').selectOption({ label: 'Expired' })
    await admin.waitForURL(/status=expired/)
    await rows.filter({ hasText: subscriberEmail }).waitFor({ state: 'detached' }).catch(() => {})
    log((await rows.count()) === 1 && (await text(rows.first())).includes(member.email), 'Status "Expired" filter: only the disabled code')
    const form = admin.getByRole('form', { name: 'Settings' })
    await form.getByRole('switch', { name: 'Welcome coupon' }).click()
    log((await text(form.locator('#welcome-state'))) === 'Off' && (await saveWelcome(admin)), 'switched off and saved')
    const stats = (await welcomeState())?.stats
    log(stats?.issued === (statsBefore?.issued ?? 0) + 2 && stats.used === (statsBefore?.used ?? 0) + 1 && stats.expired === (statsBefore?.expired ?? 0) + 1, `stats: ${JSON.stringify(stats)} (two issued, one used, one expired)`)
    log((await api('/api/v1/store')).body?.data?.welcome_offer === null, 'GET /store welcome_offer: null')
    const guest = await newPage()
    await guest.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const title = guest.locator('#newsletter-title').first()
    log((await text(title)) === 'Be first to hear about deals' && (await guest.getByText("Confirm your email and we'll send your personal code.").count()) === 0, `newsletter band back to "${await text(title)}"`)
    await guest.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
    log((await guest.locator('.auth-welcome').count()) === 0 && (await guest.getByText(/Create an account and get/).count()) === 0, 'sign-up page: no welcome note')
    await guest.context().close()
  })
} catch (error) {
  log(false, `the suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  const problems = []
  const attempt = async (what, body) => {
    try {
      await body()
    } catch (error) {
      problems.push(`${what}: ${error.message.split('\n')[0]}`)
    }
  }
  const emails = [subscriberEmail, otherEmail, member.email]
  const emailList = emails.map((email) => `'${email}'`).join(',')
  await attempt('welcome coupon settings', async () => {
    if (Object.keys(rowsBefore).length === 0) {
      // Never stored before the run: remove the rows, so the defaults apply again.
      tinker(`DB::table('settings')->whereIn('key', [${keyList}])->delete(); Illuminate\\Support\\Facades\\Cache::forget('buynest.settings'); echo 'ok';`)
    } else if (settingsBefore) {
      const answer = await admin$('/marketing/welcome-coupon', { method: 'PUT', body: settingsBefore })
      if (answer.status !== 200) throw new Error(`PUT answered ${answer.status}`)
      const missing = KEYS.filter((key) => !(key in rowsBefore)).map((key) => `'${key}'`).join(',')
      if (missing) tinker(`DB::table('settings')->whereIn('key', [${missing}])->delete(); Illuminate\\Support\\Facades\\Cache::forget('buynest.settings'); echo 'ok';`)
    }
  })
  await attempt('test orders', async () => {
    for (const number of made.orders) {
      const order = await orderOf(number)
      if (order && order.status !== 'cancelled') await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
    }
  })
  await attempt('the throwaway customer', async () => {
    const customer = made.customerId ? { id: made.customerId } : await findCustomer(member.email)
    if (!customer) return
    const deleted = await admin$(`/customers/${customer.id}`, { method: 'DELETE' })
    if (deleted.status !== 204) throw new Error(`DELETE customer answered ${deleted.status} ${JSON.stringify(deleted.body?.errors ?? deleted.body?.message)}`)
  })
  await attempt('subscribers, grants and unused codes', () => {
    tinker(
      `App\\Models\\NewsletterSubscriber::whereIn('email', [${emailList}])->delete();` +
        ` $ids = App\\Models\\Coupon::where('source', 'welcome')->whereIn('issued_to_email', [${emailList}])->where('times_used', 0)->whereDoesntHave('redemptions')->pluck('id');` +
        ` App\\Models\\WelcomeCouponGrant::whereIn('email', [${emailList}])->delete(); App\\Models\\Coupon::whereIn('id', $ids)->delete(); echo 'ok';`,
    )
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  const settingsAfter = (await welcomeState())?.settings
  const rowsAfter = JSON.parse(tinker(`echo json_encode(DB::table('settings')->whereIn('key', [${keyList}])->pluck('value', 'key'));`) || '{}')
  const open = []
  for (const number of made.orders) if ((await orderOf(number))?.status !== 'cancelled') open.push(number)
  const leftCustomer = await findCustomer(member.email)
  const leftSubscribers = ((await admin$(`/newsletter/subscribers?search=${encodeURIComponent(marker)}`)).body?.data ?? []).length
  const leftCodes = (await codesFor(marker)).filter((item) => item.status !== 'used')
  const settingsBack = JSON.stringify(settingsAfter) === JSON.stringify(settingsBefore) && JSON.stringify(rowsAfter) === JSON.stringify(rowsBefore)
  log(
    problems.length === 0 && settingsBack && open.length === 0 && !leftCustomer && leftSubscribers === 0 && leftCodes.length === 0,
    `cleanup: welcome coupon settings put back, test orders cancelled, the throwaway customer, subscribers, grants and unused codes removed, carts and stock put back${problems.length || !settingsBack || open.length || leftCustomer || leftSubscribers || leftCodes.length ? ` — left: ${[...problems, settingsBack ? '' : `settings ${JSON.stringify(settingsAfter)} rows ${JSON.stringify(rowsAfter)}`, ...open, leftCustomer ? 'customer' : '', leftSubscribers ? `${leftSubscribers} subscribers` : '', ...leftCodes.map((item) => item.code)].filter(Boolean).join('; ')}` : ''}`,
  )
}

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
