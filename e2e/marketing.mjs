// Phase 7: Magento-style marketing and system. Catalog price rules (for everyone and for a customer
// group), cart price rules (an automatic rule with a minimum and free shipping, a code for one category,
// buy X get Y) through the cart, checkout, the order, and a partial refund; the newsletter (double opt-in,
// a campaign with its test, send, List-Unsubscribe header, and unsubscribe page, the account switch);
// email templates; SEO (meta and Open Graph tags, sitemap, robots.txt, URL redirects, search terms);
// a saved cart restored on another device; abandoned carts and the reminder; the dashboard and the
// notifications bell; grid preferences; and what a Marketing admin may do.
// Needs the BuyNest API (E2E_ACCOUNTS=laravel) and php (rows that need time to pass are backdated with
// `php artisan tinker`). It works on its own test category, product, group, rules, coupons, subscribers,
// redirects, and search terms, and removes them at the end. Orders, credit memos, the sent test campaign,
// and coupons used by the test order can't be deleted (the coupons are disabled), like in the other suites.
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
  headerCounts,
  latestCode,
  launch,
  preserveStock,
  reporter,
  overflowCulprits,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('marketing: price rules, cart rules, newsletter, templates, SEO, carts, dashboard')
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
    // A busy run can hit the API's per-minute limit: wait as asked, then retry (not the reminder limit this suite checks).
    if (response.status === 429 && attempt < 4 && !path.includes('/remind')) {
      await new Promise((resolve) => setTimeout(resolve, (Number(response.headers.get('retry-after')) || 5) * 1000))
      continue
    }
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers }
  }
}
const signInApi = async (email, password) => (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email, password } })).body?.data?.tokens?.access_token
const customerToken = async (account) => (await api('/api/v1/auth/login', { method: 'POST', body: { email: account.email, password: account.password } })).body?.data?.tokens?.access_token
const owner = await signInApi(ADMIN_USER.email, ADMIN_USER.password)
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const productOf = async (id) => (await admin$(`/products/${id}`)).body?.data
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const usd = (value) => `$${Number(value).toFixed(2)}`
const cents = (value) => Math.round(Number(value) * 100)
/** A guest's cart priced by the server (no token: a customer's token would overwrite their saved cart). */
const quote = async (items, couponCode) =>
  (await api('/api/v1/cart/validate', { method: 'POST', body: { items: items.map(([product_id, quantity]) => ({ product_id, quantity })), coupon_code: couponCode ?? null, shipping_method: 'standard' } })).body?.data
/** Runs PHP in the backend (local development only): backdating the suite's own rows, cache, cleanup. */
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
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}
const latestMailId = async (email) => (await latestMail(email, { tries: 1 }))?.id ?? 0

const run = Date.now().toString(36)
const marker = `e2e${run}`
const categoryName = `E2E Marketing ${run}`
const productName = `E2E Lamp ${marker}`
const groupName = `E2E Mkt Group ${run}`
const saleName = `E2E Sale ${run}`
const groupRuleName = `E2E Members ${run}`
const autoLabel = `E2E Free shipping ${run}`
const categoryCode = `E2ECAT${run}`.toUpperCase()
const categoryLabel = `E2E Lamps 10% ${run}`
const bogoCode = `E2EBXGY${run}`.toUpperCase()
const bogoLabel = `E2E Buy 2 get 1 ${run}`
const subscriberEmail = `news.${marker}@buynest.test`
const campaignSubject = `E2E news ${run}`
const templateSubject = `E2E ${run}: confirm your email for {{ store_name }}`
const signUp = { first_name: 'Tess', last_name: 'Template', email: `tess.${marker}@buynest.test`, phone: '+1 555 010 4321', password: 'TessCheck2026pass' }
const redirectFrom = `/e2e-old-${run}`
const searchRedirectTerm = `e2ego${run}`
const filterName = `E2E ${run}`
const DRESS = 166 // Tartan Dress: a real product outside the test category (minimum order 1)

// What this suite changes, recorded first so it can be put back
const restoreStock = await preserveStock()
const findCustomer = async (email) => ((await admin$(`/customers?search=${encodeURIComponent(email)}`)).body?.data ?? []).find((customer) => customer.email === email)
const shopper1 = await findCustomer(SHOPPER.email)
const shopper2 = await findCustomer(SHOPPER_2.email)
const shopper2GroupBefore = (await admin$(`/customers/${shopper2.id}`)).body?.data?.group?.id ?? null
const shopperNewsletterBefore = (await api('/api/v1/me', { token: await customerToken(SHOPPER) })).body?.data?.newsletter ?? false
const shopperSubscriberBefore = ((await admin$(`/newsletter/subscribers?search=${encodeURIComponent(SHOPPER.email)}`)).body?.data ?? []).find((item) => item.email === SHOPPER.email) ?? null
const templateBefore = (await admin$('/email-templates/email_verification')).body?.data
const gridBefore = (await admin$('/preferences/products_grid')).body?.data?.value ?? null
const unreadBefore = []
for (let page = 1; page <= 10; page++) {
  const { body } = await admin$(`/notifications?unread=1&per_page=50&page=${page}`)
  unreadBefore.push(...(body?.data ?? []).map((item) => item.id))
  if (!body?.meta || page >= body.meta.last_page) break
}
const made = { category: null, product: null, group: null, rules: [], coupons: [], admin: null, redirects: [], signUpCustomer: null }

const browser = await launch()
const errors = []
const axe = async (page, name) => {
  const violations = await axeViolations(page)
  log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
}
const status = (page, text) => page.getByRole('status').filter({ hasText: text })
/** A browser context with a short default wait, so a missing element fails a check instead of the run. */
async function newPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, bypassCSP: true })
  context.setDefaultTimeout(15000)
  // Page loads wait for a quiet network; under a full run the busy dev server sometimes needs more than 15 s (SQA D2).
  context.setDefaultNavigationTimeout(45000)
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
/** Store: empties the cart page (lines left by earlier runs). */
async function emptyCart(page) {
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
  const lines = page.locator('.cart-page__list .cart-line')
  for (let guard = 0; guard < 20 && (await lines.count()) > 0; guard++) {
    await lines.first().getByRole('button', { name: /^Remove / }).click()
    await page.waitForTimeout(300)
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
/** The <dd> of a summary row whose <dt> starts with `label`. */
const summaryRow = (scope, label) => scope.locator('dl.cart-summary__rows > div').filter({ has: scope.page().locator('dt', { hasText: label }) }).locator('dd')
const metaOf = (page) =>
  page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content ?? null,
    canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content ?? null,
    ogType: document.querySelector('meta[property="og:type"]')?.content ?? null,
    ogUrl: document.querySelector('meta[property="og:url"]')?.content ?? null,
    ogImage: document.querySelector('meta[property="og:image"]')?.content ?? null,
  }))

let admin
let productId
let category
let group
try {
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  adminCtx.setDefaultTimeout(15000)
  adminCtx.setDefaultNavigationTimeout(45000)
  admin = watchErrors(await adminCtx.newPage(), errors)
  await adminSignIn(admin, ADMIN_USER)
  await admin.getByRole('heading', { name: 'Overview' }).waitFor()

  // ---------- Setup: a test category (API), and a Draft → Active test product (admin) ----------
  const categoryMade = await admin$('/categories', { method: 'POST', body: { name: categoryName, description: 'Things the marketing browser check creates and removes.' } })
  category = categoryMade.body?.data
  made.category = category?.id ?? null
  log(categoryMade.status === 201, `a test category (API): ${categoryName} (/${category?.slug})`)
  const groupMade = await admin$('/customer-groups', { method: 'POST', body: { name: groupName, discount_percent: 0 } })
  group = groupMade.body?.data
  made.group = group?.id ?? null
  log(groupMade.status === 201, `a test customer group without its own discount (API): ${groupName}`)

  await admin.goto(`${BASE}/admin/products/new`, { waitUntil: 'networkidle' })
  await admin.getByLabel('Name', { exact: true }).fill(productName)
  await admin.getByLabel('Brand').fill('NestWorks')
  await admin.getByLabel('Category').selectOption(category.slug)
  await admin.getByLabel('Price (USD)').fill('20')
  await admin.getByLabel('Units in stock').fill('50')
  await admin.getByLabel('Status').selectOption('draft')
  await admin.getByRole('button', { name: 'Add product' }).click()
  await admin.waitForURL(/\/admin\/products\/\d+$/, { timeout: 15000 }).catch(() => {})
  productId = Number(admin.url().split('/').pop())
  if (Number.isInteger(productId)) made.product = productId
  log(Number.isInteger(productId) && (await productOf(productId))?.status === 'draft', `test product created as a Draft (#${productId}, $20.00, 50 in stock)`)
  await admin.getByLabel('Status').selectOption('active')
  await admin.getByRole('button', { name: 'Save changes' }).click()
  log(await visible(status(admin, 'It is live in the store.')), 'and set Active')

  // ---------- 1. Catalog price rules ----------
  await part('catalog price rules', async () => {
    await admin.goto(`${BASE}/admin/catalog-rules`, { waitUntil: 'networkidle' })
    log(await visible(admin.getByRole('heading', { name: 'Catalog price rules' })), 'Marketing → Catalog price rules opens')
    await axe(admin, 'catalog price rules list')
    const addRule = async ({ name, percent, priority = '0', groups = [] }) => {
      await admin.goto(`${BASE}/admin/catalog-rules/new`, { waitUntil: 'networkidle' })
      await admin.getByLabel('Rule name').fill(name)
      await admin.getByLabel('Discount type').selectOption('percent')
      await admin.getByLabel('Percent off').fill(percent)
      await admin.getByLabel('Priority', { exact: true }).fill(priority)
      for (const groupLabel of groups) await admin.getByRole('group', { name: 'Customer groups' }).getByRole('checkbox', { name: groupLabel }).check()
      const products = admin.getByRole('group', { name: 'Products', exact: true })
      await products.getByLabel('Search products to add').fill(marker)
      await products.getByRole('button', { name: 'Search' }).click()
      await products.getByRole('button', { name: `Add ${productName}` }).click()
      log(await visible(products.locator('.picker-list').first().getByText(productName)), `rule form: the product picker adds ${productName}`)
      if (groups.length === 0) await axe(admin, 'catalog price rule form')
      await admin.getByRole('button', { name: 'Add rule' }).click()
      await admin.waitForURL(/\/admin\/catalog-rules\/\d+$/, { timeout: 15000 }).catch(() => {})
      const id = Number(admin.url().split('/').pop())
      if (Number.isInteger(id)) made.rules.push(id)
      log(await visible(status(admin, 'Rule created.')), `rule "${name}" created (${percent}% off, priority ${priority}${groups.length ? `, ${groups.join(', ')} only` : ''})`)
      return id
    }
    const saleId = await addRule({ name: saleName, percent: '10' })
    const saleRule = (await admin$(`/catalog-rules/${saleId}`)).body?.data
    log(saleRule?.product_ids?.[0] === productId && saleRule.customer_group_ids.length === 0 && saleRule.status === 'active', `saved: product #${productId} only, everyone, ${saleRule?.status}`)
    const preview = admin.locator('section[aria-labelledby="rule-preview-title"]')
    const previewRow = preview.getByRole('row').filter({ hasText: productName })
    await previewRow.waitFor({ timeout: 15000 }).catch(() => {})
    const previewText = (await previewRow.innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(previewText.includes('$20.00') && previewText.includes('$18.00'), `preview of affected products: "${previewText}"`)
    log(await visible(preview.getByText('1 product.')), 'preview counts 1 product')
    await axe(admin, 'catalog price rule with its preview')

    // The store, as a guest in a fresh browser (catalog answers are cached per browser for a minute)
    const guest = await newPage()
    await guest.goto(`${BASE}/products/${productId}`, { waitUntil: 'networkidle' })
    const details = guest.locator('.product-details')
    await details.locator('.product-details__price-current').waitFor()
    const shown = (await details.locator('.product-details__price').innerText()).replace(/\s+/g, ' ')
    log(shown.includes('$18.00') && shown.includes('$20.00') && shown.includes(saleName), `product page: the sale price, the old price, and the rule's name ("${shown}")`)
    await axe(guest, 'product page with a price rule')
    await guest.goto(`${BASE}/categories/${category.slug}`, { waitUntil: 'networkidle' })
    const card = guest.locator('article.product-card').filter({ hasText: productName })
    await card.waitFor({ timeout: 15000 }).catch(() => {})
    const cardPrice = (await card.locator('.product-card__price').innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(cardPrice.includes('$18.00') && cardPrice.includes('$20.00'), `category listing: the card shows the sale price ("${cardPrice}")`)
    await guest.goto(`${BASE}/products?q=${encodeURIComponent(marker)}`, { waitUntil: 'networkidle' })
    const found = guest.locator('article.product-card').filter({ hasText: productName })
    log((await visible(found)) && (await found.locator('.product-card__price').innerText()).includes('$18.00'), 'search results: the sale price too')
    await guest.context().close()
    const guestLine = (await quote([[productId, 1]]))?.lines?.[0]
    log(guestLine?.sale_price === '18.00' && guestLine.price_label === saleName && guestLine.price_rule?.id === saleId, `cart for everyone: ${guestLine?.sale_price}, labelled "${guestLine?.price_label}"`)

    // A rule for the test group only: the catalog stays the same, the group member's cart gets it
    const groupRuleId = await addRule({ name: groupRuleName, percent: '25', priority: '10', groups: [groupName] })
    const groupPreview = (await preview.getByRole('row').filter({ hasText: productName }).innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(groupPreview.includes('$15.00'), `group rule preview (this rule alone): "${groupPreview}"`)
    log((await admin$(`/catalog-rules/${groupRuleId}`)).body?.data?.customer_group_ids?.[0] === group.id, 'the group rule is saved for the test group only')
    const publicPrice = (await api(`/api/v1/products/${productId}`)).body?.data
    log(publicPrice?.sale_price === '18.00' && publicPrice.price_rule?.id === saleId, `the catalog ignores the group rule (${publicPrice?.sale_price}, ${publicPrice?.price_rule?.name})`)

    const moved = await admin$(`/customers/${shopper2.id}`, { method: 'PATCH', body: { group_id: group.id } })
    log(moved.status === 200, `SHOPPER_2 moved into ${groupName}`)
    const shop2 = await newPage()
    await storefrontSignIn(shop2, SHOPPER_2)
    await emptyCart(shop2)
    await addToCart(shop2, productId)
    await shop2.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    const line = shop2.locator('.cart-page__list .cart-line').filter({ hasText: productName })
    await line.locator('.cart-line__price-label').waitFor({ timeout: 15000 }).catch(() => {})
    const lineText = (await line.innerText().catch(() => '')).replace(/\s+/g, ' ')
    // The rules apply one after the other: $20.00 − 10% = $18.00, then − 25% = $13.50
    log(lineText.includes('$13.50') && lineText.includes(`${groupName} price`), `group member's cart: $13.50 with "${groupName} price" ("${lineText.slice(0, 120)}")`)
    await axe(shop2, 'cart with a group price rule')

    // ---------- 7. Abandoned carts: SHOPPER_2's priced cart, left for over an hour ----------
    const savedCart = (await api('/api/v1/me/cart', { token: await customerToken(SHOPPER_2) })).body?.data
    log(savedCart?.items?.some((item) => item.product_id === productId), "opening the cart page saved SHOPPER_2's cart on the server")
    tinker(`App\\Models\\CustomerCart::where('customer_id', ${shopper2.id})->update(['updated_at' => now()->subHours(2)]);`)
    await shop2.context().close()
    await admin.goto(`${BASE}/admin/abandoned-carts?q=${encodeURIComponent(SHOPPER_2.email)}`, { waitUntil: 'networkidle' })
    log(await visible(admin.getByRole('heading', { name: 'Abandoned carts' })), 'Reports → Abandoned carts opens')
    const cartRow = admin.locator('tbody tr').filter({ hasText: SHOPPER_2.email })
    await cartRow.waitFor({ timeout: 15000 }).catch(() => {})
    const cartText = (await cartRow.innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(cartText.includes(productName) && cartText.includes('$13.50') && /2 hours|2 h/.test(cartText), `the cart is listed (backdated 2 hours): "${cartText.slice(0, 140)}"`)
    await axe(admin, 'abandoned carts')
    const before = await latestMailId(SHOPPER_2.email)
    await cartRow.getByRole('button', { name: /^Remind / }).click()
    log(await visible(status(admin, 'Reminder sent to')), 'Remind: "Reminder sent to …"')
    const reminder = await latestMail(SHOPPER_2.email, { after: before })
    log(reminder?.subject === 'You left something in your cart' && reminder.text.includes(productName), `the reminder email arrives ("${reminder?.subject}", names the product)`)
    log(await visible(cartRow.getByText(/Reminded recently; possible again/)), 'the row now says when another reminder is possible (no Remind button)')
    const again = await admin$(`/reports/abandoned-carts/${shopper2.id}/remind`, { method: 'POST' })
    log(again.status === 429 && again.body?.code === 'too_soon', `a second reminder is refused as too soon (${again.status} ${again.body?.code}, Retry-After ${again.headers.get('retry-after')}s)`)
    await clearSavedCart(SHOPPER_2)
    const left = (await admin$(`/reports/abandoned-carts?search=${encodeURIComponent(SHOPPER_2.email)}`)).body?.data ?? []
    log(left.length === 0, "SHOPPER_2's abandoned cart is cleared afterwards")

    // Back to General, and the rules are deleted from the list
    await admin$(`/customers/${shopper2.id}`, { method: 'PATCH', body: { group_id: shopper2GroupBefore } })
    await admin.goto(`${BASE}/admin/catalog-rules?q=${encodeURIComponent(run)}`, { waitUntil: 'networkidle' })
    for (const name of [groupRuleName, saleName]) {
      await admin.getByRole('button', { name: `Delete ${name}` }).click()
      await admin.getByRole('dialog').getByRole('button', { name: 'Delete rule' }).click()
      await status(admin, `“${name}” deleted.`).waitFor({ timeout: 15000 }).catch(() => {})
    }
    const rulesLeft = ((await admin$(`/catalog-rules?search=${encodeURIComponent(run)}`)).body?.data ?? []).length
    if (rulesLeft === 0) made.rules = []
    log(rulesLeft === 0, 'both rules deleted from the list')
    log((await api(`/api/v1/products/${productId}`)).body?.data?.sale_price === '20.00', 'the product is back at $20.00')
  })

  // ---------- 2. Cart price rules ----------
  await part('cart price rules', async () => {
    const addCartRule = async ({ auto = false, code, description, type, value, buy, get, freeShipping, minSubtotal, appliesTo, withAxe = false }) => {
      await admin.goto(`${BASE}/admin/coupons/new`, { waitUntil: 'networkidle' })
      if (auto) await admin.getByLabel(/^Automatic, nothing to enter/).check()
      else await admin.getByLabel('Code', { exact: true }).fill(code)
      await admin.getByLabel('Description (optional)').fill(description)
      await admin.getByLabel('Type', { exact: true }).selectOption(type)
      if (value) await admin.getByLabel('Percent off').fill(value)
      if (buy) {
        await admin.getByLabel('Buy (units)').fill(buy)
        await admin.getByLabel('Get free (units)').fill(get)
      }
      if (freeShipping) await admin.getByLabel('Also give free shipping on the whole order').check()
      if (minSubtotal) await admin.getByLabel('Minimum spend (USD, optional)').fill(minSubtotal)
      await admin.getByLabel('Applies to').selectOption(appliesTo)
      if (appliesTo === 'categories') await admin.getByRole('group', { name: 'Eligible categories' }).getByRole('checkbox', { name: categoryName }).check()
      if (appliesTo === 'products') {
        const picker = admin.getByRole('group', { name: 'Eligible products' })
        await picker.getByLabel('Search products to add').fill(marker)
        await picker.getByRole('button', { name: 'Search' }).click()
        await picker.getByRole('button', { name: `Add ${productName}` }).click()
      }
      if (withAxe) await axe(admin, 'cart price rule form')
      await admin.getByRole('button', { name: 'Add coupon' }).click()
      await admin.waitForURL(/\/admin\/coupons\/\d+$/, { timeout: 15000 }).catch(() => {})
      const id = Number(admin.url().split('/').pop())
      if (Number.isInteger(id)) made.coupons.push(id)
      return (await admin$(`/coupons/${id}`)).body?.data
    }
    const auto = await addCartRule({ auto: true, description: autoLabel, type: 'percent', value: '5', freeShipping: true, minSubtotal: '30', appliesTo: 'products', withAxe: true })
    log(auto?.auto_apply === true && auto.code === null && auto.free_shipping && auto.min_subtotal === '30.00' && auto.product_ids?.[0] === productId, `automatic rule (no code): 5% off the test product, free shipping, from $30 ("${auto?.description}")`)
    const byCategory = await addCartRule({ code: categoryCode, description: categoryLabel, type: 'percent', value: '10', minSubtotal: '60', appliesTo: 'categories' })
    log(byCategory?.code === categoryCode && byCategory.applies_to === 'categories' && byCategory.category_ids?.[0] === category.id, `code ${categoryCode}: 10% off the test category, from $60`)
    const bogo = await addCartRule({ code: bogoCode, description: bogoLabel, type: 'buy_x_get_y', buy: '2', get: '1', appliesTo: 'products' })
    log(bogo?.type === 'buy_x_get_y' && bogo.buy_quantity === 2 && bogo.get_quantity === 1, `code ${bogoCode}: buy 2, get 1 free on the test product`)
    await admin.goto(`${BASE}/admin/coupons`, { waitUntil: 'networkidle' })
    log(await visible(admin.locator('tbody tr').filter({ hasText: autoLabel })), 'the coupon list shows the automatic rule by its name')
    await axe(admin, 'coupons list with cart rules')

    // The store, as SHOPPER
    const shop = await newPage()
    await storefrontSignIn(shop, SHOPPER)
    await emptyCart(shop)
    await addToCart(shop, productId)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    const summary = shop.locator('aside.cart-summary, section.cart-summary, .cart-summary').first()
    await summaryRow(summary, 'Estimated shipping').waitFor()
    await shop.waitForTimeout(800)
    log((await summaryRow(summary, 'Estimated shipping').innerText()).trim() === '$4.99' && (await summary.getByText(autoLabel).count()) === 0, 'cart with $20.00: no automatic rule yet, shipping $4.99')
    await shop.locator('.cart-page__list .cart-line').filter({ hasText: productName }).getByRole('button', { name: 'Increase quantity' }).click()
    const autoRow = summaryRow(summary, autoLabel)
    await autoRow.waitFor({ timeout: 15000 }).catch(() => {})
    const autoText = (await autoRow.innerText().catch(() => '')).trim()
    log(autoText.includes('−$2.00') && autoText.includes('Free shipping'), `2 × $20.00: the automatic rule applies by itself ("${autoLabel}: ${autoText}")`)
    log((await summaryRow(summary, 'Estimated shipping').innerText()).trim() === 'Free', 'and shipping is free')
    await shop.getByLabel('Discount code').fill(categoryCode)
    await shop.getByRole('button', { name: 'Apply', exact: true }).click()
    const couponMessage = shop.locator('.coupon-form__applied')
    await couponMessage.getByText('more to use this code').waitFor({ timeout: 15000 }).catch(() => {})
    const spendText = (await couponMessage.innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(spendText.includes('Spend $20.00 more to use this code.'), `the code needs $60: "${spendText}"`)
    await axe(shop, 'cart with an automatic rule and a code that needs more')
    await addToCart(shop, DRESS)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    const expected = await quote([[productId, 2], [DRESS, 1]], categoryCode)
    const codeRow = summaryRow(summary, `${categoryLabel} (${categoryCode})`)
    await codeRow.waitFor({ timeout: 15000 }).catch(() => {})
    const codeText = (await codeRow.innerText().catch(() => '')).trim()
    const ruleDiscount = (code) => expected?.applied_rules?.find((rule) => rule.code === code)?.discount
    log(codeText === `−${usd(ruleDiscount(categoryCode))}` && ruleDiscount(categoryCode) === '3.80', `with a $34.81 dress the code applies to the lamps only: "${categoryLabel} (${categoryCode})" ${codeText}`)
    log((await summaryRow(summary, autoLabel).innerText()).includes('−$2.00'), 'the automatic rule stays (one automatic rule + one code)')
    const lampLine = expected?.lines?.find((item) => item.product_id === productId)
    const dressLine = expected?.lines?.find((item) => item.product_id === DRESS)
    log(lampLine?.discount === '5.80' && dressLine?.discount === '0.00', `server: the lamps' line carries both rules ($${lampLine?.discount}), the dress none ($${dressLine?.discount})`)
    const totalShown = (await summaryRow(summary, 'Estimated total').innerText()).trim()
    log(totalShown === usd(expected?.totals?.total), `cart total ${totalShown} = the server's ${usd(expected?.totals?.total)}`)
    await axe(shop, 'cart with two cart price rules')

    // Checkout and the order
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    const placeOrder = shop.getByRole('button', { name: /^Place order · / })
    await placeOrder.waitFor({ timeout: 20000 })
    const phone = shop.locator('[name="phone"]')
    if (!(await phone.inputValue())) await phone.fill('+1 555 010 2030')
    for (const [name, value] of [['firstName', 'Ava'], ['lastName', 'Customer']]) {
      const input = shop.locator(`[name="shipping.${name}"]`)
      if (!(await input.inputValue())) await input.fill(value)
    }
    await fillEmptyAddress(shop)
    const checkoutSummary = shop.locator('.checkout__summary')
    await checkoutSummary.getByText(autoLabel).waitFor({ timeout: 15000 }).catch(() => {})
    const checkoutText = (await checkoutSummary.innerText()).replace(/\s+/g, ' ')
    log(checkoutText.includes(autoLabel) && checkoutText.includes(`${categoryLabel} (${categoryCode})`), 'checkout summary names both rules')
    await shop.waitForFunction((total) => document.querySelector('button[form="checkout-form"]')?.textContent?.includes(total), usd(expected?.totals?.total), { timeout: 15000 }).catch(() => {})
    log((await placeOrder.innerText()).includes(usd(expected?.totals?.total)), `Place order shows ${usd(expected?.totals?.total)}`)
    await axe(shop, 'checkout with cart price rules')
    await placeOrder.click()
    await shop.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 }).catch(() => {})
    const orderNumber = shop.url().split('/').pop()
    log(/^BN-/.test(orderNumber), `order placed with the rules: ${orderNumber}`)
    const order = await orderOf(orderNumber)
    const orderLamp = order?.items?.find((item) => item.product_id === productId)
    const orderDress = order?.items?.find((item) => item.product_id === DRESS)
    log(
      order?.applied_rules?.length === 2 && order.applied_rules[0].automatic && order.applied_rules[0].label === autoLabel && order.applied_rules[1].code === categoryCode && order.totals?.total === expected?.totals?.total,
      `the order keeps both rules (${(order?.applied_rules ?? []).map((rule) => `${rule.label} ${rule.discount}`).join(', ')}) and the total ${order?.totals?.total}`,
    )
    log(orderLamp?.discount === '5.80' && orderDress?.discount === '0.00', `order lines: lamps discount ${orderLamp?.discount}, dress ${orderDress?.discount}`)

    // A partial refund: one lamp gives back its own line's share, nothing of the dress's
    await admin.goto(`${BASE}/admin/orders/${orderNumber}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Invoice', exact: true }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
    await admin.getByRole('button', { name: 'Refund', exact: true }).waitFor({ timeout: 15000 })
    await admin.getByRole('button', { name: 'Refund', exact: true }).click()
    const refund = admin.getByRole('dialog')
    await refund.getByLabel(`Quantity of ${productName} to refund`, { exact: false }).fill('1')
    await refund.getByRole('button', { name: /^Refund \$/ }).click()
    await refund.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
    const memo = (await orderOf(orderNumber))?.credit_memos?.[0]
    const expectedRefund = Math.floor((cents(orderLamp?.line_total) - cents(orderLamp?.discount)) / orderLamp?.quantity) / 100
    const proportional = (cents(orderLamp?.line_total) - (cents(order?.totals?.discount) * cents(orderLamp?.line_total)) / (cents(orderLamp?.line_total) + cents(orderDress?.line_total))) / orderLamp?.quantity / 100
    log(
      memo?.items?.length === 1 && Number(memo.total) === expectedRefund,
      `credit memo ${memo?.number}: 1 lamp refunds ${usd(memo?.total)} = ($${orderLamp?.line_total} − its line discount $${orderLamp?.discount}) / ${orderLamp?.quantity} (the old even split would be ${usd(proportional)})`,
    )

    // Buy 2, get 1 free
    await addToCart(shop, productId)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    const lampCartLine = shop.locator('.cart-page__list .cart-line').filter({ hasText: productName })
    for (let i = 0; i < 2; i++) {
      await lampCartLine.getByRole('button', { name: 'Increase quantity' }).click()
      await shop.waitForTimeout(400)
    }
    await shop.getByLabel('Discount code').fill(bogoCode)
    await shop.getByRole('button', { name: 'Apply', exact: true }).click()
    const bogoExpected = await quote([[productId, 3]], bogoCode)
    const bogoDiscount = bogoExpected?.applied_rules?.find((rule) => rule.code === bogoCode)?.discount
    const bogoRow = summaryRow(summary, `${bogoLabel} (${bogoCode})`)
    await bogoRow.waitFor({ timeout: 15000 }).catch(() => {})
    const bogoText = (await bogoRow.innerText().catch(() => '')).trim()
    // The free unit is worth its sale price ($20.00); the automatic 5% still comes off the lamps too
    log(bogoText === `−${usd(bogoDiscount)}` && bogoDiscount === '20.00', `3 lamps with ${bogoCode}: the cheapest one is free ("${bogoText}")`)
    log((await summaryRow(summary, 'Estimated total').innerText()).trim() === usd(bogoExpected?.totals?.total), `total ${usd(bogoExpected?.totals?.total)} as the server says`)
    await shop.getByRole('button', { name: `Remove code ${bogoCode}` }).click()
    await emptyCart(shop)
    await shop.context().close()
  })

  // ---------- 3. Newsletter ----------
  await part('newsletter', async () => {
    const guest = await newPage()
    await guest.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const form = guest.locator('section.newsletter')
    const subscribe = async () => {
      await form.getByLabel('Email address').fill(subscriberEmail)
      await form.getByRole('button', { name: 'Subscribe' }).click()
      const modal = guest.getByRole('dialog', { name: 'Check your inbox' })
      await modal.waitFor({ timeout: 15000 }).catch(() => {})
      const text = (await modal.innerText().catch(() => '')).replace(/\s+/g, ' ')
      return { modal, text }
    }
    const first = await subscribe()
    log(first.text.includes("Thanks! If this address isn't subscribed yet, we've sent you a link to confirm."), `footer form: "${first.text.slice(0, 110)}…"`)
    await axe(guest, 'newsletter confirmation dialog')
    await first.modal.getByRole('button', { name: 'Continue shopping' }).click()
    const pending = ((await admin$(`/newsletter/subscribers?search=${encodeURIComponent(subscriberEmail)}`)).body?.data ?? [])[0]
    log(pending?.status === 'pending' && pending.source === 'footer', `saved as pending from the footer (${pending?.status}, ${pending?.source})`)
    const confirmMail = await latestMail(subscriberEmail)
    const confirmPath = confirmMail?.text.match(/\/newsletter\/confirm\?token=[^\s"<>)\]]+/)?.[0]
    log(Boolean(confirmPath), `the confirmation email has the link ("${confirmMail?.subject}")`)
    await guest.goto(`${BASE}${confirmPath}`, { waitUntil: 'networkidle' })
    log(await visible(guest.getByText("You're subscribed to the BuyNest newsletter.")), 'the link confirms: "You\'re subscribed to the BuyNest newsletter."')
    await axe(guest, 'newsletter confirm page')
    log(((await admin$(`/newsletter/subscribers?search=${encodeURIComponent(subscriberEmail)}`)).body?.data ?? [])[0]?.status === 'subscribed', 'and the address is subscribed')
    const mailsBefore = await latestMailId(subscriberEmail)
    await guest.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const second = await subscribe()
    log(second.text === first.text, 'subscribing again (already subscribed) shows exactly the same answer')
    await guest.waitForTimeout(1000)
    log((await latestMailId(subscriberEmail)) === mailsBefore, 'and sends no email')

    await admin.goto(`${BASE}/admin/newsletter/subscribers?q=${encodeURIComponent(subscriberEmail)}`, { waitUntil: 'networkidle' })
    const subscriberRow = admin.locator('tbody tr').filter({ hasText: subscriberEmail })
    await subscriberRow.waitFor({ timeout: 15000 }).catch(() => {})
    const rowText = (await subscriberRow.innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(rowText.includes('Subscribed') && rowText.includes('Store footer'), `admin Newsletter subscribers lists it: "${rowText}"`)
    await axe(admin, 'newsletter subscribers')

    // A campaign: draft, test to the admin, send
    await admin.goto(`${BASE}/admin/newsletter/campaigns`, { waitUntil: 'networkidle' })
    await axe(admin, 'newsletter campaigns')
    await admin.getByRole('link', { name: 'New campaign' }).click()
    await admin.getByLabel('Subject').fill(campaignSubject)
    await admin.getByLabel('Preview text (optional)').fill('New lamps are in')
    await admin.getByLabel('Email body (HTML)').fill(`<h2>Spring arrivals</h2><p>Lamps for every room, ${marker}.</p><script>alert(1)</script>`)
    const livePreview = admin.locator('.email-preview article')
    log((await visible(livePreview.getByText(`Lamps for every room, ${marker}.`))) && (await livePreview.locator('script').count()) === 0, 'the live preview shows the body without the script')
    await admin.getByRole('button', { name: 'Save draft' }).click()
    await admin.waitForURL(/\/admin\/newsletter\/campaigns\/\d+$/, { timeout: 15000 }).catch(() => {})
    const campaignId = Number(admin.url().split('/').pop())
    log(await visible(status(admin, 'Draft saved. Some HTML was removed by the safety filter')), 'Save draft: saved, and the script removed by the safety filter')
    await axe(admin, 'campaign editor')
    const adminBefore = await latestMailId(ADMIN_USER.email)
    await admin.getByRole('button', { name: 'Send test to me' }).click()
    log(await visible(status(admin, 'Test email sent to')), 'Send test to me: "Test email sent to …"')
    const testMail = await latestMail(ADMIN_USER.email, { after: adminBefore })
    log(testMail?.subject === `[Test] ${campaignSubject}`, `the admin gets "${testMail?.subject}"`)

    const subscribed = []
    for (let page = 1; page <= 20; page++) {
      const { body } = await admin$(`/newsletter/subscribers?status=subscribed&per_page=100&page=${page}`)
      subscribed.push(...(body?.data ?? []).map((item) => item.email))
      if (!body?.meta || page >= body.meta.last_page) break
    }
    const others = subscribed.filter((email) => !/\be2e[0-9a-z]+@/.test(email) && !email.includes(marker))
    if (others.length > 0) {
      log(false, `campaign send SKIPPED: ${others.length} subscribed address(es) are not this suite's (${others.slice(0, 3).join(', ')}), so a real newsletter would go out`)
    } else {
      await admin.getByRole('button', { name: 'Send to subscribers' }).click()
      const sendDialog = admin.getByRole('dialog')
      log(await visible(sendDialog.getByText(`${subscribed.length} subscribed address`)), `Send asks first (${subscribed.length} subscribed, all this suite's test addresses)`)
      await axe(admin, 'send campaign dialog')
      const subscriberBefore = await latestMailId(subscriberEmail)
      await sendDialog.getByRole('button', { name: 'Send campaign' }).click()
      log(await visible(status(admin, `Sent to ${subscribed.length} subscribers.`)), `"Sent to ${subscribed.length} subscribers."`)
      const sent = (await admin$(`/newsletter/campaigns/${campaignId}`)).body?.data
      log(sent?.status === 'sent' && sent.sent_count === subscribed.length && sent.failed_count === 0, `campaign is Sent (${sent?.sent_count} sent, ${sent?.failed_count} failed)`)
      const newsletter = await latestMail(subscriberEmail, { after: subscriberBefore })
      const unsubscribeHeader = newsletter?.headers?.['List-Unsubscribe'] ?? ''
      log(newsletter?.subject === campaignSubject && newsletter.text.includes(`Lamps for every room, ${marker}.`), `the subscriber gets "${newsletter?.subject}"`)
      const unsubscribePath = unsubscribeHeader.match(/^<https?:\/\/[^/]+(\/newsletter\/unsubscribe\?token=[^>]+)>$/)?.[1]
      log(Boolean(unsubscribePath), `with a List-Unsubscribe header (${unsubscribeHeader.slice(0, 70)}…)`)
      log(Boolean(unsubscribePath) && newsletter.text.includes(unsubscribePath), 'and the same unsubscribe link in the email')
      await guest.goto(`${BASE}${unsubscribePath}`, { waitUntil: 'networkidle' })
      log(await visible(guest.getByRole('heading', { name: 'Unsubscribe from the newsletter' })), 'the unsubscribe page asks for one click first')
      await axe(guest, 'newsletter unsubscribe page')
      await guest.getByRole('button', { name: 'Unsubscribe' }).click()
      log(await visible(guest.getByText("You're unsubscribed. You won't get any more newsletters.")), '"You\'re unsubscribed."')
      log(((await admin$(`/newsletter/subscribers?search=${encodeURIComponent(subscriberEmail)}`)).body?.data ?? [])[0]?.status === 'unsubscribed', 'the address is unsubscribed')
    }
    await guest.context().close()

    // Account → Newsletter switch, for SHOPPER (then back as it was)
    const shop = await newPage()
    await storefrontSignIn(shop, SHOPPER)
    await shop.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    const toggle = shop.getByLabel('Email me new arrivals, deals, and style tips')
    await toggle.waitFor()
    log((await toggle.isChecked()) === shopperNewsletterBefore, `Account shows the newsletter switch (${shopperNewsletterBefore ? 'on' : 'off'})`)
    const flip = async (on) => {
      // The switch follows the server's answer, so it changes a moment after the click.
      await toggle.click()
      await status(shop, on ? "You're subscribed to the newsletter." : "You're unsubscribed from the newsletter.").waitFor({ timeout: 15000 }).catch(() => {})
      return ((await admin$(`/newsletter/subscribers?search=${encodeURIComponent(SHOPPER.email)}`)).body?.data ?? []).find((item) => item.email === SHOPPER.email)
    }
    const on = await flip(!shopperNewsletterBefore)
    log(on?.status === (shopperNewsletterBefore ? 'unsubscribed' : 'subscribed') && (shopperNewsletterBefore || on?.source === 'account'), `switched ${shopperNewsletterBefore ? 'off' : 'on'}: ${on?.status} (source ${on?.source}, no confirmation needed)`)
    await axe(shop, 'account with the newsletter switch')
    const back = await flip(shopperNewsletterBefore)
    log(back?.status === (shopperNewsletterBefore ? 'subscribed' : 'unsubscribed') && (await toggle.isChecked()) === shopperNewsletterBefore, `and back ${shopperNewsletterBefore ? 'on' : 'off'} (${back?.status})`)
    await shop.context().close()
  })

  // ---------- 4. Email templates ----------
  await part('email templates', async () => {
    await admin.goto(`${BASE}/admin/email-templates`, { waitUntil: 'networkidle' })
    log(await visible(admin.getByRole('heading', { name: 'Email templates' })), 'Content → Email templates opens')
    // Every template the API knows is listed (the count grows as phases add emails, so compare with the API).
    const known = (await admin$('/email-templates')).body?.data?.length ?? -1
    const listed = await admin.locator('tbody tr').count()
    log(known >= 17 && listed === known, `every email the store sends is listed (${listed} of ${known})`)
    await axe(admin, 'email templates')
    await admin.getByRole('link', { name: 'Email verification code' }).first().click()
    await admin.waitForURL(/\/admin\/email-templates\/email_verification$/)
    await admin.getByLabel('Subject', { exact: true }).fill(templateSubject)
    const previewSubject = admin.locator('.email-preview__subject strong')
    await admin.waitForFunction((text) => document.querySelector('.email-preview__subject strong')?.textContent === text, `E2E ${run}: confirm your email for BuyNest`, { timeout: 15000 }).catch(() => {})
    log((await previewSubject.innerText().catch(() => '')) === `E2E ${run}: confirm your email for BuyNest`, `live preview with sample data: "${await previewSubject.innerText().catch(() => '')}"`)
    log(await visible(admin.locator('iframe[sandbox=""]')), 'the preview is a sandboxed frame')
    await axe(admin, 'email template editor')
    await admin.getByRole('button', { name: 'Save template' }).click()
    log(await visible(status(admin, 'Template saved. New emails use it now.')), 'Save template: "New emails use it now."')
    const before = await latestMailId(ADMIN_USER.email)
    await admin.getByRole('button', { name: 'Send test to me' }).click()
    await status(admin, /sent/i).waitFor({ timeout: 15000 }).catch(() => {})
    const test = await latestMail(ADMIN_USER.email, { after: before })
    log(test?.subject === `[Test] E2E ${run}: confirm your email for BuyNest`, `test email to the admin: "${test?.subject}"`)
    // A real sign-up email: the customized subject, and the code is still found
    const registered = await api('/api/v1/auth/register', { method: 'POST', body: { ...signUp, password_confirmation: signUp.password, accept_terms: true } })
    made.signUpCustomer = signUp.email
    const code = await latestCode(signUp.email).catch(() => null)
    log(registered.status === 201 && code?.subject === `E2E ${run}: confirm your email for BuyNest` && /^\d{6}$/.test(code.code), `a real sign-up email uses it ("${code?.subject}") and its code is found (${code?.code})`)
    await admin.getByRole('button', { name: 'Reset to default' }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Reset to default' }).click()
    log(await visible(status(admin, 'Back to the default template.')), 'Reset to default: "Back to the default template."')
    const reset = (await admin$('/email-templates/email_verification')).body?.data
    log(reset?.is_customized === false && reset.subject === templateBefore?.default_subject, `the default subject is back ("${reset?.subject}")`)
  })

  // ---------- 5. SEO: meta tags, sitemap, robots.txt, redirects, search terms ----------
  await part('SEO and search', async () => {
    const guest = await newPage()
    await guest.goto(`${BASE}/products/${productId}`, { waitUntil: 'networkidle' })
    await guest.locator('.product-details__price-current').waitFor()
    let meta = await metaOf(guest)
    log(meta.title === `${productName} | BuyNest`, `product page <title>: "${meta.title}"`)
    log(Boolean(meta.description), `meta description: "${meta.description?.slice(0, 60)}"`)
    log(meta.canonical === `${BASE}/products/${productId}` && meta.ogUrl === meta.canonical, `canonical link and og:url: ${meta.canonical}`)
    log(meta.ogTitle === productName && meta.ogType === 'product' && Boolean(meta.ogImage), `Open Graph: og:title "${meta.ogTitle}", og:type ${meta.ogType}, og:image`)
    await guest.context().close()

    const metaTitle = `Reading lamp ${run} | Warm light`
    await admin.goto(`${BASE}/admin/products/${productId}`, { waitUntil: 'networkidle' })
    await admin.getByLabel('Meta title (optional)').fill(metaTitle)
    await admin.getByLabel('Meta description (optional)').fill(`A warm reading lamp, ${marker}.`)
    await admin.getByRole('button', { name: 'Save changes' }).click()
    await status(admin, /saved|live/i).waitFor({ timeout: 15000 }).catch(() => {})
    log((await productOf(productId))?.meta_title === metaTitle, 'admin: meta title and description saved on the product')
    const fresh = await newPage()
    await fresh.goto(`${BASE}/products/${productId}`, { waitUntil: 'networkidle' })
    await fresh.locator('.product-details__price-current').waitFor()
    meta = await metaOf(fresh)
    log(meta.title === `${metaTitle} | BuyNest` && meta.ogTitle === metaTitle && meta.description === `A warm reading lamp, ${marker}.`, `the store uses them: <title> "${meta.title}"`)

    // Sitemap (cached for 15 minutes: the cache is cleared so the new product shows now) and robots.txt
    tinker("Illuminate\\Support\\Facades\\Cache::forget(App\\Http\\Controllers\\Api\\V1\\SeoController::SITEMAP_CACHE_KEY);")
    const sitemap = await fresh.evaluate(async () => {
      const response = await fetch('/sitemap.xml')
      return { status: response.status, type: response.headers.get('content-type'), text: await response.text() }
    })
    log(sitemap.status === 200 && /xml/.test(sitemap.type ?? '') && sitemap.text.includes(`/products/${productId}</loc>`) && sitemap.text.includes(`/categories/${category.slug}</loc>`), `/sitemap.xml lists the test product and category (${sitemap.status} ${sitemap.type})`)
    const robots = await fresh.evaluate(async () => (await fetch('/robots.txt')).text())
    log(/Disallow: \/admin\//.test(robots) && /Sitemap: .*\/sitemap\.xml/.test(robots), '/robots.txt disallows /admin/ and points to the sitemap')

    // A URL redirect added in the admin
    await admin.goto(`${BASE}/admin/redirects`, { waitUntil: 'networkidle' })
    log(await visible(admin.getByRole('heading', { name: 'URL redirects' })), 'Content → URL redirects opens')
    await admin.getByRole('button', { name: 'Add redirect' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('From (old address)').fill(redirectFrom)
    await dialog.getByLabel('To').fill(`/products/${productId}`)
    await axe(admin, 'add redirect dialog')
    await dialog.getByRole('button', { name: 'Add redirect' }).click()
    log(await visible(status(admin, `Redirect added: ${redirectFrom} goes to /products/${productId}.`)), `redirect added: ${redirectFrom} → /products/${productId}`)
    made.redirects = ((await admin$(`/redirects?search=${encodeURIComponent(run)}`)).body?.data ?? []).map((item) => item.id)
    await axe(admin, 'URL redirects')
    await fresh.goto(`${BASE}${redirectFrom.toUpperCase()}/?utm_source=e2e`, { waitUntil: 'networkidle' })
    await fresh.waitForURL(`${BASE}/products/${productId}`, { timeout: 15000 }).catch(() => {})
    log(new URL(fresh.url()).pathname === `/products/${productId}`, `the store follows it (${redirectFrom.toUpperCase()}/?utm_source=e2e → ${new URL(fresh.url()).pathname})`)
    log((await admin$(`/redirects/${made.redirects[0]}`)).body?.data?.hits >= 1, 'and the redirect counts a hit')

    // Search: a term with a redirect, and a term the suite searched for in the report
    await admin.goto(`${BASE}/admin/search-terms`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Add redirect' }).click()
    const termDialog = admin.getByRole('dialog')
    await termDialog.getByLabel('Search term').fill(searchRedirectTerm.toUpperCase())
    await termDialog.getByLabel('Redirect to').fill(`/products/${productId}`)
    await axe(admin, 'search redirect dialog')
    await termDialog.getByRole('button', { name: 'Save redirect' }).click()
    log(await visible(status(admin, `Searching “${searchRedirectTerm}” now goes to /products/${productId}.`)), `search term "${searchRedirectTerm}" sends shoppers to the product`)
    await fresh.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const search = fresh.getByRole('combobox', { name: 'Search products' }).first()
    await search.fill(searchRedirectTerm)
    await fresh.waitForResponse((response) => response.url().includes(encodeURIComponent(searchRedirectTerm)), { timeout: 10000 }).catch(() => {})
    await search.press('Enter')
    await fresh.waitForURL(`${BASE}/products/${productId}`, { timeout: 15000 }).catch(() => {})
    log(new URL(fresh.url()).pathname === `/products/${productId}`, `an exact search for it lands on the product (${new URL(fresh.url()).pathname})`)
    await fresh.context().close()
    await admin.goto(`${BASE}/admin/search-terms?q=${encodeURIComponent(marker)}`, { waitUntil: 'networkidle' })
    const termRow = admin.locator('tbody tr').filter({ hasText: marker })
    await termRow.waitFor({ timeout: 15000 }).catch(() => {})
    const termText = (await termRow.innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(termText.includes(marker) && /\b1\b/.test(termText), `admin Search terms lists the suite's search "${marker}" ("${termText}")`)
    await axe(admin, 'search terms')
  })

  // ---------- 6. A saved cart across devices ----------
  await part('saved cart', async () => {
    await clearSavedCart(SHOPPER)
    const deviceA = await newPage()
    await storefrontSignIn(deviceA, SHOPPER)
    await emptyCart(deviceA)
    await addToCart(deviceA, productId)
    await deviceA.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    await deviceA.waitForTimeout(800)
    const saved = (await api('/api/v1/me/cart', { token: await customerToken(SHOPPER) })).body?.data
    log(saved?.items?.length === 1 && saved.items[0].product_id === productId && saved.items[0].quantity === 1, 'device A: the cart page saved 1 lamp on the server')
    const deviceB = await newPage()
    await storefrontSignIn(deviceB, SHOPPER)
    await deviceB.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await deviceB.waitForFunction(() => /Cart, 1 items/.test(document.querySelector('.site-header [aria-label^="Cart,"]')?.getAttribute('aria-label') ?? ''), null, { timeout: 15000 }).catch(() => {})
    log((await headerCounts(deviceB)).cart === 1, `device B: signing in restores the cart (${(await headerCounts(deviceB)).cart} item)`)
    await deviceB.reload({ waitUntil: 'networkidle' })
    await deviceB.waitForTimeout(1500)
    log((await headerCounts(deviceB)).cart === 1, `after a reload: still ${(await headerCounts(deviceB)).cart}, not doubled`)
    const secondTab = watchErrors(await deviceB.context().newPage(), errors)
    await secondTab.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    await secondTab.waitForTimeout(1500)
    const tabLines = await secondTab.locator('.cart-page__list .cart-line').filter({ hasText: productName }).count()
    log((await headerCounts(secondTab)).cart === 1 && tabLines === 1, `a second tab: ${(await headerCounts(secondTab)).cart} item, ${tabLines} cart line`)
    await deviceB.reload({ waitUntil: 'networkidle' })
    await deviceB.waitForTimeout(1000)
    log((await headerCounts(deviceB)).cart === 1, 'the first tab after the second one: still 1')

    // Device A empties the cart from the mini cart: a new device then starts empty
    await deviceA.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await deviceA.locator('.site-header [aria-label^="Cart,"]').click()
    const drawer = deviceA.getByRole('dialog', { name: /Your cart/ })
    await drawer.getByRole('button', { name: `Remove ${productName} from cart` }).click()
    await drawer.getByText('Your cart is empty').waitFor({ timeout: 15000 }).catch(() => {})
    await axe(deviceA, 'empty mini cart')
    await deviceA.waitForTimeout(1500)
    const afterEmpty = (await api('/api/v1/me/cart', { token: await customerToken(SHOPPER) })).body?.data
    log(afterEmpty?.items?.length === 0, 'emptying the mini cart on device A empties the saved cart')
    const deviceC = await newPage()
    await storefrontSignIn(deviceC, SHOPPER)
    await deviceC.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await deviceC.waitForTimeout(1500)
    log((await headerCounts(deviceC)).cart === 0, `device C signs in to an empty cart (${(await headerCounts(deviceC)).cart})`)
    for (const page of [deviceA, deviceB, deviceC]) await page.context().close()
    await clearSavedCart(SHOPPER)
  })

  // ---------- 8. Dashboard and notifications ----------
  await part('dashboard and notifications', async () => {
    await admin.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
    const overview = admin.locator('main')
    const tiles = await overview.locator('dl.stats').first().innerText().catch(() => '')
    log(/Lifetime sales/.test(tiles) && /Average order/.test(tiles), 'dashboard: lifetime sales and average order')
    for (const heading of ['To do', 'Revenue, last 30 days', 'Bestsellers', 'New customers', 'Top search terms', 'Latest orders']) {
      log(await visible(overview.getByRole('heading', { name: heading })), `dashboard block: ${heading}`)
    }
    const todo = (await overview.locator('.todo-list').innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(/to invoice/i.test(todo) && /to ship/i.test(todo) && /low.stock/i.test(todo), `to-do counts: "${todo.slice(0, 160)}"`)
    await axe(admin, 'dashboard')

    // Low stock on the test product → a notification
    await admin.goto(`${BASE}/admin/products/${productId}`, { waitUntil: 'networkidle' })
    await admin.getByLabel('Units in stock').fill('3')
    await admin.getByRole('button', { name: 'Save changes' }).click()
    await status(admin, /saved|live/i).waitFor({ timeout: 15000 }).catch(() => {})
    const notifications = (await admin$('/notifications?per_page=50')).body
    const lowStock = notifications?.data?.find((item) => item.type === 'low_stock' && item.link === `/products/${productId}`)
    log(lowStock?.severity === 'warning' && lowStock.read_at === null, `stock set to 3: "${lowStock?.title}" (${lowStock?.severity})`)
    const unread = notifications?.meta?.unread_count
    await admin.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' })
    const bell = admin.getByRole('button', { name: /^Notifications/ })
    log((await bell.getAttribute('aria-label')) === `Notifications, ${unread} unread`, `the bell says "${await bell.getAttribute('aria-label')}"`)
    await bell.click()
    const panel = admin.getByRole('dialog', { name: 'Notifications' })
    log(await visible(panel.getByText(`Low stock: ${productName}`)), 'the list shows the low-stock notification')
    await axe(admin, 'notifications list')
    await panel.getByRole('button', { name: `Mark "Low stock: ${productName}" as read` }).click()
    await admin.waitForFunction((n) => document.querySelector('.bell__button')?.getAttribute('aria-label') === (n > 0 ? `Notifications, ${n} unread` : 'Notifications'), unread - 1, { timeout: 15000 }).catch(() => {})
    log((await bell.getAttribute('aria-label')) === (unread - 1 > 0 ? `Notifications, ${unread - 1} unread` : 'Notifications'), `Mark read: the count goes down ("${await bell.getAttribute('aria-label')}")`)
    if (unread - 1 > 0) {
      await panel.getByRole('button', { name: 'Mark all as read' }).click()
      await panel.getByText('Nothing unread.').waitFor({ timeout: 15000 }).catch(() => {})
      log((await panel.getByText('Nothing unread.').isVisible()) && (await bell.getAttribute('aria-label')) === 'Notifications', 'Mark all as read: "Nothing unread."')
    }
    await admin.keyboard.press('Escape')
    log(!(await panel.isVisible()) && (await admin.evaluate(() => document.activeElement?.classList.contains('bell__button'))), 'Escape closes the list and returns focus to the bell')
    log((await admin$('/notifications?unread=1')).body?.meta?.unread_count === 0, 'the server has them read')
  })

  // ---------- 9. Grid preferences ----------
  await part('grid preferences', async () => {
    await admin.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
    const table = admin.locator('table').first()
    log(await visible(table.getByRole('columnheader', { name: 'Category' })), 'products grid shows the Category column')
    await admin.locator('summary', { hasText: 'Columns' }).click()
    // The checkbox follows the saved preference, so it changes once the server has it.
    await admin.getByRole('group', { name: 'Columns to show' }).getByRole('checkbox', { name: 'Category' }).click()
    log(await visible(status(admin, 'Category column hidden.')), '"Category column hidden."')
    await axe(admin, 'products grid with the column chooser')
    await admin.reload({ waitUntil: 'networkidle' })
    await table.locator('tbody tr').first().waitFor()
    log((await table.getByRole('columnheader', { name: 'Category' }).count()) === 0 && (await table.getByRole('columnheader', { name: 'Price' }).count()) === 1, 'after a reload the Category column is still hidden')
    await admin.goto(`${BASE}/admin/products?q=${encodeURIComponent(marker)}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Save filters' }).click()
    const saveDialog = admin.getByRole('dialog', { name: 'Save these filters' })
    await saveDialog.getByLabel('Name').fill(filterName)
    await axe(admin, 'save filters dialog')
    await saveDialog.getByRole('button', { name: 'Save filters' }).click()
    log(await visible(status(admin, `Filters saved as "${filterName}".`)), `filters saved as "${filterName}"`)
    await admin.goto(`${BASE}/admin/products`, { waitUntil: 'networkidle' })
    await admin.locator('label.toolbar__select').filter({ hasText: 'Saved filters' }).locator('select').selectOption(filterName)
    await admin.waitForURL(/q=/, { timeout: 15000 }).catch(() => {})
    log(new URL(admin.url()).searchParams.get('q') === marker && (await visible(admin.locator('tbody tr').filter({ hasText: productName }))), `applying it puts the search back (q=${new URL(admin.url()).searchParams.get('q')})`)
    const pref = (await admin$('/preferences/products_grid')).body?.data?.value
    log(!pref?.columns?.includes('category') && pref?.filters?.some((filter) => filter.name === filterName), 'stored on the server for this admin')
  })

  // ---------- 10. A Marketing admin ----------
  await part('marketing admin', async () => {
    const marketingRole = (await admin$('/roles')).body.data.find((role) => role.name === 'Marketing')
    const email = `marketing.${run}@buynest.test`
    const password = 'MarketingCheck2026pass'
    const created = await admin$('/admins', { method: 'POST', body: { name: 'Mia Marketing', email, password, role_id: marketingRole?.id } })
    made.admin = created.body?.data?.id ?? null
    log(created.status === 201, `a Marketing admin is created (${created.status})`)
    const mkt = await newPage({ width: 1440, height: 900 })
    await adminSignIn(mkt, { email, password })
    await mkt.waitForURL(/\/admin\/(?!login)/, { timeout: 15000 }).catch(() => {})
    await mkt.goto(`${BASE}/admin/catalog-rules/new`, { waitUntil: 'networkidle' })
    log(await visible(mkt.getByRole('group', { name: 'Customer groups' }).getByRole('checkbox', { name: groupName })), 'Marketing: the price rule form lists the customer groups')
    log(await visible(mkt.getByRole('group', { name: 'Categories' }).getByRole('checkbox', { name: categoryName })), 'and the categories')
    const products = mkt.getByRole('group', { name: 'Products', exact: true })
    await products.getByLabel('Search products to add').fill(marker)
    await products.getByRole('button', { name: 'Search' }).click()
    await products.getByRole('button', { name: `Add ${productName}` }).click()
    log(await visible(products.locator('.picker-list').first().getByText(productName)), 'and the product search adds a product')
    log((await mkt.getByText("Your role can't list").count()) === 0, 'no "can\'t list" message on the rule form')
    await mkt.goto(`${BASE}/admin/coupons/new`, { waitUntil: 'networkidle' })
    await mkt.getByLabel('Applies to').selectOption('categories')
    log(await visible(mkt.getByRole('group', { name: 'Eligible categories' }).getByRole('checkbox', { name: categoryName })), 'Marketing: the coupon form lists the categories')
    await mkt.getByLabel('Applies to').selectOption('products')
    const eligible = mkt.getByRole('group', { name: 'Eligible products' })
    await eligible.getByLabel('Search products to add').fill(marker)
    await eligible.getByRole('button', { name: 'Search' }).click()
    log(await visible(eligible.getByRole('button', { name: `Add ${productName}` })), 'and finds products')
    log(await visible(mkt.getByRole('group', { name: 'Customer groups' }).getByRole('checkbox', { name: groupName })), 'and lists the customer groups')
    for (const path of ['/admin/customers', '/admin/email-templates']) {
      await mkt.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
      log(await visible(mkt.getByRole('heading', { name: "You don't have access" })), `Marketing opening ${path}: "You don't have access"`)
    }
    const refused = await mkt.evaluate(async () => {
      const response = await fetch('/api/admin/email-templates/email_verification', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: 'Hacked {{ code }}', body: '<p>{{ code }}</p>' }) })
      return { status: response.status, body: await response.json().catch(() => ({})) }
    })
    log(refused.status === 403 && refused.body.code === 'permission_denied', `the API refuses an email template change (${refused.status} ${refused.body.permission ?? ''})`)
    log((await admin$('/email-templates/email_verification')).body?.data?.is_customized === templateBefore?.is_customized, 'and nothing changed')
    await mkt.context().close()
  })

  // ---------- 11. Phone-sized layout ----------
  await part('phone layout', async () => {
    await admin.setViewportSize({ width: 390, height: 844 })
    for (const path of ['/admin/', '/admin/catalog-rules', '/admin/catalog-rules/new', '/admin/coupons/new', '/admin/newsletter/subscribers', '/admin/newsletter/campaigns/new', '/admin/email-templates/email_verification', '/admin/redirects', '/admin/search-terms', '/admin/abandoned-carts', '/admin/products']) {
      await admin.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
      await admin.waitForTimeout(300)
      const overflow = await sidewaysOverflow(admin)
      log(overflow <= 0, `390px ${path}: no sideways page scroll (${overflow}px)`)
    }
    const phone = await newPage({ width: 390, height: 844 })
    for (const path of ['/newsletter/confirm?token=e2e-not-a-token', '/newsletter/unsubscribe?token=e2e-not-a-token', '/']) {
      await phone.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
      await phone.waitForTimeout(300)
      const overflow = await sidewaysOverflow(phone)
      log(overflow <= 0, `390px store ${path}: no sideways page scroll (${overflow}px)${overflow > 0 ? ` — sticks out: ${await overflowCulprits(phone)}` : ''}`)
    }
    log(await visible(phone.locator('section.newsletter').getByRole('button', { name: 'Subscribe' })), '390px: the newsletter form is shown in the footer')
    await phone.goto(`${BASE}/newsletter/confirm?token=e2e-not-a-token`, { waitUntil: 'networkidle' })
    log(await visible(phone.getByRole('alert').filter({ hasText: 'This confirmation link is invalid or has expired.' })), 'a bad confirmation link says so')
    await phone.context().close()
  })
  await adminCtx.close()
} catch (error) {
  log(false, `the suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  // Put everything back: rules, coupons, subscribers, campaigns (drafts), template, redirects, search terms,
  // grid preferences, notifications, the test group, product, category, sign-up, Marketing admin, carts, stock
  const cleanupProblems = []
  const attempt = async (what, body) => {
    try {
      await body()
    } catch (error) {
      cleanupProblems.push(`${what}: ${error.message.split('\n')[0]}`)
    }
  }
  await attempt('rules', async () => {
    for (const rule of (await admin$(`/catalog-rules?search=${encodeURIComponent(run)}&per_page=100`)).body?.data ?? []) await admin$(`/catalog-rules/${rule.id}`, { method: 'DELETE' })
  })
  await attempt('coupons', async () => {
    for (const id of made.coupons) await admin$(`/coupons/${id}`, { method: 'DELETE' })
  })
  await attempt('campaigns', async () => {
    for (const campaign of (await admin$(`/newsletter/campaigns?search=${encodeURIComponent(run)}&per_page=100`)).body?.data ?? []) {
      if (campaign.status === 'draft') await admin$(`/newsletter/campaigns/${campaign.id}`, { method: 'DELETE' })
    }
  })
  await attempt('subscribers and the newsletter switch', async () => {
    tinker(`App\\Models\\NewsletterSubscriber::where('email', 'like', '%${marker}%')->delete();`)
    if (!shopperSubscriberBefore) tinker(`App\\Models\\NewsletterSubscriber::where('email', '${SHOPPER.email}')->delete();`)
    else {
      const token = await customerToken(SHOPPER)
      if ((await api('/api/v1/me', { token })).body?.data?.newsletter !== shopperNewsletterBefore) await api('/api/v1/me', { method: 'PATCH', token, body: { newsletter: shopperNewsletterBefore } })
    }
  })
  await attempt('email template', async () => {
    if (templateBefore?.is_customized) await admin$('/email-templates/email_verification', { method: 'PUT', body: { subject: templateBefore.subject, body: templateBefore.body } })
    else await admin$('/email-templates/email_verification/reset', { method: 'POST' })
  })
  await attempt('redirects', async () => {
    for (const redirect of (await admin$(`/redirects?search=${encodeURIComponent(run)}&per_page=100`)).body?.data ?? []) await admin$(`/redirects/${redirect.id}`, { method: 'DELETE' })
  })
  await attempt('search terms', async () => {
    for (const term of (await admin$(`/search-terms?search=${encodeURIComponent(run)}&per_page=100`)).body?.data ?? []) await admin$(`/search-terms/${term.id}`, { method: 'DELETE' })
  })
  await attempt('grid preferences', async () => {
    if (gridBefore === null) tinker(`App\\Models\\AdminPreference::where('admin_id', App\\Models\\Admin::where('email', '${ADMIN_USER.email}')->value('id'))->where('key', 'products_grid')->delete();`)
    else await admin$('/preferences/products_grid', { method: 'PUT', body: { value: gridBefore } })
  })
  await attempt('notifications', async () => {
    const ids = unreadBefore.length > 0 ? unreadBefore.join(',') : '0'
    tinker(
      `$admin = App\\Models\\Admin::where('email', '${ADMIN_USER.email}')->first();` +
        ` DB::table('admin_notification_reads')->where('admin_id', $admin->id)->whereIn('notification_id', [${ids}])->delete();` +
        (made.product ? ` $mine = App\\Models\\AdminNotification::where('link', '/products/${made.product}')->pluck('id'); DB::table('admin_notification_reads')->whereIn('notification_id', $mine)->delete(); App\\Models\\AdminNotification::whereIn('id', $mine)->delete();` : ''),
    )
  })
  await attempt('SHOPPER_2 group and saved carts', async () => {
    if ((await admin$(`/customers/${shopper2.id}`)).body?.data?.group?.id !== shopper2GroupBefore) await admin$(`/customers/${shopper2.id}`, { method: 'PATCH', body: { group_id: shopper2GroupBefore } })
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('test group', async () => {
    if (made.group) await admin$(`/customer-groups/${made.group}`, { method: 'DELETE' })
  })
  await attempt('test product and category', async () => {
    if (made.product) {
      // Deleted products keep their category for past orders: move it out so the test category can go.
      await admin$(`/products/${made.product}`, { method: 'PATCH', body: { category: 'home-decoration', status: 'draft' } })
      await admin$(`/products/${made.product}`, { method: 'DELETE' })
    }
    if (made.category) await admin$(`/categories/${made.category}`, { method: 'DELETE' })
  })
  await attempt('sign-up customer', async () => {
    const customer = await findCustomer(signUp.email)
    if (customer) await admin$(`/customers/${customer.id}`, { method: 'DELETE' })
  })
  await attempt('Marketing admin', async () => {
    if (made.admin) await admin$(`/admins/${made.admin}`, { method: 'PATCH', body: { is_active: false } })
  })
  await attempt('stock', () => restoreStock())

  const leftRules = (await admin$(`/catalog-rules?search=${encodeURIComponent(run)}`)).body?.data ?? []
  const leftCoupons = await Promise.all(made.coupons.map(async (id) => (await admin$(`/coupons/${id}`)).body?.data))
  const leftSubscribers = (await admin$(`/newsletter/subscribers?search=${encodeURIComponent(marker)}`)).body?.data ?? []
  const shopperSubscriber = ((await admin$(`/newsletter/subscribers?search=${encodeURIComponent(SHOPPER.email)}`)).body?.data ?? []).find((item) => item.email === SHOPPER.email) ?? null
  const template = (await admin$('/email-templates/email_verification')).body?.data
  const leftRedirects = (await admin$(`/redirects?search=${encodeURIComponent(run)}`)).body?.data ?? []
  const leftTerms = (await admin$(`/search-terms?search=${encodeURIComponent(run)}`)).body?.data ?? []
  const grid = (await admin$('/preferences/products_grid')).body?.data?.value ?? null
  // Every page, like unreadBefore (unread notifications from earlier runs can pass 50).
  const unreadAfter = []
  for (let page = 1; page <= 10; page++) {
    const { body } = await admin$(`/notifications?unread=1&per_page=50&page=${page}`)
    unreadAfter.push(...(body?.data ?? []).map((item) => item.id))
    if (!body?.meta || page >= body.meta.last_page) break
  }
  const leftGroup = ((await admin$('/customer-groups')).body?.data ?? []).some((item) => item.name === groupName)
  const leftProducts = (await admin$(`/products?search=${marker}`)).body?.data ?? []
  const leftCategory = made.category && (await admin$('/categories')).body?.data?.some((item) => item.id === made.category)
  const leftSignUp = await findCustomer(signUp.email)
  const marketingLeft = made.admin && (await admin$('/admins')).body?.data?.find((item) => item.id === made.admin)?.is_active
  const shopper2After = (await admin$(`/customers/${shopper2.id}`)).body?.data?.group?.id ?? null
  const carts = (await admin$('/reports/abandoned-carts?min_age_hours=1')).body?.data?.filter((cart) => [shopper1?.id, shopper2.id].includes(cart.customer.id)) ?? []
  const checks = {
    rules: leftRules.length === 0,
    coupons: leftCoupons.every((coupon) => !coupon || coupon.is_active === false),
    subscribers: leftSubscribers.length === 0,
    shopperNewsletter: (shopperSubscriber?.status ?? null) === (shopperSubscriberBefore?.status ?? null),
    template: template?.is_customized === templateBefore?.is_customized && template?.subject === templateBefore?.subject,
    redirects: leftRedirects.length === 0,
    searchTerms: leftTerms.length === 0,
    grid: JSON.stringify(grid) === JSON.stringify(gridBefore),
    notifications: JSON.stringify([...unreadAfter].sort()) === JSON.stringify([...unreadBefore].sort()),
    group: !leftGroup && shopper2After === shopper2GroupBefore,
    product: leftProducts.length === 0 && !leftCategory,
    signUp: !leftSignUp,
    admin: !marketingLeft,
    carts: carts.length === 0,
  }
  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  log(
    failedChecks.length === 0 && cleanupProblems.length === 0,
    `cleanup: rules, coupons (used ones disabled), subscribers, template, redirects, search terms, grid settings, notifications, group, product, category, sign-up, Marketing admin, carts put back${failedChecks.length || cleanupProblems.length ? ` — left: ${[...failedChecks, ...cleanupProblems].join('; ')}` : ''}`,
  )
}

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
