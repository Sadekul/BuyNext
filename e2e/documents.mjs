// Phase 3: coupons managed in the admin and checked by the server; invoices, shipments with tracking, refunds.
// Needs the BuyNest API (E2E_ACCOUNTS=laravel).
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

const report = reporter('invoices, shipments, refunds, coupons')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
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
const token = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body.data.tokens.access_token
const order = async (number) => (await api(`/api/admin/v1/orders/${number}`, { token })).body.data
const latestMail = async (email) => (await (await fetch(`${LARAVEL_URL}/dev/mailbox/latest?to=${encodeURIComponent(email)}`)).json()).data
const stockOf = async (id) => (await api(`/api/v1/products/${id}`)).body.data.stock_quantity

// A product under $50 (so shipping is charged) that anyone can buy two of
const product = (await api('/api/v1/products?per_page=100&available=1&sort=price&direction=asc')).body.data.find(
  (item) => item.min_order_quantity === 1 && item.stock_quantity >= 20 && Number(item.sale_price) > 10 && Number(item.sale_price) < 20,
)
const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const run = Date.now().toString(36).toUpperCase()
const code = `E2E-SHIP-${run}`

const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
const admin = watchErrors(await adminCtx.newPage(), errors)
await adminSignIn(admin, ADMIN_USER)
await admin.getByRole('heading', { name: 'Overview' }).waitFor()

// ---------- Coupons: created in the admin ----------
await admin.goto(`${BASE}/admin/coupons/new`, { waitUntil: 'networkidle' })
await axe(admin, 'coupon form')
await admin.getByLabel('Code').fill(code.toLowerCase())
await admin.getByLabel('Type').selectOption('free_shipping')
await admin.getByLabel('Total uses (optional)').fill('1')
await admin.getByRole('button', { name: 'Add coupon' }).click()
await admin.waitForTimeout(1000)
const created = (await api(`/api/admin/v1/coupons?search=${code}`, { token })).body.data[0]
log(created?.code === code && created.type === 'free_shipping' && created.usage_limit === 1, `admin: coupon saved in capitals (${created?.code}, ${created?.status})`)
await admin.goto(`${BASE}/admin/coupons?q=${code}`, { waitUntil: 'networkidle' })
log(await visible(admin.locator('tbody').getByText('Active')), 'admin: coupon listed as Active (icon + word)')
await axe(admin, 'coupons')

// ---------- A guest uses it: the server decides ----------
let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
let page = watchErrors(await ctx.newPage(), errors)
await page.goto(`${BASE}/products/${product.id}`, { waitUntil: 'networkidle' })
await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
await page.getByLabel('Discount code').fill('NOT-A-CODE')
await page.getByRole('button', { name: 'Apply' }).click()
log(await visible(page.getByText(/This code is not valid/)), 'cart: an unknown code is refused by the server')
await page.getByRole('button', { name: /Remove code/ }).click()
await page.getByLabel('Discount code').fill(code.toLowerCase())
await page.getByRole('button', { name: 'Apply' }).click()
log(await visible(page.getByText(/Free shipping/i).first()), 'cart: the new coupon applies (free shipping)')
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
const placeOrder = page.getByRole('button', { name: /^Place order · / })
await placeOrder.waitFor({ timeout: 20000 })
await page.locator('[name="email"]').fill(`docs.${run.toLowerCase()}@example.com`)
await page.locator('[name="phone"]').fill('+1 555 010 2040')
await page.locator('[name="shipping.firstName"]').fill('Dana')
await page.locator('[name="shipping.lastName"]').fill('Docs')
await fillEmptyAddress(page)
await page.getByRole('radio', { name: /Express/ }).check()
await page.waitForTimeout(1500)
await placeOrder.click()
await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
const guestOrder = page.url().split('/').pop()
const placed = await order(guestOrder)
log(placed?.coupon_code === code && placed.totals.shipping === '0.00', `guest order ${guestOrder}: express shipping free with the coupon (${placed?.totals.shipping})`)
await ctx.close()

// The coupon had one use: the next shopper is told so
ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
page = watchErrors(await ctx.newPage(), errors)
await page.goto(`${BASE}/products/${product.id}`, { waitUntil: 'networkidle' })
await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
await page.getByLabel('Discount code').fill(code)
await page.getByRole('button', { name: 'Apply' }).click()
log(await visible(page.getByText(/fully used/)), 'cart: a used-up coupon is refused ("fully used")')
await ctx.close()

// ---------- Invoice and shipment for the guest order ----------
await admin.goto(`${BASE}/admin/orders/${guestOrder}`, { waitUntil: 'networkidle' })
log(!(await admin.getByRole('button', { name: 'Ship', exact: true }).isVisible()) || placed.payment_method === 'cod', 'admin: an unpaid card order offers Invoice before Ship')
await admin.getByRole('button', { name: 'Invoice', exact: true }).click()
await axe(admin, 'invoice dialog')
await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
log(await visible(admin.getByText(/Invoice INV-\d+ created|INV-\d+/).first()), 'admin: invoice created')
log((await order(guestOrder)).payment_status === 'paid', 'invoice records the payment (paid)')
await admin.getByRole('button', { name: 'Refund', exact: true }).waitFor({ timeout: 10000 }) // the page has reloaded the paid order
log(!(await admin.getByRole('button', { name: 'Cancel order' }).isVisible()), 'a paid (invoiced) order offers no cancel, only refunds')
await admin.getByRole('button', { name: 'Ship', exact: true }).click()
await admin.getByRole('dialog').getByLabel('Carrier').selectOption('ups')
await admin.getByRole('dialog').getByLabel('Tracking number (optional)').fill('1z999aa10123456784')
await admin.getByRole('dialog').getByRole('button', { name: 'Create shipment' }).click()
await admin.waitForTimeout(1000)
const shipped = await order(guestOrder)
log(shipped.status === 'shipped' && shipped.shipments[0]?.tracking_number === '1Z999AA10123456784', `shipped with UPS tracking ${shipped.shipments[0]?.tracking_number}`)
const shipMail = await latestMail(`docs.${run.toLowerCase()}@example.com`)
log(/on its way/i.test(shipMail?.subject ?? '') && /1Z999AA10123456784/.test(shipMail?.text ?? ''), `shipment email with the tracking number ("${shipMail?.subject}")`)

// The guest tracks it: carrier link
ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
page = watchErrors(await ctx.newPage(), errors)
await page.goto(`${BASE}/track-order`, { waitUntil: 'networkidle' })
await page.getByLabel('Order number').fill(guestOrder)
await page.getByLabel('Email').fill(`docs.${run.toLowerCase()}@example.com`)
await page.getByRole('button', { name: 'Find my order' }).click()
const trackLink = page.getByRole('link', { name: /Track with UPS/ })
log(await visible(trackLink), 'guest tracking page shows "Track with UPS"')
log(/^https:\/\/www\.ups\.com\/track\?tracknum=1Z999AA10123456784/.test((await trackLink.getAttribute('href')) ?? '') && (await trackLink.getAttribute('rel'))?.includes('noopener'), 'the tracking link goes to UPS, safely (noopener)')
await ctx.close()

// ---------- A customer's order: invoice, partial refund, then full refund ----------
ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, bypassCSP: true })
page = watchErrors(await ctx.newPage(), errors)
await storefrontSignIn(page, SHOPPER)
await page.goto(`${BASE}/products/${product.id}`, { waitUntil: 'networkidle' })
await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
await page.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click().catch(() => {})
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /^Place order · / }).waitFor({ timeout: 20000 })
const phone = page.locator('[name="phone"]')
if (!(await phone.inputValue())) await phone.fill('+1 555 010 2030')
for (const [name, value] of [['firstName', 'Ava'], ['lastName', 'Customer']]) {
  const input = page.locator(`[name="shipping.${name}"]`)
  if (!(await input.inputValue())) await input.fill(value)
}
await fillEmptyAddress(page)
await page.getByRole('button', { name: /^Place order · / }).click()
await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
const customerOrder = page.url().split('/').pop()
const units = (await order(customerOrder)).items[0].quantity
log(/^BN-/.test(customerOrder), `customer order ${customerOrder} (${units} unit${units === 1 ? '' : 's'})`)

await admin.goto(`${BASE}/admin/orders/${customerOrder}`, { waitUntil: 'networkidle' })
await admin.getByRole('button', { name: 'Invoice', exact: true }).click()
await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
await admin.waitForTimeout(800)
const stockBeforeRefund = await stockOf(product.id)
await admin.getByRole('button', { name: 'Refund', exact: true }).click()
const refund = admin.getByRole('dialog')
await refund.getByLabel(/Quantity of .* to refund/).first().fill('1')
await refund.getByLabel('Return the refunded items to stock').check()
await axe(admin, 'refund dialog')
await refund.getByRole('button', { name: /^Refund \$/ }).click()
await admin.waitForTimeout(1200)
const partly = await order(customerOrder)
// Shipping wasn't refunded yet, so even a one-unit order is only partly refunded.
log(partly.credit_memos.length === 1 && partly.payment_status === 'partially_refunded', `refund of one unit: ${partly.payment_status} (${partly.credit_memos[0]?.number})`)
log((await stockOf(product.id)) === stockBeforeRefund + 1, 'the refunded unit went back to stock')
const refundMail = await latestMail(SHOPPER.email)
log(/Refund for order/.test(refundMail?.subject ?? ''), `refund email ("${refundMail?.subject}")`)

// Refund the rest: any remaining units and the shipping
await admin.getByRole('button', { name: 'Refund', exact: true }).click()
const rest = admin.getByRole('dialog')
if (units > 1) await rest.getByLabel(/Quantity of .* to refund/).first().fill(String(units - 1))
await rest.getByLabel('Shipping refund (USD)').fill((await order(customerOrder)).totals.shipping)
await rest.getByLabel('Return the refunded items to stock').check()
await rest.getByRole('button', { name: /^Refund \$/ }).click()
await admin.waitForTimeout(1200)
const closed = await order(customerOrder)
log(closed.status === 'closed' && closed.payment_status === 'refunded' && closed.totals.refunded === closed.totals.paid, `fully refunded → Closed (refunded ${closed.totals.refunded} of ${closed.totals.paid})`)

// The customer sees the documents
await page.goto(`${BASE}/account/orders/${customerOrder}`, { waitUntil: 'networkidle' })
log(await visible(page.getByText(/Closed/).first()), 'customer: the order shows "Closed"')
log(await visible(page.getByText(/Refund CM-\d+/).first()), 'customer: refunds listed')
await page.getByRole('link', { name: /Invoice INV-\d+/ }).first().click()
log(await visible(page.getByRole('heading', { name: /Invoice INV-\d+/ })), 'customer: printable invoice page')
log(await page.getByRole('button', { name: /Print/ }).isVisible(), 'invoice page has a Print button')
await axe(page, 'invoice page')
const otherInvoice = shipped.invoices[0].number
const foreign = await page.evaluate(async ([number, invoice]) => (await fetch(`/api/shop/orders/${number}/invoices/${invoice}`)).status, [guestOrder, otherInvoice])
log(foreign === 404, `someone else's invoice is refused (${foreign})`)
await ctx.close()

// ---------- Sales lists ----------
await admin.goto(`${BASE}/admin/invoices`, { waitUntil: 'networkidle' })
log(await visible(admin.locator('tbody').getByText(otherInvoice)), 'admin: Invoices list')
await admin.goto(`${BASE}/admin/credit-memos`, { waitUntil: 'networkidle' })
log(await visible(admin.locator('tbody').getByText(closed.credit_memos[0].number)), 'admin: Credit memos list')
await axe(admin, 'credit memos')

// ---------- Clean up the test coupon: used once, so it is disabled, not deleted ----------
await admin.goto(`${BASE}/admin/coupons?q=${code}`, { waitUntil: 'networkidle' })
await admin.getByRole('button', { name: `Delete ${code}` }).click()
await admin.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
await admin.waitForTimeout(800)
const after = (await api(`/api/admin/v1/coupons?search=${code}`, { token })).body.data[0]
log(after && after.is_active === false, 'a coupon that was used is disabled instead of deleted (keeps the history)')

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
