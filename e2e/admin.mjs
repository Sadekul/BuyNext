// Admin dashboard (/admin), end to end: access rules, every page, demo writes, layout, accessibility.
import {
  BASE,
  DEMO_ADMIN,
  DEMO_CUSTOMER,
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

// 1. Signed out → the admin sign-in page
let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
let page = await newPage(ctx)
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
log(/\/admin\/login$/.test(page.url()) && (await visible(page.getByRole('heading', { name: 'BuyNest Admin' }))), `signed out: /admin → admin sign-in (${page.url()})`)
await axe(page, 'sign-in')

// 2. A customer account: no access, in the UI and in the API
await storefrontSignIn(page, DEMO_CUSTOMER)
log((await page.getByRole('link', { name: 'Shop admin' }).count()) === 0, 'customer account page has no "Shop admin" link')
await page.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
log(await visible(page.getByRole('heading', { name: 'No admin access' })), 'customer account: "No admin access" page')
await axe(page, 'no access')
const apiStatus = await page.evaluate(async () => (await fetch('/api/admin/customers')).status)
log(apiStatus === 403, `customer account: admin API refuses with 403 (${apiStatus})`)
// The customer then tries the admin sign-in form: refused and signed back out
await page.getByRole('button', { name: 'Sign in with an admin account' }).click()
await page.getByLabel('Username').fill(DEMO_CUSTOMER.username)
await page.getByLabel('Password').fill(DEMO_CUSTOMER.password)
await page.getByRole('button', { name: 'Sign in' }).click()
log(await visible(page.getByRole('alert').filter({ hasText: 'not a shop admin' })), 'customer signing in on the admin page is refused')
await page.waitForTimeout(500)
log(!(await ctx.cookies()).some((cookie) => cookie.name === 'buynest_at'), 'refused customer is signed back out (no session cookie)')
await ctx.close()

// 3. An admin, via the storefront: "Shop admin" opens the dashboard on the same session
ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
page = await newPage(ctx)
await storefrontSignIn(page, DEMO_ADMIN)
await page.getByRole('link', { name: 'Shop admin' }).click()
log(await visible(page.getByRole('heading', { name: 'Overview' })), 'admin: "Shop admin" link opens the dashboard without signing in again')
await page.locator('.stat').first().waitFor()
const stats = await page.locator('.stat').allInnerTexts()
log(stats.length === 7 && /Revenue/.test(stats[0]) && /\$/.test(stats[0]) && stats.some((tile) => /Average order/.test(tile)), `overview: hero revenue + 6 tiles incl. average order (${stats[0]?.replace(/\n/g, ' ')})`)
log((await page.locator('#restock-title').count()) === 1 && (await page.locator('.status svg').count()) > 0, 'overview: restock table with icon + label status badges')
await axe(page, 'overview')
await page.screenshot({ path: 'admin-overview-1440.png', fullPage: true })

// Products: search, category, sort
await page.getByRole('link', { name: 'Products' }).click()
await page.getByRole('table').waitFor()
log(/194 products/.test(await page.locator('.page-header').innerText()), 'products: 194 products listed')
await page.getByLabel('Search products').fill('phone')
await page.getByRole('button', { name: 'Search' }).click()
await page.waitForURL(/q=phone/)
await page.waitForFunction(() => /phone/i.test(document.querySelector('tbody')?.innerText ?? ''), null, { timeout: 15000 }).catch(() => {})
log((await page.locator('tbody tr').count()) > 0, `products: search "phone" → ${await page.locator('tbody tr').count()} rows`)
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

// Edit, delete, add (demo writes)
await page.goto(`${BASE}/admin/products/1`, { waitUntil: 'networkidle' })
await page.getByLabel('Price (USD)').waitFor()
log(await page.getByRole('button', { name: 'Save changes' }).isDisabled(), 'edit: Save disabled until something changes')
await page.getByLabel('Price (USD)').fill('-3')
await page.getByRole('button', { name: 'Save changes' }).click()
log(await visible(page.getByText('Enter a price from 0 to 1,000,000.')), 'edit: invalid price shows a field error')
await page.getByLabel('Price (USD)').fill('19.99')
await page.getByRole('button', { name: 'Save changes' }).click()
log(await visible(page.getByRole('status').filter({ hasText: 'Changes saved (demo)' })), 'edit: price 19.99 saved (demo notice)')
await axe(page, 'product form')

await page.goto(`${BASE}/admin/products?q=mascara`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /^Delete / }).first().click()
log(await visible(page.getByRole('dialog', { name: 'Delete this product?' })), 'delete: asks for confirmation')
await page.getByRole('button', { name: 'Delete product' }).click()
log(await visible(page.getByRole('status').filter({ hasText: 'deleted (demo)' })), 'delete: demo notice after confirming')

await page.goto(`${BASE}/admin/products/new`, { waitUntil: 'networkidle' })
await page.getByLabel('Name').fill('Bamboo Desk Organizer')
await page.getByLabel('Brand').fill('NestWorks')
await page.getByLabel('Category').selectOption('home-decoration')
await page.getByLabel('Price (USD)').fill('24.5')
await page.getByLabel('Units in stock').fill('40')
await page.getByRole('button', { name: 'Add product' }).click()
log(await visible(page.getByRole('status').filter({ hasText: /Product created \(demo, id #\d+\)/ })), 'add: product created (demo, with the new id)')

// Orders and customers
await page.getByRole('link', { name: 'Orders' }).click()
await page.getByRole('table').waitFor()
const ordersHeader = await page.locator('.page-header').innerText()
log(/208 orders/.test(ordersHeader), `orders: all 208 DummyJSON orders (${ordersHeader.replace(/\n/g, ' ')})`)
await page.getByRole('button', { name: /Next/ }).click()
await page.waitForURL(/skip=20/)
log(await visible(page.getByText(/21–40 of 208/)), 'orders: next page (21–40 of 208)')
await page.locator('tbody a').first().click()
log(await visible(page.getByRole('heading', { name: 'Customer' })) && (await page.locator('tfoot').innerText()).includes('Total after discounts'), 'order detail: items, totals, and customer')
await axe(page, 'order detail')
await page.getByRole('link', { name: 'Customers' }).click()
await page.getByRole('table').waitFor()
const customersJson = await page.evaluate(async () => (await fetch('/api/admin/customers?limit=100')).text())
log(!/password|ssn|iban|cardNumber|"ip"/i.test(customersJson), 'customers: API response has no passwords, SSN, bank, or IP data')
await page.getByLabel('Search customers').fill('emily')
await page.getByRole('button', { name: 'Search' }).click()
await page.waitForURL(/q=emily/)
log(await visible(page.locator('tbody').getByText(/Emily/)), 'customers: search "emily"')
await axe(page, 'customers')

// Phone-sized layout
await page.setViewportSize({ width: 390, height: 844 })
for (const path of ['/admin/', '/admin/products', '/admin/orders/1', '/admin/customers']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const overflow = await sidewaysOverflow(page)
  log(overflow <= 0, `390px ${path}: no sideways page scroll (${overflow}px)`)
}
await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
await page.screenshot({ path: 'admin-overview-390.png', fullPage: true })
await page.setViewportSize({ width: 1440, height: 900 })

// Signing out in the admin also signs out an open storefront tab
const store = await newPage(ctx)
await store.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
await store.getByRole('heading', { name: /Hi, Emily/ }).waitFor()
await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Sign out' }).click()
log(await visible(page.getByRole('heading', { name: 'BuyNest Admin' })), 'admin sign-out → admin sign-in page')
log(await store.waitForURL(/\/login/, { timeout: 8000 }).then(() => true, () => false), 'admin sign-out also signs out the open storefront tab')
await page.waitForTimeout(500)
log(!(await ctx.cookies()).some((cookie) => cookie.name === 'buynest_at'), 'admin sign-out deletes the session cookies')
await ctx.close()

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
