// Admin dashboard (/admin), end to end: separate admin accounts, every page, demo writes, layout, accessibility.
import {
  ADMIN_USER,
  BASE,
  ID_LABEL,
  LARAVEL,
  NOT_ADMIN,
  SHOPPER,
  SHOPPER_2,
  adminSignIn,
  axeViolations,
  launch,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('admin dashboard')
const { log } = report
const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const newPage = async (ctx) => watchErrors(await ctx.newPage(), errors)
const adminCookies = async (ctx) => (await ctx.cookies()).filter((cookie) => cookie.name.startsWith('buynest_admin_'))

// 1. Signed out → the admin sign-in page
let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
let page = await newPage(ctx)
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
log(/\/admin\/login$/.test(page.url()) && (await visible(page.getByRole('heading', { name: 'BuyNest Admin' }))), `signed out: /admin → admin sign-in (${page.url()})`)
log(await page.getByLabel(ID_LABEL).isVisible(), `admin signs in with ${LARAVEL ? 'an email' : 'a username'}`)
await axe(page, 'sign-in')

// 2. A customer: separate session, refused at the admin sign-in, refused by the API
await storefrontSignIn(page, NOT_ADMIN)
log((await page.getByRole('link', { name: 'Shop admin' }).count()) === 0, 'customer account page has no "Shop admin" link')
await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
log(/\/admin\/login$/.test(page.url()), 'a signed-in customer is still signed out of the admin (separate sessions)')
const apiStatus = await page.evaluate(async () => (await fetch('/api/admin/customers')).status)
log(apiStatus === 401, `customer session: admin API refuses (${apiStatus})`)
await adminSignIn(page, NOT_ADMIN)
const refusal = LARAVEL ? 'The email or password is incorrect.' : 'not a shop admin'
log(await visible(page.getByRole('alert').filter({ hasText: refusal })), `customer's own password at the admin sign-in: refused ("${refusal}")`)
await page.waitForTimeout(300)
log((await adminCookies(ctx)).length === 0, 'refused customer gets no admin session cookie')
await ctx.close()

// 3. An admin signs in on the admin's own page
ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
page = await newPage(ctx)
await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
await adminSignIn(page, ADMIN_USER)
log(await visible(page.getByRole('heading', { name: 'Overview' })), 'admin signs in and lands on the overview')
const adminAccess = (await adminCookies(ctx)).find((cookie) => cookie.name === 'buynest_admin_at')
log(adminAccess?.httpOnly && adminAccess.sameSite === 'Strict' && adminAccess.path === '/api/admin', `admin session cookie: HttpOnly, SameSite=Strict, Path=/api/admin (${adminAccess?.path})`)
log(!(await ctx.cookies()).some((cookie) => cookie.name === 'buynest_at'), 'signing in to the admin does not sign in to the storefront')
log(await visible(page.getByText(ADMIN_USER.name)), `sidebar shows the admin (${ADMIN_USER.name})`)
await page.locator('.stat').first().waitFor()
const stats = await page.locator('.stat').allInnerTexts()
log(stats.length === 7 && /Lifetime sales/.test(stats[0]) && /\$/.test(stats[0]) && stats.some((tile) => /Average order/.test(tile)), `overview: lifetime sales + 6 tiles incl. average order (${stats[0]?.replace(/\n/g, ' ')})`)
log((await page.locator('#restock-title').count()) === 1 && (await page.locator('.status svg').count()) > 0, 'overview: restock table with icon + label status badges')
await axe(page, 'overview')
await page.screenshot({ path: 'admin-overview-1440.png', fullPage: true })

// Products: search, category, sort
await page.getByRole('link', { name: 'Products', exact: true }).click()
await page.getByRole('table').waitFor()
log(/194 products/.test(await page.locator('.page-header').innerText()), 'products: 194 products listed')
await page.getByLabel('Search products').fill('phone')
await page.getByRole('button', { name: 'Search' }).click()
await page.waitForURL(/q=phone/)
await page.waitForFunction(() => /phone/i.test(document.querySelector('tbody')?.innerText ?? ''), null, { timeout: 15000 }).catch(() => {})
log((await page.locator('tbody tr').count()) > 0, `products: search "phone" → ${await page.locator('tbody tr').count()} rows`)
if (LARAVEL) {
  // The real API combines search and category: "phone" among laptops finds nothing.
  await page.getByLabel('Category').selectOption('laptops')
  await page.waitForURL(/q=phone.*category=laptops|category=laptops.*q=phone/)
  log(await visible(page.getByText('No products match.')), 'products: search and category combine (phone + laptops = none)')
  await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
}
await page.getByLabel('Category').selectOption('laptops')
await page.waitForURL(/category=laptops/)
// The previous rows stay visible while the next page loads: wait for the new ones.
await page.waitForFunction(() => [...document.querySelectorAll('tbody td:nth-child(2)')].every((td) => td.textContent === 'Laptops'), null, { timeout: 15000 }).catch(() => {})
log((await page.locator('tbody tr').count()) === 5 && !/q=/.test(page.url()), 'products: category filter (laptops = 5) clears the search')
await page.getByLabel('Sort').selectOption('price:desc')
await page.waitForURL(/sortBy=price/)
await page
  .waitForFunction(
    () => {
      const values = [...document.querySelectorAll('tbody td.num')].map((td) => Number(td.textContent.replace(/[$,]/g, '')))
      return values.length === 5 && values.every((value, i) => i === 0 || values[i - 1] >= value)
    },
    null,
    { timeout: 15000 },
  )
  .catch(() => {})
const prices = (await page.locator('tbody td.num').allInnerTexts()).map((price) => Number(price.replace(/[$,]/g, '')))
log(prices.length === 5 && prices.every((price, i) => i === 0 || prices[i - 1] >= price), `products: sort price high → low (${prices.slice(0, 3)})`)
await axe(page, 'products')

// Add, edit, delete. With the real shop the test only changes a product it created itself.
await page.goto(`${BASE}/admin/products/new`, { waitUntil: 'networkidle' })
const testName = `E2E Bamboo Desk Organizer ${Date.now()}`
await page.getByLabel('Name').fill(testName)
await page.getByLabel('Brand').fill('NestWorks')
await page.getByLabel('Category').selectOption('home-decoration')
await page.getByLabel('Price (USD)').fill('24.5')
await page.getByLabel('Units in stock').fill('40')
if (LARAVEL) await page.getByLabel('Status').selectOption('draft') // never shown to shoppers
await page.getByRole('button', { name: 'Add product' }).click()
let editId = 1
if (LARAVEL) {
  await page.waitForURL(/\/admin\/products\/\d+$/, { timeout: 15000 }).catch(() => {})
  editId = Number(page.url().split('/').pop())
  log(Number.isInteger(editId) && (await visible(page.getByText('Product created.'))), `add: product saved (id #${editId}, Draft)`)
} else {
  log(await visible(page.getByRole('status').filter({ hasText: /Product created \(demo, id #\d+\)/ })), 'add: product created (demo, with the new id)')
}

await page.goto(`${BASE}/admin/products/${editId}`, { waitUntil: 'networkidle' })
await page.getByLabel('Price (USD)').waitFor()
log(await page.getByRole('button', { name: 'Save changes' }).isDisabled(), 'edit: Save disabled until something changes')
await page.getByLabel('Price (USD)').fill('-3')
await page.getByRole('button', { name: 'Save changes' }).click()
log(await visible(page.getByText('Enter a price from 0 to 1,000,000.')), 'edit: invalid price shows a field error')
await page.getByLabel('Price (USD)').fill('19.99')
await page.getByRole('button', { name: 'Save changes' }).click()
log(await visible(page.getByRole('status').filter({ hasText: LARAVEL ? 'Changes saved.' : 'Changes saved (demo)' })), `edit: price 19.99 saved${LARAVEL ? '' : ' (demo notice)'}`)
if (LARAVEL) {
  await page.reload({ waitUntil: 'networkidle' })
  log((await page.getByLabel('Price (USD)').inputValue()) === '19.99', 'edit: the new price is still there after a reload (stored)')
}
await axe(page, 'product form')

await page.goto(`${BASE}/admin/products?q=${encodeURIComponent(LARAVEL ? testName : 'mascara')}${LARAVEL ? '&status=draft' : ''}`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /^Delete / }).first().click()
log(await visible(page.getByRole('dialog', { name: 'Delete this product?' })), 'delete: asks for confirmation')
await page.getByRole('button', { name: 'Delete product' }).click()
log(await visible(page.getByRole('status').filter({ hasText: LARAVEL ? 'is no longer in the store' : 'deleted (demo)' })), `delete: ${LARAVEL ? 'deleted' : 'demo notice'} after confirming`)

// Orders
await page.getByRole('link', { name: 'Orders', exact: true }).click()
await page.getByRole('table').waitFor()
const ordersHeader = await page.locator('.page-header').innerText()
if (LARAVEL) {
  log(/\d+ orders?/.test(ordersHeader), `orders: the real orders are listed (${ordersHeader.replace(/\n/g, ' ')})`)
  await page.getByLabel('Status').selectOption('cancelled')
  await page.waitForURL(/status=cancelled/)
  await page.waitForTimeout(800)
  const statuses = await page.locator('tbody .status').allInnerTexts()
  log(statuses.length === 0 || statuses.filter((text) => /Cancelled/.test(text)).length === (await page.locator('tbody tr').count()), 'orders: status filter shows only cancelled orders')
  await page.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' })
} else {
  log(/208 orders/.test(ordersHeader), `orders: all 208 DummyJSON orders (${ordersHeader.replace(/\n/g, ' ')})`)
  await page.getByRole('button', { name: /Next/ }).click()
  await page.waitForURL(/skip=20/)
  log(await visible(page.getByText(/21–40 of 208/)), 'orders: next page (21–40 of 208)')
}
if ((await page.locator('tbody a').count()) > 0) {
  await page.locator('tbody a').first().click()
  log(await visible(page.getByRole('heading', { name: 'Customer' })), 'order detail: items, totals, and customer')
  await axe(page, 'order detail')
}
await page.getByRole('link', { name: 'All customers', exact: true }).click()
await page.getByRole('table').waitFor()
const customersJson = await page.evaluate(async () => (await fetch('/api/admin/customers?limit=100')).text())
log(!/password|ssn|iban|cardNumber|"ip"|token/i.test(customersJson), 'customers: API response has no passwords, tokens, SSN, bank, or IP data')
const searchFor = LARAVEL ? SHOPPER.firstName : 'emily'
await page.getByLabel('Search customers').fill(searchFor)
await page.getByRole('button', { name: 'Search' }).click()
await page.waitForURL(new RegExp(`q=${searchFor}`))
log(await visible(page.locator('tbody').getByText(new RegExp(searchFor, 'i'))), `customers: search "${searchFor}"`)
await axe(page, 'customers')

if (LARAVEL) {
  // Real customers: block one, and they are locked out of the storefront; unblock, and they're back
  const shopperContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const shopper = await newPage(shopperContext)
  await storefrontSignIn(shopper, SHOPPER_2)
  await page.goto(`${BASE}/admin/customers?q=${SHOPPER_2.firstName}`, { waitUntil: 'networkidle' })
  const blockButton = page.getByRole('button', { name: new RegExp(`^Block ${SHOPPER_2.firstName}`) })
  await blockButton.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Block account' }).click()
  log(await visible(page.getByRole('status').filter({ hasText: 'signed out everywhere' })), 'block: confirmed, with a notice')
  log(await visible(page.locator('tbody').getByText('Blocked')), 'block: status shows "Blocked" (icon + word)')
  await shopper.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
  log(/\/login/.test(shopper.url()), `block: the customer's open session ends (${new URL(shopper.url()).pathname})`)
  await shopper.getByLabel('Email').fill(SHOPPER_2.email)
  await shopper.getByLabel('Password', { exact: true }).fill(SHOPPER_2.password)
  await shopper.getByRole('button', { name: /^sign in$/i }).click()
  log(await visible(shopper.getByRole('alert').filter({ hasText: 'disabled' })), 'block: the customer cannot sign in again')
  await page.getByRole('button', { name: new RegExp(`^Unblock ${SHOPPER_2.firstName}`) }).click()
  log(await visible(page.getByRole('status').filter({ hasText: 'can sign in again' })), 'unblock: notice')
  await storefrontSignIn(shopper, SHOPPER_2)
  log(/\/account/.test(shopper.url()), 'unblock: the customer can sign in again')
  await shopperContext.close()
  await page.getByLabel('Status').selectOption('blocked')
  await page.waitForURL(/status=blocked/)
  await page.waitForTimeout(500)
  log(!(await page.locator('tbody').getByText(SHOPPER_2.firstName).isVisible().catch(() => false)), 'status filter: "Blocked" no longer lists the unblocked customer')
}

// Phone-sized layout
await page.setViewportSize({ width: 390, height: 844 })
for (const path of ['/admin/', '/admin/products', LARAVEL ? '/admin/orders' : '/admin/orders/1', '/admin/customers']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const overflow = await sidewaysOverflow(page)
  log(overflow <= 0, `390px ${path}: no sideways page scroll (${overflow}px)`)
}
await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
await page.screenshot({ path: 'admin-overview-390.png', fullPage: true })
await page.setViewportSize({ width: 1440, height: 900 })

// Two separate sessions: a storefront sign-in in the same browser, then the admin signs out
const store = await newPage(ctx)
await storefrontSignIn(store, SHOPPER)
await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
log(await visible(page.getByRole('heading', { name: 'Overview' })), 'a storefront sign-in leaves the admin session alone')
await page.getByRole('button', { name: 'Sign out' }).click()
log(await visible(page.getByRole('heading', { name: 'BuyNest Admin' })), 'admin sign-out → admin sign-in page')
await page.waitForTimeout(500)
log((await adminCookies(ctx)).length === 0, 'admin sign-out deletes the admin session cookies')
await store.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
log(await visible(store.getByRole('heading', { name: new RegExp(`Hi, ${SHOPPER.firstName}`) })), 'admin sign-out leaves the storefront customer signed in')
await page.goto(`${BASE}/admin/customers`, { waitUntil: 'networkidle' })
log(/\/admin\/login$/.test(page.url()), 'after sign-out the admin pages need a sign-in again')
await ctx.close()

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
