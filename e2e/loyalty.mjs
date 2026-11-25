// Phase 11 in a real browser: the wishlist saved to the account and its share link, product comparison,
// related products / up-sells / cross-sells set in the admin, "Duplicate product", reward points (earn on a
// paid order, spend at checkout, adjust in the admin, refund), display currencies (BDT shown, USD charged),
// and recently viewed products.
//
// Runs against the usual servers (the store on :5173, the API on :8000). Needs the BuyNest API
// (E2E_ACCOUNTS=laravel) and its test inbox (the throwaway customer's sign-up code).
//
// The demo accounts are never used for points or wishlists: a throwaway customer signs up through the API
// (code from the test inbox) and is deleted at the end with its wishlist and reward history. Its orders are
// moved on to Delivered first (an open order blocks deleting a customer); orders, invoices and credit memos
// stay, like in the other suites. The suite makes its own five test products (removed at the end, with the
// copy "Duplicate" makes and every link), turns reward points on and BDT on, and puts both back as they
// were (rewards settings as read at the start, BDT's rate and switch as read at the start), even on failure.
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
  headerCounts,
  latestCode,
  launch,
  preserveStock,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  storefrontSignOut,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('loyalty: saved wishlists and sharing, compare, linked products, duplicate, reward points, display currencies, recently viewed')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const run = Date.now().toString(36)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const api = async (path, { method = 'GET', token, body } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    })
    // A busy run can hit the API's per-minute limit: wait as asked, then retry.
    if (response.status === 429 && attempt < 4) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}
const cents = (value) => Math.round(Number(value) * 100)
const money = (value) => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// The throwaway customer (signed up through the API, deleted at the end).
const wren = { firstName: 'Wren', lastName: `Loyalson${run}`, email: `loyalty.${run}@example.com`, password: 'LoyaltyPass2026', phone: '+1 555 010 4477' }
const made = { products: [], orders: new Set(), customerId: null }
const errors = []
let owner = null
let browser = null
let restoreStock = async () => 0
let savedRewards = null // the rewards settings before the suite
let savedBdt = null // the BDT row before the suite
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const productOf = async (id) => (await admin$(`/products/${id}`)).body?.data
const wrenToken = async () => (await api('/api/v1/auth/login', { method: 'POST', body: { email: wren.email, password: wren.password } })).body?.data?.tokens?.access_token
const rewardsOf = async (id) => (await admin$(`/customers/${id}/rewards`)).body?.data

try {
  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  savedRewards = (await admin$('/settings')).body?.data?.rewards ?? null
  savedBdt = ((await admin$('/currencies')).body?.data ?? []).find((row) => row.code === 'BDT') ?? null
  if (!savedRewards || !savedBdt) throw new Error('the API has no rewards settings or BDT row (phase 11 not migrated?)')
  log(savedRewards.enabled === false, `reward points are off before the suite (enabled ${savedRewards.enabled})`)
  log(!savedBdt.enabled && Number(savedBdt.rate) === 0, `BDT is off with no rate before the suite (rate ${savedBdt.rate}, ${savedBdt.enabled ? 'on' : 'off'})`)
  restoreStock = await preserveStock()
  browser = await launch()
  await runChecks()
} catch (error) {
  log(false, `suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  await cleanup().catch((error) => log(false, `cleanup failed: ${error.message.split('\n')[0]}`))
  await browser?.close().catch(() => {})
  log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
  report.done()
}

// ---------------------------------------------------------------- Checks
async function runChecks() {
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
    }
  }
  async function newPage(viewport = { width: 1280, height: 900 }) {
    const context = await browser.newContext({ viewport, bypassCSP: true })
    context.setDefaultTimeout(15000)
    return watchErrors(await context.newPage(), errors)
  }
  async function adminPage() {
    const admin = await newPage({ width: 1440, height: 900 })
    await adminSignIn(admin, ADMIN_USER)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    return admin
  }
  async function closeMiniCart(page) {
    const miniCart = page.getByRole('dialog', { name: /Your cart/ })
    if (await visible(miniCart, 3000)) {
      await page.keyboard.press('Escape')
      await miniCart.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }
  async function addProduct(page, id, quantity = 1) {
    await page.goto(`${BASE}/products/${id}`, { waitUntil: 'networkidle' })
    const details = page.locator('.product-details')
    for (let more = 1; more < quantity; more++) await details.getByRole('button', { name: 'Increase quantity' }).click()
    await details.getByRole('button', { name: /add to cart/i }).first().click()
    await closeMiniCart(page)
  }
  async function fillCheckout(page, { email } = {}) {
    await page.locator('[name="email"]').waitFor()
    if (email) await page.locator('[name="email"]').fill(email)
    const phoneField = page.locator('[name="phone"]')
    if (!(await phoneField.inputValue())) await phoneField.fill('+1 555 010 2030')
    const fields = { firstName: 'Wren', lastName: 'Tester', line1: '9 Loyalty Row', city: 'Springfield', state: 'Oregon', postalCode: '29112' }
    for (const [name, value] of Object.entries(fields)) {
      const input = page.locator(`[name="shipping.${name}"]`)
      if ((await input.count()) > 0 && !(await input.inputValue())) await input.fill(value)
    }
  }
  const placeButton = (page) => page.getByRole('button', { name: /^Place order · / })
  /** Waits until the checkout is priced by the server ("Checking prices…" gone). */
  const settled = (page) => page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking prices/.test(b.textContent)), null, { timeout: 20000 }).catch(() => {})
  async function placeOrder(page) {
    const button = placeButton(page)
    await button.waitFor({ timeout: 20000 })
    await settled(page)
    await button.click()
    await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 })
    const number = new URL(page.url()).pathname.split('/').pop()
    made.orders.add(number)
    return number
  }
  async function invoiceInAdmin(admin, number) {
    await admin.goto(`${BASE}/admin/orders/${number}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Invoice', exact: true }).click()
    await admin.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click()
    await admin.getByRole('dialog').waitFor({ state: 'hidden' })
    for (let attempt = 0; attempt < 20; attempt++) {
      const order = await orderOf(number)
      if (order?.payment_status === 'paid' || order?.invoices?.length) return order
      await sleep(250)
    }
    return orderOf(number)
  }
  const wishlistItems = (page) => page.locator('.wishlist-page__grid .wishlist-item')
  /** Reads the header wishlist count, waiting up to 5 s for `expected`. */
  async function wishlistCount(page, expected) {
    let counts = await headerCounts(page)
    for (let waited = 0; waited < 5000 && counts.wishlist !== expected; waited += 250) {
      await page.waitForTimeout(250)
      counts = await headerCounts(page)
    }
    return counts.wishlist
  }

  // ---------- Test products (through the API, like the other suites) ----------
  const names = { main: `E2E Loyal Lamp ${run}`, up: `E2E Loyal Lamp Deluxe ${run}`, rel: `E2E Loyal Shade ${run}`, cross: `E2E Loyal Bulb ${run}`, extra: `E2E Loyal Hook ${run}` }
  const specs = {
    main: [{ label: 'Material', value: 'Oak' }, { label: 'Height', value: '40 cm' }],
    up: [{ label: 'Material', value: 'Walnut' }, { label: 'Height', value: '40 cm' }, { label: 'Dimmer', value: 'Yes' }],
    rel: [{ label: 'Material', value: 'Linen' }],
    cross: [],
    extra: [],
  }
  const prices = { main: 20, up: 30, rel: 12, cross: 8, extra: 5 }
  const P = {}
  for (const key of Object.keys(names)) {
    const created = await admin$('/products', {
      method: 'POST',
      body: { name: names[key], category: 'home-decoration', price: prices[key], stock_quantity: 60, status: 'active', sku: `E2E-LOY-${key}-${run}`.toUpperCase(), brand: 'NestWorks', weight: 500, specifications: specs[key] },
    })
    P[key] = created.body?.data?.id
    if (P[key]) made.products.push(P[key])
  }
  const main = await productOf(P.main)
  log(Object.values(P).every(Boolean) && main?.specifications?.length === 2 && main.specifications[0].label === 'Material', `five test products, the main one with 2 specification rows (#${Object.values(P).join(', #')})`)
  if (!Object.values(P).every(Boolean)) throw new Error('the test products could not be made')

  // ---------- The throwaway customer: signs up through the API, code from the test inbox ----------
  const registered = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { first_name: wren.firstName, last_name: wren.lastName, email: wren.email, phone: wren.phone, password: wren.password, password_confirmation: wren.password, accept_terms: true },
  })
  const verified = registered.status === 201 ? await api('/api/v1/auth/verify-email', { method: 'POST', body: { email: wren.email, code: (await latestCode(wren.email)).code } }) : registered
  made.customerId = ((await admin$(`/customers?search=${encodeURIComponent(wren.email)}`)).body?.data ?? []).find((row) => row.email === wren.email)?.id ?? null
  log(verified.status === 200 && Boolean(made.customerId), `a throwaway customer signed up and confirmed (${wren.email}, #${made.customerId})`)
  if (!made.customerId) throw new Error('the throwaway customer could not sign up')

  // ---------- 1. The wishlist on the server, sharing ----------
  await part('wishlist', async () => {
    // A guest saves the main product, then signs in: the guest list moves into the account.
    const first = await newPage()
    await first.goto(`${BASE}/products/${P.main}`, { waitUntil: 'networkidle' })
    await first.locator('.product-details .wishlist-button--button').click()
    log((await wishlistCount(first, 1)) === 1, 'a guest saves a product to the wishlist (header 1)')
    await storefrontSignIn(first, wren)
    let serverList = []
    for (let attempt = 0; attempt < 20; attempt++) {
      serverList = (await api('/api/v1/me/wishlist', { token: await wrenToken() })).body?.data ?? []
      if (serverList.length) break
      await sleep(250)
    }
    log(serverList.length === 1 && serverList[0].product?.id === P.main, `signing in merges the guest list into the account (server has ${serverList.map((item) => item.product?.name).join(', ') || 'nothing'})`)
    // A second product while signed in, and a note on the first.
    await first.goto(`${BASE}/products/${P.up}`, { waitUntil: 'networkidle' })
    await first.locator('.product-details .wishlist-button--button').click()
    log((await wishlistCount(first, 2)) === 2, 'signed in: a second product saved (header 2)')
    await first.goto(`${BASE}/wishlist`, { waitUntil: 'networkidle' })
    log(await visible(first.getByText('Saved to your account, so it follows you to any device where you sign in.')), 'the wishlist page says it is saved to the account')
    const mainItem = wishlistItems(first).filter({ hasText: names.main })
    await mainItem.getByLabel('Note', { exact: true }).fill('For the hallway')
    await mainItem.getByRole('button', { name: `Save note for ${names.main}` }).click()
    log(await visible(mainItem.getByText('Note saved.')), 'a note on the item: "Note saved."')
    await axe(first, 'wishlist page (signed in, with notes and sharing)')
    await phone(first, 'the wishlist page')
    let noted = null
    for (let attempt = 0; attempt < 20 && !noted; attempt++) {
      noted = ((await api('/api/v1/me/wishlist', { token: await wrenToken() })).body?.data ?? []).find((item) => item.product?.id === P.main && item.note === 'For the hallway')
      if (!noted) await sleep(250)
    }
    log(Boolean(noted), 'the note is saved on the server')

    // Sign out (nothing left), sign in again (everything back).
    await storefrontSignOut(first)
    log((await wishlistCount(first, 0)) === 0, 'signed out: the header wishlist is empty')
    await storefrontSignIn(first, wren)
    await first.goto(`${BASE}/wishlist`, { waitUntil: 'networkidle' })
    await wishlistItems(first).first().waitFor()
    log((await wishlistItems(first).count()) === 2 && (await wishlistItems(first).filter({ hasText: names.main }).getByLabel('Note', { exact: true }).inputValue()) === 'For the hallway', 'signed in again: both items and the note are back')

    // Another browser: the same list from the server.
    const second = await newPage()
    await storefrontSignIn(second, wren)
    await second.goto(`${BASE}/wishlist`, { waitUntil: 'networkidle' })
    await wishlistItems(second).first().waitFor()
    const titles = await second.locator('.wishlist-page__grid .wishlist-item__title').allInnerTexts()
    log(titles.length === 2 && titles.some((title) => title.includes(names.main)) && titles.some((title) => title.includes(names.up)), `a second browser shows the same list (${titles.join(' | ')})`)
    await second.context().close()

    // Share it: a signed-out browser opens the link.
    const share = first.locator('section.share-wishlist')
    await share.getByRole('button', { name: 'Create share link' }).click()
    await share.getByLabel('Share link').waitFor()
    const link = await share.getByLabel('Share link').inputValue()
    const token = link.split('/').pop()
    log(/\/wishlist\/shared\/[A-Za-z0-9_-]{32}$/.test(link), `"Create share link" shows a link (${link.replace(token, `${token.slice(0, 4)}…`)})`)
    log(await visible(share.getByRole('status').filter({ hasText: 'Your share link is ready.' })), '"Your share link is ready."')
    await axe(first, 'wishlist page with a share link')

    const guest = await newPage()
    await guest.goto(link, { waitUntil: 'networkidle' })
    log(await visible(guest.getByRole('heading', { name: "Wren's wishlist", level: 1 })), 'signed out, the link shows "Wren\'s wishlist"')
    log(await visible(guest.getByText('“For the hallway”')), 'the note is shown')
    const text = await guest.locator('body').innerText()
    log(!text.includes(wren.email) && !text.includes(wren.lastName), 'no email or last name on the shared page')
    const answer = await guest.evaluate(async (path) => (await fetch(path)).text(), `/api/shop/wishlists/${token}`)
    log(!answer.includes(wren.email) && !answer.includes(wren.lastName) && !answer.includes(`"id":${made.customerId},`) && answer.includes('"ownerFirstName":"Wren"'), 'the shared answer has the first name only (no email, last name)')
    await axe(guest, 'shared wishlist page')
    await phone(guest, 'the shared wishlist page')
    await guest.getByRole('button', { name: 'Add all to cart' }).click()
    await closeMiniCart(guest)
    let cart = (await headerCounts(guest)).cart
    for (let waited = 0; waited < 5000 && cart !== 2; waited += 250) {
      await guest.waitForTimeout(250)
      cart = (await headerCounts(guest)).cart
    }
    log(cart === 2, `"Add all to cart" puts both products in the visitor's cart (cart ${cart})`)

    // Stop sharing: the link stops working.
    await share.getByRole('button', { name: 'Stop sharing' }).click()
    log(await visible(share.getByRole('status').filter({ hasText: 'Sharing is off. The link no longer works.' })), '"Stop sharing": "Sharing is off. The link no longer works."')
    const gone = await api(`/api/v1/wishlists/${token}`)
    log(gone.status === 404, `the old link answers 404 (${gone.status} "${gone.body?.message}")`)
    await guest.reload({ waitUntil: 'networkidle' })
    log(await visible(guest.getByRole('heading', { name: "This wishlist link doesn't work", level: 1 })), 'the shared page now says "This wishlist link doesn\'t work"')
    const meta = (await api('/api/v1/me/wishlist', { token: await wrenToken() })).body?.meta
    log(meta?.shared === false, `the account's wishlist is no longer shared (shared ${meta?.shared})`)
    await guest.context().close()

    // The admin sees the wishlist on the customer page.
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/customers/${made.customerId}`, { waitUntil: 'networkidle' })
    await admin.getByRole('tab', { name: 'Wishlist' }).click()
    const adminList = admin.getByRole('region', { name: `${wren.firstName} ${wren.lastName}'s wishlist` })
    await adminList.waitFor()
    const adminText = await adminList.innerText()
    log(adminText.includes(names.main) && adminText.includes(names.up) && adminText.includes('For the hallway'), "admin customer page → Wishlist: both products and the note")
    await axe(admin, 'admin customer wishlist tab')
    await admin.context().close()
    await first.context().close()
  })

  // ---------- 2. Compare up to 4 ----------
  await part('compare', async () => {
    const page = await newPage()
    const toggle = async (key) => {
      await page.goto(`${BASE}/products/${P[key]}`, { waitUntil: 'networkidle' })
      const button = page.locator('.product-details').getByRole('button', { name: `Compare ${names[key]}` })
      await button.click()
      return button
    }
    for (const key of ['main', 'up', 'rel', 'cross']) await toggle(key)
    const bar = page.getByRole('complementary', { name: 'Compare products' })
    log(await visible(bar.getByRole('link', { name: 'Compare (4)' })), 'four products picked: the bar says "Compare (4)"')
    const fifth = await toggle('extra')
    log(await visible(page.getByText('You can compare up to 4 products. Remove one to add another.').first()), 'a 5th product: "You can compare up to 4 products. Remove one to add another."')
    log((await fifth.getAttribute('aria-pressed')) === 'false' && (await visible(bar.getByRole('link', { name: 'Compare (4)' }))), 'the 5th is not added (still 4, not pressed)')
    await bar.getByRole('link', { name: 'Compare (4)' }).click()
    await page.waitForURL(/\/compare$/)
    const table = page.getByRole('table')
    await table.waitFor()
    await page.locator('.compare-table__product').nth(3).waitFor()
    const columns = await table.locator('thead th[scope="col"]').allInnerTexts()
    log(columns.filter((name) => Object.values(names).some((title) => name.includes(title))).length === 4, `the table has a column per product (${columns.length} column headers)`)
    const rowHeaders = (await table.locator('th[scope="row"]').allInnerTexts()).map((text) => text.trim())
    log(['Image', 'Price', 'Rating', 'Stock', 'Brand', 'Category', 'Weight', 'Options'].every((label) => rowHeaders.some((header) => header.startsWith(label))), `row headers are <th scope="row"> (${rowHeaders.join(', ')})`)
    log((await table.locator('caption').count()) === 1, 'the table has a caption')
    const specRows = rowHeaders.filter((header) => ['Material', 'Height', 'Dimmer'].includes(header))
    log(JSON.stringify(specRows) === JSON.stringify(['Material', 'Height', 'Dimmer']), `specification rows in first-seen order (${specRows.join(', ')})`)
    const materialRow = await table.locator('tr').filter({ has: page.locator('th[scope="row"]', { hasText: /^Material/ }) }).locator('td').allInnerTexts()
    log(materialRow.map((cell) => cell.trim()).join('|') === 'Oak|Walnut|Linen|—', `Material row: ${materialRow.map((cell) => cell.trim()).join(' | ')} ("—" when missing)`)
    const region = page.locator('.compare-table__scroll')
    log((await region.getAttribute('role')) === 'region' && (await region.getAttribute('tabindex')) === '0', 'the table scrolls inside a focusable region')
    await page.getByLabel('Highlight differences').check()
    const marked = (await table.locator('th[scope="row"]').allInnerTexts()).map((text) => text.trim())
    log(marked.some((text) => /^Price.*\(differs\)/.test(text)) && marked.some((text) => /^Material.*\(differs\)/.test(text)), 'Highlight differences: Price and Material marked "(differs)"')
    log(marked.some((text) => text === 'Brand') && marked.some((text) => text === 'Category'), 'rows that are the same (Brand, Category) are not marked')
    await axe(page, 'compare page')
    await phone(page, 'the compare page')
    await page.getByRole('button', { name: `Remove ${names.cross} from comparison` }).click()
    await page.waitForFunction(() => document.querySelectorAll('.compare-table__product').length === 3, null, { timeout: 5000 }).catch(() => {})
    log((await page.locator('.compare-table__product').count()) === 3, 'Remove takes a column away (3 left)')
    const compared = await api(`/api/v1/products/compare?ids=${P.main},${P.up}`)
    log(compared.status === 200 && compared.body?.data?.length === 2 && compared.body.data[1].specifications?.length === 3, 'the compare API answers both products with their specifications')
    await page.context().close()
  })

  // ---------- 3. Linked products set in the admin, Duplicate ----------
  await part('linked products', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/products/${P.main}`, { waitUntil: 'networkidle' })
    const section = admin.locator('fieldset.product-extra').filter({ hasText: 'Related products, up-sells and cross-sells' })
    await section.waitFor()
    // Every type through the picker: search by name, Add.
    const pick = async (lower, key) => {
      const list = section.locator('fieldset.link-list').filter({ has: admin.locator('legend', { hasText: new RegExp(`^${lower}$`, 'i') }) })
      await list.getByLabel(`Search products to add to ${lower.toLowerCase()}`).fill(names[key])
      await list.getByRole('button', { name: `Search ${lower.toLowerCase()}` }).click()
      await list.getByRole('button', { name: `Add ${names[key]} to ${lower.toLowerCase()}` }).click()
      return list
    }
    const upsells = await pick('Up-sells', 'up')
    log(await visible(upsells.locator('ol').getByText(names.up)), 'admin product form: the picker adds an up-sell')
    // The product itself can't be picked.
    await upsells.getByLabel('Search products to add to up-sells').fill(names.main)
    await upsells.getByRole('button', { name: 'Search up-sells' }).click()
    log(await visible(upsells.getByRole('button', { name: `${names.main} is this product` })), 'the product itself is offered as "This product" (disabled)')
    await pick('Related products', 'rel')
    await pick('Cross-sells', 'cross')
    await axe(admin, 'admin product form with linked products')
    await admin.getByRole('button', { name: 'Save changes' }).click()
    log(await visible(admin.getByText(/Changes saved\./)), 'Save changes: "Changes saved."')
    const links = (await productOf(P.main))?.links
    const ids = (type) => (links?.[type] ?? []).map((entry) => entry.id)
    log(JSON.stringify(ids('upsell')) === JSON.stringify([P.up]) && JSON.stringify(ids('related')) === JSON.stringify([P.rel]) && JSON.stringify(ids('crosssell')) === JSON.stringify([P.cross]), `saved with the product: ${JSON.stringify({ related: ids('related'), upsell: ids('upsell'), crosssell: ids('crosssell') })}`)

    // The store: "You may also like" and "Related products" on the product page.
    const shop = await newPage()
    await shop.goto(`${BASE}/products/${P.main}`, { waitUntil: 'networkidle' })
    const upSection = shop.locator('section').filter({ has: shop.getByRole('heading', { name: 'You may also like', level: 2 }) })
    const relSection = shop.locator('section').filter({ has: shop.getByRole('heading', { name: 'Related products', level: 2 }) })
    log(await visible(upSection.getByText(names.up)), `product page: "You may also like" shows the up-sell (${names.up})`)
    log(await visible(relSection.getByText(names.rel)), `product page: "Related products" shows the related product (${names.rel})`)
    log(!(await relSection.getByText(names.up).isVisible().catch(() => false)), 'the related section shows the admin\'s choice only (not the automatic one)')
    const order = await shop.evaluate(() => [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()))
    log(order.indexOf('You may also like') < order.indexOf('Customer reviews') && order.indexOf('Customer reviews') < order.indexOf('Related products'), `"You may also like" above the reviews, "Related products" below (${order.filter((t) => ['You may also like', 'Customer reviews', 'Related products'].includes(t)).join(' → ')})`)
    const specTable = shop.locator('section').filter({ has: shop.getByRole('heading', { name: 'Specifications', level: 2 }) }).locator('table')
    log((await specTable.locator('th[scope="row"]').allInnerTexts()).join('|') === 'Material|Height' && (await specTable.locator('td').allInnerTexts()).join('|') === 'Oak|40 cm', 'product page: the "Specifications" table (Material Oak, Height 40 cm)')
    await axe(shop, 'product page with specifications and linked products')

    // The cart: "Customers also bought".
    await addProduct(shop, P.main)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    const crossSection = shop.locator('section.cart-page__cross-sells')
    log(await visible(crossSection.getByRole('heading', { name: 'Customers also bought' })), 'cart: "Customers also bought"')
    log(await visible(crossSection.getByText(names.cross)) && !(await crossSection.getByText(names.up).isVisible().catch(() => false)), `it shows the cross-sell (${names.cross}) only`)
    await axe(shop, 'cart with cross-sells')
    await crossSection.locator('.product-card').filter({ hasText: names.cross }).getByRole('button', { name: /add .*to cart/i }).first().click()
    await closeMiniCart(shop)
    log(await crossSection.waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false), 'added to the cart, the cross-sell leaves the section (it is already in the cart)')
    await shop.context().close()

    // Duplicate: a draft copy with its links.
    await admin.goto(`${BASE}/admin/products/${P.main}`, { waitUntil: 'networkidle' })
    await admin.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await admin.waitForURL((url) => /\/admin\/products\/\d+$/.test(url.pathname) && !url.pathname.endsWith(`/${P.main}`), { timeout: 15000 })
    const copyId = Number(admin.url().split('/').pop())
    if (Number.isInteger(copyId)) made.products.push(copyId)
    log(await visible(admin.getByRole('status').filter({ hasText: `Copy of “${names.main}” created as a draft.` })), `"Duplicate" opens the copy with "Copy of “${names.main}” created as a draft…"`)
    const copy = await productOf(copyId)
    log(copy?.name === `${names.main} (copy)` && copy?.status === 'draft' && copy?.sku === `E2E-LOY-MAIN-${run}-COPY`.toUpperCase(), `the copy: "${copy?.name}", ${copy?.status}, SKU ${copy?.sku}`)
    log(copy?.specifications?.length === 2 && copy?.links?.upsell?.[0]?.id === P.up && copy?.links?.crosssell?.[0]?.id === P.cross && copy?.links?.related?.[0]?.id === P.rel, 'the copy keeps the specifications and the links')
    log((await api(`/api/v1/products/${copyId}`)).status === 404, 'the draft copy is not in the store')
    await axe(admin, 'admin product copy with the notice')
    await admin.context().close()
  })

  // ---------- 4. Recently viewed ----------
  await part('recently viewed', async () => {
    const page = await newPage()
    await page.goto(`${BASE}/products/${P.rel}`, { waitUntil: 'networkidle' })
    await page.goto(`${BASE}/products/${P.extra}`, { waitUntil: 'networkidle' })
    const row = page.locator('section.recently-viewed').filter({ has: page.getByRole('heading', { name: 'Recently viewed' }) })
    // Under a full run the pages load slower (the phase 17 home page asks for several product lists): allow 30 s.
    await row.waitFor({ timeout: 30000 })
    const onProduct = await row.locator('.product-card__title').allInnerTexts()
    log(onProduct.some((title) => title.includes(names.rel)) && !onProduct.some((title) => title.includes(names.extra)), `product page: "Recently viewed" lists the earlier product, not this one (${onProduct.join(' | ')})`)
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const home = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recently viewed', level: 2 }) }).last()
    await home.waitFor({ timeout: 30000 })
    const onHome = await home.locator('.product-card__title').allInnerTexts()
    log(onHome.length >= 2 && onHome[0].includes(names.extra) && onHome[1].includes(names.rel), `home page: newest first (${onHome.slice(0, 2).join(' | ')})`)
    await axe(page, 'home page with recently viewed')
    await page.getByRole('button', { name: 'Clear recently viewed products' }).click()
    log(await page.getByRole('heading', { name: 'Recently viewed' }).waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false), 'Clear empties the row (it disappears)')
    const stored = await page.evaluate(() => localStorage.getItem('buynest.recentlyViewed.v1'))
    log(!stored || JSON.parse(stored).length === 0 || JSON.parse(stored).items?.length === 0, 'nothing is left in the browser storage')
    await page.context().close()
  })

  // ---------- 5. Reward points ----------
  await part('reward points', async () => {
    // Settings → Reward points: on.
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const form = admin.getByRole('form', { name: 'Reward points' })
    await form.waitFor()
    await form.getByLabel('Reward points are on').check()
    log(await visible(form.getByText(/Example: \$100\.00 of eligible spend earns 100 points, worth \$1\.00/)), 'Settings → Reward points: the worked example ($100.00 earns 100 points, worth $1.00)')
    await axe(admin, 'admin settings with reward points and currencies')
    await form.getByRole('button', { name: 'Save reward points' }).click()
    log(await visible(form.getByText('Reward points saved.')), '"Reward points saved."')
    const store = (await api('/api/v1/store')).body?.data?.rewards
    log(store?.enabled === true, `the store's settings say reward points are on (${JSON.stringify(store)})`)

    // Wren buys 4 × $30 (no shipping over $50), cash on delivery; the admin invoices it → 120 points.
    const shop = await newPage()
    await storefrontSignIn(shop, wren)
    await shop.goto(`${BASE}/products/${P.main}`, { waitUntil: 'networkidle' })
    log(await visible(shop.getByText('Earn about 20 reward points with this purchase.')), 'product page (signed in): "Earn about 20 reward points with this purchase."')
    await addProduct(shop, P.up, 4)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(shop)
    await shop.getByRole('radio', { name: /Cash on delivery/ }).check()
    await settled(shop)
    log(await visible(shop.getByText(/You have 0 pts/), 3000).then((shown) => !shown), 'no points yet: nothing to spend at checkout')
    const firstOrder = await placeOrder(shop)
    let placed = await orderOf(firstOrder)
    log(placed?.reward_points === null || placed?.reward_points?.earned === null, `order ${firstOrder} placed ($${placed?.totals?.total}): nothing earned before it is paid`)
    placed = await invoiceInAdmin(admin, firstOrder)
    const earnedFirst = placed?.reward_points?.earned
    const expectedFirst = Math.floor(Number(placed?.totals?.subtotal ?? 120) - Number(placed?.totals?.discount ?? 0))
    log(earnedFirst === 120 && expectedFirst === 120, `invoiced in the admin: ${earnedFirst} points earned (4 × $30.00, no shipping)`)
    await admin.reload({ waitUntil: 'networkidle' })
    const earnedRow = admin.locator('tr').filter({ hasText: 'Reward points earned' })
    log(await visible(earnedRow.getByText('120 points')), 'admin order page: "Reward points earned 120 points"')
    const invoiceMail = await fetch(`${LARAVEL_URL}/dev/mailbox/latest?to=${encodeURIComponent(wren.email)}`).then((r) => r.json(), () => null)
    log(/You earned 120 reward points with this order\./.test(invoiceMail?.data?.text ?? ''), `the invoice email says "You earned 120 reward points with this order." ("${invoiceMail?.data?.subject}")`)
    await shop.goto(`${BASE}/account/orders/${firstOrder}`, { waitUntil: 'networkidle' })
    log(await visible(shop.getByText('You earned 120 pts with this order.')), 'the customer\'s order page: "You earned 120 pts with this order."')
    await shop.goto(`${BASE}/account/rewards`, { waitUntil: 'networkidle' })
    log(await visible(shop.getByRole('link', { name: 'Reward points' }).first()), 'account menu: "Reward points"')
    log(await visible(shop.locator('.rewards__points').filter({ hasText: /^120 pts$/ })) && (await visible(shop.getByText('Worth $1.20 at checkout'))), 'account → Reward points: 120 pts, "Worth $1.20 at checkout"')
    const history = shop.getByRole('region', { name: /Reward points history/ })
    log(await visible(history.locator('tr').filter({ hasText: firstOrder }).filter({ hasText: '+120' })), 'the history lists +120 for the order')
    await axe(shop, 'account reward points page')
    await phone(shop, 'the reward points page')

    // The admin adds 380 points with a note on the customer page → 500.
    await admin.goto(`${BASE}/admin/customers/${made.customerId}`, { waitUntil: 'networkidle' })
    await admin.getByRole('tab', { name: 'Reward points' }).click()
    const tab = admin.getByRole('region', { name: 'Reward points', exact: true })
    await tab.waitFor()
    log(await visible(tab.getByText('120 points')), 'admin customer page → Reward points: balance 120 points')
    await tab.getByRole('button', { name: 'Adjust balance' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('Points').fill('380')
    log(await visible(dialog.getByText('New balance: 500 points')), 'Adjust balance: "New balance: 500 points" as you type')
    await dialog.getByRole('button', { name: 'Save adjustment' }).click()
    log(await visible(dialog.getByText('Say why the balance changes (kept in the history).'), 3000), 'without a reason: "Say why the balance changes (kept in the history)."')
    await dialog.getByLabel('Reason').fill(`e2e goodwill ${run}`)
    await axe(admin, 'admin adjust points dialog')
    await dialog.getByRole('button', { name: 'Save adjustment' }).click()
    await dialog.waitFor({ state: 'hidden' })
    log(await visible(admin.getByText(`Added 380 points. ${wren.firstName} ${wren.lastName} now has 500 points.`)), `"Added 380 points. ${wren.firstName} … now has 500 points."`)
    const afterAdjust = await rewardsOf(made.customerId)
    log(afterAdjust?.balance === 500 && afterAdjust?.transactions?.[0]?.type === 'adjust' && afterAdjust.transactions[0].note === `e2e goodwill ${run}` && afterAdjust.transactions[0].admin_name === ADMIN_USER.name, `the history keeps the adjustment with its note and admin (${afterAdjust?.transactions?.[0]?.type}, "${afterAdjust?.transactions?.[0]?.note}", ${afterAdjust?.transactions?.[0]?.admin_name})`)
    await axe(admin, 'admin customer reward points tab')

    // Spend 500 points at checkout: 2 × $20 + shipping.
    await addProduct(shop, P.main, 2)
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(shop)
    await shop.getByRole('radio', { name: /Cash on delivery/ }).check()
    await settled(shop)
    const redeem = shop.locator('.reward-points-redeem')
    await redeem.getByLabel('Use reward points').waitFor({ timeout: 20000 })
    log(await visible(redeem.getByText(/You have 500 pts \(worth \$5\.00\)\. Up to 500 pts can be used on this order, at least 100 pts at a time\./)), 'checkout: "You have 500 pts (worth $5.00). Up to 500 pts can be used…"')
    await redeem.getByLabel('Use reward points').fill('50')
    await redeem.getByRole('button', { name: 'Apply' }).click()
    log(await visible(redeem.getByText('Use at least 100 pts at a time.')), 'fewer than the minimum: "Use at least 100 pts at a time."')
    await redeem.getByRole('button', { name: 'Use all' }).click()
    const summaryLine = shop.locator('dt').filter({ hasText: 'Reward points (500 pts)' })
    log(await visible(summaryLine, 20000), 'Use all → the summary line "Reward points (500 pts)"')
    log((await summaryLine.locator('xpath=following-sibling::dd[1]').innerText().catch(() => '')).trim() === '−$5.00', 'the line takes off −$5.00')
    await settled(shop)
    await axe(shop, 'checkout with reward points')
    await phone(shop, 'checkout with reward points')
    const secondOrder = await placeOrder(shop)
    let spent = await orderOf(secondOrder)
    log(spent?.reward_points?.spent === 500 && spent?.reward_points?.amount === '5.00' && spent?.totals?.reward_points === '5.00' && cents(spent?.totals?.amount_due) === cents(spent?.totals?.total) - 500, `order ${secondOrder}: 500 points paid $5.00 of $${spent?.totals?.total} ($${spent?.totals?.amount_due} still due)`)
    log((await rewardsOf(made.customerId))?.balance === 0, 'the points are taken at once (balance 0)')
    await shop.goto(`${BASE}/account/orders/${secondOrder}`, { waitUntil: 'networkidle' })
    log(await visible(shop.getByText('500 pts paid $5.00.')), 'the customer\'s order page: "500 pts paid $5.00."')

    // The admin invoices it (earns on what points didn't pay), then refunds one lamp.
    spent = await invoiceInAdmin(admin, secondOrder)
    const earnedSecond = spent?.reward_points?.earned
    log(earnedSecond === 35, `invoiced: ${earnedSecond} points earned (2 × $20.00 − $5.00 paid with points)`)
    await admin.reload({ waitUntil: 'networkidle' })
    log(await visible(admin.locator('tr').filter({ hasText: 'Paid with reward points (500 points)' })), 'admin order page: "Paid with reward points (500 points)"')
    const balanceBefore = (await rewardsOf(made.customerId))?.balance
    await admin.getByRole('button', { name: 'Refund', exact: true }).click()
    const refund = admin.getByRole('dialog')
    log(await visible(refund.getByText(/Reward points that paid for it go back first, in proportion/)), 'the refund dialog: points go back first')
    await refund.getByLabel(/Quantity of .* to refund/).first().fill('1')
    const split = refund.locator('.refund-split')
    await split.waitFor()
    const splitText = (await split.innerText()).replace(/\s+/g, ' ')
    log(/Back as reward points \(about 500 points\) \$5\.00/.test(splitText) && /By the other payment method \$15\.00/.test(splitText), `the split: "${splitText}"`)
    await axe(admin, 'admin refund dialog with points')
    await refund.getByRole('button', { name: /^Refund \$/ }).click()
    await refund.waitFor({ state: 'hidden' })
    const after = await orderOf(secondOrder)
    const memo = after?.credit_memos?.[0]
    const expectedReversed = Math.round((earnedSecond * Number(memo?.total)) / Number(after?.totals?.total))
    log(memo?.reward_points_refund === '5.00' && memo?.reward_points_returned === 500 && memo?.other_refund === money(Number(memo?.total) - 5).slice(1), `credit memo ${memo?.number}: $${memo?.reward_points_refund} back as ${memo?.reward_points_returned} points, $${memo?.other_refund} by the other method`)
    log(memo?.reward_points_reversed === expectedReversed, `earned points taken back in proportion: ${memo?.reward_points_reversed} (35 × $${memo?.total} ÷ $${after?.totals?.total} = ${expectedReversed})`)
    const final = await rewardsOf(made.customerId)
    log(final?.balance === balanceBefore + 500 - expectedReversed, `balance ${balanceBefore} + 500 − ${expectedReversed} = ${final?.balance}`)
    const types = (final?.transactions ?? []).map((tx) => tx.type)
    log(['refund_return', 'refund_reverse', 'earn', 'spend', 'adjust'].every((type) => types.includes(type)), `the history has every step (${types.join(', ')})`)
    await shop.goto(`${BASE}/account/rewards`, { waitUntil: 'networkidle' })
    log(await visible(shop.locator('.rewards__points').filter({ hasText: new RegExp(`^${final?.balance} pts$`) })), `the account page shows the new balance (${final?.balance} pts)`)
    await shop.context().close()
    await admin.context().close()
  })

  // ---------- 6. Display currencies: BDT shown, USD charged ----------
  await part('display currencies', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const currencies = admin.locator('section.currencies')
    await currencies.getByRole('region', { name: 'Display currencies' }).waitFor()
    await currencies.getByRole('button', { name: 'Edit BDT' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('Rate (units per 1 USD)').fill('110')
    await dialog.getByLabel('Shoppers can choose it').check()
    log(await visible(dialog.getByText(/A \$10\.00 product shows as about ৳ 1100\.00\./)), 'Edit BDT: "A $10.00 product shows as about ৳ 1100.00."')
    await axe(admin, 'admin currency dialog')
    await dialog.getByRole('button', { name: 'Save currency' }).click()
    await dialog.waitFor({ state: 'hidden' })
    const bdtRow = currencies.locator('tr').filter({ hasText: 'BDT' })
    log(await visible(bdtRow.getByText('Offered')), 'Settings → Currencies: BDT is "Offered"')
    const offered = (await api('/api/v1/store')).body?.data?.currencies
    log(offered?.display?.length === 1 && offered.display[0].code === 'BDT' && Number(offered.display[0].rate) === 110, `the store offers BDT at 110 (${JSON.stringify(offered?.display)})`)
    await admin.context().close()

    const shop = await newPage()
    await shop.goto(`${BASE}/products/${P.main}`, { waitUntil: 'networkidle' })
    const picker = shop.getByLabel('Show prices in')
    await picker.waitFor()
    log((await picker.locator('option').allInnerTexts()).join('|') === 'USD|BDT (৳)', `header picker: ${(await picker.locator('option').allInnerTexts()).join(', ')}`)
    await picker.selectOption('BDT')
    log(await visible(shop.locator('.product-details').getByText('৳2,200.00').first()), 'BDT chosen: the $20.00 lamp shows ৳2,200.00')
    await axe(shop, 'product page in BDT')
    await addProduct(shop, P.main, 3)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    const cartNote = shop.locator('.currency-note').first()
    await cartNote.waitFor()
    const cartText = (await cartNote.innerText()).replace(/\s+/g, ' ')
    log(/^Prices in BDT are approximate\. You'll be charged \$[\d,.]+ USD\.$/.test(cartText), `cart: "${cartText}"`)
    log(await visible(shop.locator('.cart-page').getByText(/৳6,600\.00/).first()), 'the cart shows ৳6,600.00 for 3 × $20.00')
    await shop.reload({ waitUntil: 'networkidle' })
    log((await shop.getByLabel('Show prices in').inputValue()) === 'BDT', 'the choice is kept after a reload')
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await fillCheckout(shop, { email: `loyalty.guest.${run}@example.com` })
    await shop.getByRole('radio', { name: /Cash on delivery/ }).check()
    await settled(shop)
    const checkoutNote = shop.locator('.currency-note').first()
    await checkoutNote.waitFor()
    const noteText = (await checkoutNote.innerText()).replace(/\s+/g, ' ')
    const charged = noteText.match(/You'll be charged \$([\d,.]+) USD\./)?.[1]
    const button = (await placeButton(shop).innerText()).trim()
    log(Boolean(charged) && button === `Place order · $${charged}`, `checkout: "${noteText}" and "${button}" in USD`)
    await axe(shop, 'checkout in BDT')
    const number = await placeOrder(shop)
    const placed = await orderOf(number)
    log(placed?.totals?.total === charged?.replace(/,/g, '') && (placed?.currency ?? 'USD') === 'USD', `order ${number} is charged $${placed?.totals?.total} USD`)
    const totalRow = shop.locator('main dt').filter({ hasText: /^Total$/ }).first()
    await totalRow.waitFor()
    const shownTotal = (await totalRow.locator('xpath=following-sibling::dd[1]').innerText()).trim()
    const confirmation = await shop.locator('main').innerText()
    log(shownTotal === `$${charged}` && !confirmation.includes('৳'), `the confirmation shows the charged USD amounts only (Total ${shownTotal}, no ৳ on the page)`)
    await shop.goto(`${BASE}/products/${P.main}`, { waitUntil: 'networkidle' })
    await shop.getByLabel('Show prices in').selectOption('USD')
    log(await visible(shop.locator('.product-details').getByText('$20.00').first()), 'back to USD: $20.00')
    await shop.context().close()
    // The guest's order isn't needed: cancel it (stock comes back).
    await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
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
  await attempt('reward settings', async () => {
    if (savedRewards) {
      const answer = await admin$('/settings', { method: 'PATCH', body: { rewards: savedRewards } })
      if (answer.status !== 200) throw new Error(`PATCH settings answered ${answer.status}`)
    }
  })
  await attempt('BDT', async () => {
    if (!savedBdt) return
    const now = ((await admin$('/currencies')).body?.data ?? []).find((row) => row.code === 'BDT')
    if (now && (now.enabled !== savedBdt.enabled || Number(now.rate) !== Number(savedBdt.rate))) {
      const answer = await admin$(`/currencies/${savedBdt.id}`, { method: 'PATCH', body: { enabled: savedBdt.enabled, rate: savedBdt.rate } })
      if (answer.status !== 200) throw new Error(`PATCH currency answered ${answer.status} ${JSON.stringify(answer.body?.errors ?? answer.body?.message)}`)
    }
  })
  await attempt('the throwaway customer', async () => {
    if (!made.customerId) return
    // Open orders block deleting a customer: unpaid ones are cancelled, paid ones moved on to Delivered.
    for (const number of made.orders) {
      const order = await orderOf(number)
      if (!order) continue
      if (order.status === 'pending_payment' || (order.status === 'processing' && order.payment_status === 'unpaid')) await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'cancelled', notify_customer: false } })
      else if (order.status === 'processing') {
        await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'shipped', notify_customer: false } })
        await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'delivered', notify_customer: false } })
      } else if (order.status === 'shipped') await admin$(`/orders/${number}`, { method: 'PATCH', body: { status: 'delivered', notify_customer: false } })
    }
    const deleted = await admin$(`/customers/${made.customerId}`, { method: 'DELETE' })
    if (deleted.status !== 204) throw new Error(`DELETE customer answered ${deleted.status} ${JSON.stringify(deleted.body?.errors ?? deleted.body?.message)}`)
  })
  await attempt('products', async () => {
    // Deleted products keep their category for past orders; parked as Drafts first, like catalog.mjs.
    for (const id of made.products) {
      await admin$(`/products/${id}`, { method: 'PATCH', body: { status: 'draft' } })
      await admin$(`/products/${id}`, { method: 'DELETE' })
    }
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  const rewards = (await admin$('/settings')).body?.data?.rewards
  const bdt = ((await admin$('/currencies')).body?.data ?? []).find((row) => row.code === 'BDT')
  const leftProducts = ((await admin$(`/products?search=${encodeURIComponent(run)}`)).body?.data ?? []).length
  const leftCustomer = ((await admin$(`/customers?search=${encodeURIComponent(wren.email)}`)).body?.data ?? []).length
  const settingsBack = JSON.stringify(rewards) === JSON.stringify(savedRewards)
  const bdtBack = bdt && savedBdt && bdt.enabled === savedBdt.enabled && Number(bdt.rate) === Number(savedBdt.rate)
  log(
    problems.length === 0 && settingsBack && bdtBack && leftProducts === 0 && leftCustomer === 0,
    `cleanup: reward settings and BDT as before, test products and the copy removed, the throwaway customer deleted (wishlist and points with it), stock put back (orders stay)${problems.length || !settingsBack || !bdtBack || leftProducts || leftCustomer ? ` — left: ${[...problems, `rewards ${JSON.stringify(rewards)}`, `BDT ${bdt?.rate}/${bdt?.enabled}`, `${leftProducts} products`, `${leftCustomer} customer`].join('; ')}` : ''}`,
  )
}
