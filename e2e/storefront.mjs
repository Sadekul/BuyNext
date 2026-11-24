// Storefront shopping flows, end to end: browse, search, product page, cart, wishlist, checkout, orders.
import {
  BASE,
  LARAVEL,
  SHOPPER,
  axeViolations,
  fillEmptyAddress,
  headerCounts,
  launch,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('storefront')
const { log } = report
const browser = await launch()
const errors = []
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
const page = watchErrors(await ctx.newPage(), errors)
const axe = async (name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const resultCount = async () => Number((await page.getByText(/of \d+ products?$/).first().textContent()).match(/of (\d+)/)[1])

// ---------- Home ----------
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
log(await visible(page.getByRole('heading', { level: 1 })), 'home: hero heading')
log((await page.locator('.product-card').count()) >= 4, `home: product cards (${await page.locator('.product-card').count()})`)
log((await page.getByRole('navigation', { name: 'Main' }).getByRole('link').count()) >= 5, 'home: main navigation links')
await axe('home')

// ---------- Catalog: filters, sort, pages, URL state ----------
await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' })
await page.locator('.product-card').first().waitFor()
const total = await resultCount()
log(total === 194, `catalog: 194 products (${total})`)
log((await page.locator('.product-card').count()) === 12, 'catalog: 12 per page')
await page.getByRole('link', { name: 'Page 2' }).or(page.getByRole('button', { name: 'Page 2' })).first().click()
await page.waitForURL(/page=2/)
log(true, 'catalog: page 2 in the URL')
const filters = page.locator('[aria-label="Product filters"]').first()
await filters.getByRole('checkbox', { name: /^Apple/ }).check()
await page.waitForURL(/brand=Apple/)
await page.waitForTimeout(400)
const appleCount = await resultCount()
log(appleCount > 0 && appleCount < 194 && !/page=/.test(page.url()), `catalog: brand filter (Apple → ${appleCount}) resets to page 1`)
log(await visible(page.getByRole('button', { name: /Remove filter: Apple/ })), 'catalog: active filter chip')
await page.getByLabel('Sort by').selectOption({ index: 2 })
await page.waitForURL(/sort=/)
log(true, `catalog: sort in the URL (${new URL(page.url()).searchParams.get('sort')})`)
// Filter and sort changes replace the history entry (no Back-button entry per click),
// so Back returns to where the shopper was before filtering: page 1 here.
await page.goBack()
await page.waitForTimeout(400)
log(!/sort=|brand=/.test(page.url()) && (await page.locator('.product-card').count()) === 12, `catalog: Back returns to before filtering (${page.url()})`)
await page.goto(`${BASE}/products?brand=Apple`, { waitUntil: 'networkidle' })
log((await resultCount()) === appleCount, 'catalog: a shared filter link shows the same results')
await page.getByRole('button', { name: /Remove filter: Apple/ }).click()
await page.waitForTimeout(400)
log((await resultCount()) === 194, 'catalog: removing the chip shows everything again')
await page.goto(`${BASE}/products?page=abc&sort=nonsense&minPrice=500&maxPrice=100`, { waitUntil: 'networkidle' })
await page.locator('.product-card').first().waitFor()
log((await resultCount()) === 194 && (await page.getByRole('button', { name: /Remove filter: (From|Up to)/ }).count()) === 0, 'catalog: invalid URL values are ignored safely')
await page.goto(`${BASE}/categories/laptops`, { waitUntil: 'networkidle' })
log(await visible(page.getByRole('heading', { name: /Laptops/i })) && (await resultCount()) === 5, 'catalog: category page (laptops = 5)')
await axe('catalog')

// ---------- Search suggestions ----------
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
const search = page.getByRole('combobox').first()
await search.fill('iphone')
const suggestions = page.getByRole('listbox', { name: 'Search suggestions' }).first()
log(await visible(suggestions), 'search: suggestions appear while typing')
await search.press('ArrowDown')
log((await search.getAttribute('aria-activedescendant')) !== null, 'search: arrow keys move through suggestions')
await search.press('Escape')
await search.press('Enter')
await page.waitForURL(/\/products\?q=iphone/)
log((await resultCount()) > 0, `search: results page for "iphone" (${await resultCount()})`)

// ---------- Product page ----------
// A simple product (phase 16 made the iPhone 13 Pro configurable: configurable.mjs covers choosing first).
await page.goto(`${BASE}/products/124`, { waitUntil: 'networkidle' })
const details = page.locator('.product-details')
log(await visible(page.getByRole('heading', { name: 'iPhone X', level: 1 })), 'product: title')
log(await visible(page.getByRole('navigation', { name: 'Breadcrumb' })), 'product: breadcrumb')
const thumbs = page.getByRole('button', { name: /Show image/ })
if ((await thumbs.count()) > 1) {
  await thumbs.nth(1).click()
  log((await thumbs.nth(1).getAttribute('aria-pressed')) === 'true' || (await thumbs.nth(1).getAttribute('aria-current')) !== null, 'product: gallery thumbnails switch the image')
}
await details.getByRole('button', { name: 'Increase quantity' }).click()
await details.getByRole('button', { name: 'Add to cart' }).click()
log(await visible(page.getByRole('dialog', { name: /Your cart/ })), 'product: adding opens the mini cart')
log((await headerCounts(page)).cart === 2, `product: cart badge shows 2 (${(await headerCounts(page)).cart})`)
await page.getByRole('dialog', { name: /Your cart/ }).getByRole('button', { name: 'Close' }).click()
await page.getByRole('dialog', { name: /Your cart/ }).waitFor({ state: 'hidden' })
await page.goto(`${BASE}/products/99999`, { waitUntil: 'networkidle' })
log(await visible(page.getByText(/not found/i)), 'product: unknown product shows "not found"')
await page.goto(`${BASE}/products/123`, { waitUntil: 'networkidle' })
await axe('product')

// ---------- Wishlist ----------
await page.goto(`${BASE}/products/5`, { waitUntil: 'networkidle' })
await page.locator('.product-details .wishlist-button--button').click()
log((await headerCounts(page)).wishlist === 1, 'wishlist: saved from the product page')
await page.goto(`${BASE}/wishlist`, { waitUntil: 'networkidle' })
log((await page.getByRole('button', { name: /Remove .* from wishlist/ }).count()) === 1, 'wishlist: page lists the saved product')
await axe('wishlist')
await page.getByRole('button', { name: /Remove .* from wishlist/ }).click()
log((await headerCounts(page)).wishlist === 0, 'wishlist: remove')

// ---------- Cart page: quantity, coupons, shipping ----------
await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: 'Shopping cart' }).waitFor()
const qtyGroup = page.getByRole('group', { name: /Quantity for iPhone/ })
await qtyGroup.getByRole('button', { name: 'Decrease quantity' }).click()
await page.waitForTimeout(300)
log((await headerCounts(page)).cart === 1, 'cart: decrease quantity')
await page.getByLabel('Discount code').fill('NOPE')
await page.getByRole('button', { name: 'Apply' }).click()
log(await visible(page.getByText('This code is not valid.')), 'cart: invalid code explained')
await page.getByRole('button', { name: 'Remove code NOPE' }).click()
await page.getByLabel('Discount code').fill('nest10')
await page.getByRole('button', { name: 'Apply' }).click()
log(await visible(page.getByText(/NEST10/)), 'cart: NEST10 applied (any letter case)')
log(await visible(page.getByText(/free shipping/i)), 'cart: free-shipping status shown')
await axe('cart')

// ---------- Checkout → confirmation → order history ----------
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
// The real shop (BuyNest API) lets guests buy; the DummyJSON demo needs a sign-in.
log(LARAVEL ? !/\/login/.test(page.url()) : /\/login/.test(page.url()), LARAVEL ? 'checkout: open to guests' : 'checkout: needs sign-in first')
await storefrontSignIn(page, SHOPPER)
await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
const placeOrder = page.getByRole('button', { name: /^Place order · / })
// The cart filled as a guest must have moved into the account at sign-in,
// even though the page was reloaded straight afterwards.
log(await visible(placeOrder, 20000), 'checkout: guest cart carried into the account (survives an immediate reload)')
await placeOrder.waitFor({ timeout: 5000 })
await page.getByLabel('Phone', { exact: true }).fill('abc')
await placeOrder.click()
log(await visible(page.getByText('Enter a valid phone number.')), 'checkout: invalid phone is flagged')
await page.getByLabel('Phone', { exact: true }).fill('+1 555 010 2030')
await fillEmptyAddress(page)
await axe('checkout')
await placeOrder.click()
await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
const orderId = page.url().split('/').pop()
log(/^BN-/.test(orderId), `checkout: order placed (${orderId})`)
log(await visible(page.getByRole('heading', { name: /Thank you/ })), 'checkout: confirmation page')
log((await headerCounts(page)).cart === 0, 'checkout: ordered items removed from the cart')
await page.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle' })
log(await visible(page.getByRole('link', { name: `Order ${orderId}` })), 'orders: the new order is listed')
await page.getByRole('link', { name: `Order ${orderId}` }).click()
log(await visible(page.getByRole('heading', { name: `Order ${orderId}` })), 'orders: order details')
await axe('order details')

// ---------- Not found, phone layout ----------
await page.goto(`${BASE}/no-such-page`, { waitUntil: 'networkidle' })
log(await visible(page.getByRole('heading', { name: 'Page not found' })), 'unknown address → "Page not found"')
await page.setViewportSize({ width: 390, height: 844 })
for (const path of ['/', '/products', '/products/123', '/cart', '/wishlist', '/account/orders', '/login']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const overflow = await sidewaysOverflow(page)
  log(overflow <= 0, `390px ${path}: no sideways page scroll (${overflow}px)`)
}
await page.getByRole('button', { name: 'Open menu' }).click()
log(await visible(page.getByRole('navigation', { name: 'Mobile main' })), '390px: menu opens')

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
