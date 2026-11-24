// Real orders with BuyNest's API: guest and customer checkout, server prices, stock, emails, tracking, and the admin's order handling.
// Needs VITE_API_PROVIDER=laravel and VITE_ACCOUNTS_BACKEND=laravel (E2E_ACCOUNTS=laravel).
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  SHOPPER,
  adminSignIn,
  axeViolations,
  fillEmptyAddress,
  launch,
  reporter,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('real orders')
const { log } = report
if (!LARAVEL) {
  console.log('(Order checks skipped: they need the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const api = async (path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${LARAVEL_URL}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}
const adminToken = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body.data.tokens.access_token
const stockOf = async (id) => (await api(`/api/v1/products/${id}`)).body.data.stock_quantity
const latestMail = async (email) => (await (await fetch(`${LARAVEL_URL}/dev/mailbox/latest?to=${encodeURIComponent(email)}`)).json()).data

// Products anyone can buy one of, with enough stock to spare
const catalog = (await api('/api/v1/products?per_page=100&available=1')).body.data.filter((product) => product.min_order_quantity === 1 && product.stock_quantity >= 20)
const [first, second, third] = catalog
const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const run = Date.now()

async function addToCart(page, productId) {
  await page.goto(`${BASE}/products/${productId}`, { waitUntil: 'networkidle' })
  await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
  await page.waitForTimeout(400)
}

async function fillContactAndAddress(page, email) {
  if (email) await page.locator('[name="email"]').fill(email)
  const phone = page.locator('[name="phone"]')
  if (!(await phone.inputValue())) await phone.fill('+1 555 010 2030')
  for (const [name, value] of [['firstName', 'Gus'], ['lastName', 'Guest']]) {
    const input = page.locator(`[name="shipping.${name}"]`)
    if (!(await input.inputValue())) await input.fill(value)
  }
  await fillEmptyAddress(page)
}

// ---------- 1. A guest buys: no account needed ----------
let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
let page = watchErrors(await ctx.newPage(), errors)
const guestEmail = `guest.${run}@example.com`
const stockBefore = await stockOf(first.id)
await addToCart(page, first.id)
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
log(!/\/login/.test(page.url()), 'guest checkout: no sign-in required')
const placeOrder = page.getByRole('button', { name: /^Place order · / })
await placeOrder.waitFor({ timeout: 20000 })
log(await page.getByText(/our server confirms every price/i).isVisible(), 'checkout says the server confirms prices')
await fillContactAndAddress(page, guestEmail)
await axe(page, 'checkout (guest)')
const shownTotal = (await placeOrder.textContent()).match(/\$[\d,.]+/)[0]
await placeOrder.click()
await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
const guestOrder = page.url().split('/').pop()
log(/^BN-\d+$/.test(guestOrder), `guest order placed (${guestOrder})`)
log(await visible(page.getByRole('heading', { name: /Thank you/ })), 'confirmation page')
const placed = (await api(`/api/admin/v1/orders/${guestOrder}`, { token: adminToken })).body?.data
log(placed && `$${placed.totals.total}` === shownTotal, `the order total is what checkout showed (${shownTotal}, server ${placed?.totals.total})`)
log(placed?.customer === null && placed.email === guestEmail, 'saved as a guest order with the guest email')
log((await stockOf(first.id)) === stockBefore - 1, `stock went down by one (${stockBefore} → ${await stockOf(first.id)})`)
const confirmation = await latestMail(guestEmail)
log(confirmation?.subject?.includes(guestOrder), `confirmation email sent ("${confirmation?.subject}")`)
await axe(page, 'confirmation')

// Track the order as a guest
await page.goto(`${BASE}/track-order`, { waitUntil: 'networkidle' })
await page.getByLabel('Order number').fill(guestOrder)
await page.getByLabel('Email').fill('wrong@example.com')
await page.getByRole('button', { name: 'Find my order' }).click()
log(await visible(page.getByRole('alert')), 'tracking with the wrong email finds nothing')
await page.getByLabel('Email').fill(guestEmail.toUpperCase())
await page.getByRole('button', { name: 'Find my order' }).click()
log(await visible(page.getByRole('heading', { name: `Order ${guestOrder}` })), 'tracking with number + email shows the order')
await axe(page, 'track order')
await ctx.close()

// ---------- 2. A signed-in customer buys; the order is in their account ----------
ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
page = watchErrors(await ctx.newPage(), errors)
await storefrontSignIn(page, SHOPPER)
await addToCart(page, second.id)
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
await placeOrder.waitFor({ timeout: 20000 }).catch(() => {})
const checkoutButton = page.getByRole('button', { name: /^Place order · / })
await checkoutButton.waitFor({ timeout: 20000 })
log((await page.locator('[name="email"]').inputValue()) === SHOPPER.email, 'customer checkout: email filled in from the account')
await fillContactAndAddress(page)
await checkoutButton.click()
await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
const customerOrder = page.url().split('/').pop()
log(/^BN-\d+$/.test(customerOrder), `customer order placed (${customerOrder})`)
await page.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
log(await visible(page.getByRole('link', { name: `Order ${customerOrder}` })), 'the order is in the account (from the server)')
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
log(await visible(page.getByRole('link', { name: `Order ${customerOrder}` })), 'still listed with browser storage cleared (saved on the server)')
log(!(await page.getByRole('link', { name: `Order ${guestOrder}` }).isVisible()), "the guest's order is not in this customer's list")
const someoneElses = await page.evaluate(async (number) => (await fetch(`/api/shop/orders/${number}`)).status, guestOrder)
log(someoneElses === 404, `another person's order can't be opened by number (${someoneElses})`)

// ---------- 3. The admin handles the order; the customer sees each step ----------
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
const admin = watchErrors(await adminCtx.newPage(), errors)
await adminSignIn(admin, ADMIN_USER)
await admin.getByRole('heading', { name: 'Overview' }).waitFor()
await admin.goto(`${BASE}/admin/orders?q=${customerOrder}`, { waitUntil: 'networkidle' })
log(await visible(admin.locator('tbody').getByText(customerOrder)), 'admin: the order is listed (search by number)')
await admin.goto(`${BASE}/admin/orders/${customerOrder}`, { waitUntil: 'networkidle' })
await axe(admin, 'admin order')
// Phase 3: shipping and payment are documents (Ship dialog, Invoice dialog)
await admin.getByRole('button', { name: 'Ship', exact: true }).click()
await admin.getByRole('dialog').getByLabel('Carrier').selectOption('dhl')
await admin.getByRole('dialog').getByRole('button', { name: 'Create shipment' }).click()
log(await visible(admin.getByText(/Shipment SHP-\d+|SHP-\d+/).first()), 'admin: shipped (shipment created)')
const shippedMail = await latestMail(SHOPPER.email)
log(/shipped|on its way/i.test(shippedMail?.subject ?? ''), `customer emailed about shipping ("${shippedMail?.subject}")`)
await page.goto(`${BASE}/account/orders/${customerOrder}`, { waitUntil: 'networkidle' })
log(await visible(page.getByText('Shipped').first()), 'the customer sees "Shipped" on their order')
await admin.getByRole('button', { name: 'Mark as delivered' }).click()
await admin.getByRole('dialog').getByRole('button', { name: 'Mark as delivered' }).click()
await admin.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30000 })
// Phase 14 §4: delivering a cash on delivery order records the cash and invoices it, so the
// Invoice button goes away; other payment methods still invoice by hand. Ask the server (the
// page may still show the old button for a moment), then reload so the page matches it.
let afterDelivery = null
for (let waited = 0; waited <= 15000; waited += 500) {
  afterDelivery = (await api(`/api/admin/v1/orders/${customerOrder}`, { token: adminToken })).body.data
  if (afterDelivery?.status === 'delivered') break
  await admin.waitForTimeout(500)
}
await admin.reload({ waitUntil: 'networkidle' })
const invoiceButton = admin.getByRole('button', { name: 'Invoice', exact: true })
if (afterDelivery?.payment_status !== 'paid') {
  await invoiceButton.click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
} else {
  log(await visible(admin.getByText(/INV-\d+/).first()), 'cash on delivery: marking it delivered invoiced the order')
}
// Creating the invoice also renders its PDF and sends the email: under a full run that can take more
// than a second, so wait for the order to say so (up to 15 s) instead of a fixed pause.
let delivered = null
for (let waited = 0; waited <= 15000; waited += 500) {
  delivered = (await api(`/api/admin/v1/orders/${customerOrder}`, { token: adminToken })).body.data
  if (delivered?.status === 'delivered' && delivered?.payment_status === 'paid') break
  await admin.waitForTimeout(500)
}
log(delivered.status === 'delivered' && delivered.payment_status === 'paid', `delivered and paid (${delivered.status}, ${delivered.payment_status})`)
log(delivered.history.some((entry) => entry.admin_name === 'Store Admin'), 'history records which admin did it')
log(!(await admin.getByRole('button', { name: 'Cancel order' }).isVisible()), 'a delivered order offers no cancel')

// ---------- 4. Card payment waits; cancelling returns the stock ----------
const stockThird = await stockOf(third.id)
await addToCart(page, third.id)
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
await checkoutButton.waitFor({ timeout: 20000 })
await page.getByRole('radio', { name: /Credit or debit card/ }).check()
log(await visible(page.getByText(/No payment provider is connected yet/)), 'card: says honestly that nothing is charged yet')
await fillContactAndAddress(page)
await checkoutButton.click()
await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
const cardOrder = page.url().split('/').pop()
log(await visible(page.getByText(/Awaiting payment/).first()), `card order is "Awaiting payment" (${cardOrder})`)
log((await stockOf(third.id)) === stockThird - 1, 'stock reserved for the unpaid order')
await admin.goto(`${BASE}/admin/orders/${cardOrder}`, { waitUntil: 'networkidle' })
await admin.getByRole('button', { name: 'Cancel order' }).click()
await admin.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click()
await admin.waitForTimeout(800)
log((await api(`/api/admin/v1/orders/${cardOrder}`, { token: adminToken })).body.data.status === 'cancelled', 'admin cancelled the unpaid order')
log((await stockOf(third.id)) === stockThird, `cancelling put the stock back (${await stockOf(third.id)})`)

// ---------- 5. A price changes while the shopper is at checkout ----------
const original = (await api(`/api/admin/v1/products/${first.id}`, { token: adminToken })).body.data.price
await addToCart(page, first.id)
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
await checkoutButton.waitFor({ timeout: 20000 })
await fillContactAndAddress(page)
const raised = (Number(original) + 5).toFixed(2)
await api(`/api/admin/v1/products/${first.id}`, { method: 'PATCH', token: adminToken, body: { price: Number(raised) } })
const before = await checkoutButton.textContent()
await checkoutButton.click()
log(await visible(page.getByText(/Prices changed/i)), 'price changed during checkout: the order is stopped and explained')
log(/\/checkout/.test(page.url()), 'no order was placed at the old price')
await page.waitForTimeout(1000)
const after = await page.getByRole('button', { name: /^Place order · / }).textContent()
log(after !== before, `checkout now shows the new total (${before.trim()} → ${after.trim()})`)
await api(`/api/admin/v1/products/${first.id}`, { method: 'PATCH', token: adminToken, body: { price: Number(original) } })

// ---------- 6. An admin edit appears in the store ----------
await admin.goto(`${BASE}/admin/products/${second.id}`, { waitUntil: 'networkidle' })
await admin.getByLabel('Status').selectOption('draft')
await admin.getByRole('button', { name: 'Save changes' }).click()
await admin.waitForTimeout(800)
const hidden = await api(`/api/v1/products/${second.id}`)
log(hidden.status === 404, 'admin: a product set to Draft disappears from the store API')
const storefront = watchErrors(await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(), errors)
await storefront.goto(`${BASE}/products/${second.id}`, { waitUntil: 'networkidle' })
log(await visible(storefront.getByText(/not found/i)), 'the draft product page says "not found" to shoppers')
await api(`/api/admin/v1/products/${second.id}`, { method: 'PATCH', token: adminToken, body: { status: 'active' } })

// ---------- 7. The overview counts real orders ----------
await admin.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
const overview = (await api('/api/admin/v1/overview', { token: adminToken })).body.data
log(overview.orders.total >= 3 && overview.orders.by_status.cancelled >= 1, `overview counts real orders (${overview.orders.total} orders)`)
await axe(admin, 'overview (real data)')

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
