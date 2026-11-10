// Robustness and security: tampered browser data, edge cases, and (on the production build) the CSP.
import { BASE, DEMO_ADMIN, isProductionBuild, launch, reporter, storefrontSignIn, visible, watchErrors } from './lib.mjs'

const report = reporter('security and robustness')
const { log } = report
const browser = await launch()
const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = watchErrors(await ctx.newPage(), errors)
const setStore = (key, value) => page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [key, value])

// Tampered guest cart: an object where text belongs, a 150% discount, negative stock
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await setStore('buynest.cart.v1', {
  items: [{ productId: 1, quantity: 1, price: 9.99, title: 'Tampered', notice: { x: 1 }, discountPercentage: 150, stock: -1 }],
  couponCode: { evil: 1 },
})
await page.reload({ waitUntil: 'networkidle' })
log(await visible(page.getByRole('heading', { level: 1 })), 'tampered cart: the store still renders')
log(!(await page.getByText("BuyNest couldn't load").isVisible()), 'tampered cart: no crash screen')
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('buynest.cart.v1')))
const [line] = saved.items
log(line.notice === null && line.discountPercentage === null && line.stock === null && saved.couponCode === null, 'tampered cart: invalid fields reset to null')
await page.evaluate(() => localStorage.removeItem('buynest.cart.v1'))

// Catalog edge cases
await page.goto(`${BASE}/products?minPrice=500&maxPrice=100`, { waitUntil: 'networkidle' })
log((await page.getByRole('button', { name: /Remove filter: (From|Up to)/ }).count()) === 0, 'impossible price range: ignored, no misleading chips')
await page.goto(`${BASE}/products?q=a&page=2`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Remove filter: Search/ }).click()
await page.waitForTimeout(300)
const params = new URL(page.url()).searchParams
log(!params.has('page') && !params.has('q'), `removing the search chip returns to page 1 (${page.url()})`)

// Escape in the mobile menu's search closes the suggestions first, not the whole menu
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Open menu' }).click()
const menu = page.locator('dialog[open]')
const menuSearch = menu.getByRole('combobox')
await menuSearch.fill('phone')
await menu.getByRole('listbox').waitFor({ state: 'visible', timeout: 8000 })
await menuSearch.press('Escape')
await page.waitForTimeout(300)
log((await menu.count()) === 1 && !(await menu.getByRole('listbox').isVisible()), 'Escape closes the suggestions but keeps the mobile menu open')
await menuSearch.press('Escape') // native search field: clears the text
await page.waitForTimeout(200)
await menuSearch.press('Escape')
await page.waitForTimeout(400)
log((await page.locator('dialog[open]').count()) === 0, 'further Escapes clear the text, then close the menu')
await page.setViewportSize({ width: 1280, height: 900 })

// Signed in: demo credentials, the cached profile, the guest-only sign-in page
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
log(await page.getByText('Demo account:').isVisible(), 'demo account offered (DummyJSON builds only)')
await storefrontSignIn(page, DEMO_ADMIN)
const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('buynest.session.v2')))
log(cached && !('phone' in cached.user) && !('address' in cached.user), `cached profile has no phone or address (${Object.keys(cached?.user ?? {})})`)
await page.goto(`${BASE}/login`)
const sawForm = await page.getByLabel('Username').isVisible().catch(() => false)
await page.waitForURL(/\/account/, { timeout: 15000 })
log(!sawForm, 'a signed-in visit to /login never shows the form')

// Tampered order history: the broken order is dropped, the page still works
await setStore(`buynest.orders.v1.user-${cached.user.id}`, { orders: [{ id: 'BN-BAD', userId: cached.user.id, placedAt: 1e20, items: [null], totals: { total: 1 } }] })
await page.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
log(!(await page.getByText('Something went wrong on this page').isVisible()), 'tampered orders: the orders page still renders')

// Checkout: a tampered 99% discount is corrected on arrival; the coupon is locked while ordering
await setStore(`buynest.cart.v1.user-${cached.user.id}`, {
  items: [{ productId: 1, quantity: 1, price: 9.99, title: 'Essence Mascara Lash Princess', discountPercentage: 99, stock: 99, minimumOrderQuantity: 1 }],
  couponCode: null,
})
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
const placeOrder = page.getByRole('button', { name: /^Place order · / })
await placeOrder.waitFor({ timeout: 20000 })
const label = await placeOrder.textContent()
log(!/\$0\.10/.test(label), `checkout re-checks prices on arrival (${label.trim()})`)
log(await page.getByText(/changed since you added/).isVisible(), 'checkout explains that an item changed')
await page.route('**/carts/add', async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await route.continue()
})
await placeOrder.click()
await page.waitForTimeout(400)
log((await page.getByLabel('Discount code').isDisabled().catch(() => 'missing')) === true, 'discount code locked while the order is placed')
await page.waitForURL(/order-confirmation/, { timeout: 20000 }).catch(() => {})
log(/order-confirmation/.test(page.url()), `order placed at the corrected price (${page.url()})`)
await page.unroute('**/carts/add')

// Content-Security-Policy: only the production build has it (the dev server needs inline scripts)
if (isProductionBuild) {
  const cspPage = await ctx.newPage()
  const violations = []
  cspPage.on('console', (message) => /Content Security Policy|Refused to/i.test(message.text()) && violations.push(message.text().slice(0, 200)))
  await cspPage.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) => console.error(`Refused (CSP) ${event.violatedDirective} ${event.blockedURI}`)),
  )
  const paths = ['/', '/products', '/products/1', '/cart', '/wishlist', '/account', '/account/orders', '/checkout', '/admin/', '/admin/products', '/admin/products/1', '/admin/orders/1', '/admin/customers']
  for (const path of paths) await cspPage.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  log(violations.length === 0, `CSP: no violations across ${paths.length} store and admin pages ${violations.length ? JSON.stringify(violations) : ''}`)
  log(await cspPage.evaluate(async () => (await document.fonts.ready, document.fonts.check('16px Inter'))), 'CSP: web fonts still load')
  const brokenImages = await cspPage.evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth === 0).length)
  log(brokenImages === 0, `CSP: no blocked images (${brokenImages})`)
  const metaTags = await cspPage.evaluate(() => document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length)
  log(metaTags === 1, 'CSP: the admin app has its policy too')
} else {
  console.log('(CSP checks skipped: run against the production build, BASE_URL=http://localhost:4173)')
}

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
