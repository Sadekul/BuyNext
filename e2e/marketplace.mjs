// Phase 17 in a real browser: the marketplace-style storefront (docs/backend/PHASE17_CONTRACT.md).
// The admin's "Top promo strip" (a real coupon only; an unknown code refused on its field), the store's top bar with
// "Copy code" and the home coupon banner; "All categories" mega menu (keyboard, Escape returns focus); search in a
// category; the "Top products" tabs (arrow keys; "Best selling" only from real sales); the compact lists and their
// "View all" sorts; "Deliver to" in a Bangladesh store (Division → District → Area, the estimate, remembered, checkout
// pre-filled); the phone bottom tab bar; the footer's payment badges; axe, 390px and tablet widths.
//
// Runs against the usual servers (the store on :5173, the API on :8000). The home content and Settings → Checkout are
// read at the start and put back at the end (even on failure); the test coupon is deleted.
import { ADMIN_USER, BASE, LARAVEL_URL, adminSignIn, axeViolations, launch, reporter, sidewaysOverflow, visible, watchErrors } from './lib.mjs'

const report = reporter('marketplace: top bar, promo coupon, mega menu, search in category, tabs, lists, deliver to, tab bar, footer')
const { log } = report
const errors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const run = Date.now().toString(36).toUpperCase()
const CODE = `MKT${run}`.slice(0, 20)
const MESSAGE = `Weekend deals with code ${CODE}`
const MESSAGE_BN = 'সপ্তাহান্তের বিশেষ অফার'

const api = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
      body: body && JSON.stringify(body),
    })
    if (response.status === 429 && attempt < 4) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
}

let owner = null
let browser = null
let savedHome = null
let savedCheckout = null
let couponId = null
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const homeBody = (home) => ({ hero_mode: home.hero_mode, hero: home.hero, banners: home.banners, slides: home.slides, slider: home.slider, top_bar: home.top_bar, featured_product_ids: home.featured_product_ids })

try {
  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  savedHome = (await admin$('/home')).body?.data
  if (!savedHome || !('top_bar' in savedHome)) throw new Error('the API has no top_bar (phase 17 not built?)')
  savedCheckout = (await admin$('/settings')).body?.data?.checkout ?? null
  const coupon = await admin$('/coupons', { method: 'POST', body: { code: CODE, description: 'Marketplace browser check', type: 'percent', value: '5', is_active: true } })
  couponId = coupon.body?.data?.id
  if (coupon.status !== 201 || !couponId) throw new Error(`the test coupon could not be made (${coupon.status} ${JSON.stringify(coupon.body?.errors ?? coupon.body?.message)})`)
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

async function cleanup() {
  if (!owner) return
  const problems = []
  if (savedHome) {
    const put = await admin$('/home', { method: 'PUT', body: homeBody(savedHome) })
    if (put.status !== 200) problems.push(`home ${put.status}`)
  }
  if (savedCheckout) {
    const patch = await admin$('/settings', { method: 'PATCH', body: { checkout: { default_country: savedCheckout.default_country ?? null } } })
    if (patch.status !== 200) problems.push(`checkout ${patch.status} ${JSON.stringify(patch.body?.errors ?? '')}`)
  }
  if (couponId) {
    await admin$(`/coupons/${couponId}`, { method: 'DELETE' })
    const left = (await admin$(`/coupons/${couponId}`)).body?.data
    if (left && left.is_active) problems.push('coupon still active')
  }
  const home = (await admin$('/home')).body?.data
  const checkout = (await admin$('/settings')).body?.data?.checkout
  if (JSON.stringify(home?.top_bar) !== JSON.stringify(savedHome?.top_bar)) problems.push(`top_bar ${JSON.stringify(home?.top_bar)}`)
  if ((checkout?.default_country ?? null) !== (savedCheckout?.default_country ?? null)) problems.push(`default_country ${checkout?.default_country}`)
  log(problems.length === 0, `cleanup: home content and Settings → Checkout put back, test coupon removed${problems.length ? ` — left: ${problems.join('; ')}` : ''}`)
}

async function runChecks() {
  const axe = async (page, name) => {
    const violations = await axeViolations(page)
    log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
  }
  async function part(name, body) {
    try {
      await body()
    } catch (error) {
      log(false, `${name} stopped early: ${error.message.split('\n')[0]}`)
    }
  }
  async function newPage({ viewport = { width: 1280, height: 900 }, cookie } = {}) {
    const context = await browser.newContext({ viewport, bypassCSP: true, permissions: ['clipboard-read', 'clipboard-write'] })
    context.setDefaultTimeout(15000)
    if (cookie) await context.addCookies([{ name: 'buynest_lang', value: cookie, url: BASE }])
    return watchErrors(await context.newPage(), errors)
  }
  const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText()).catch(() => '')

  // ---------- 1. API ----------
  await part('API', async () => {
    const best = await api('/api/v1/products?sort=best_selling&per_page=4')
    const units = (best.body?.data ?? []).map((item) => item.units_sold)
    log(best.status === 200 && typeof best.body?.meta?.has_sales === 'boolean' && units.every((n) => Number.isInteger(n)) && units.every((n, i) => i === 0 || n <= units[i - 1]),
      `best_selling: units_sold ${JSON.stringify(units)}, has_sales ${best.body?.meta?.has_sales}`)
    const plain = await api('/api/v1/products?per_page=2')
    log(!('units_sold' in (plain.body?.data?.[0] ?? {})) && !('has_sales' in (plain.body?.meta ?? {})), 'other listings carry no units_sold / has_sales')
    if ((savedCheckout?.default_country ?? null) === null) {
      const abroad = await api('/api/v1/delivery/estimate?area_id=1')
      log(abroad.status === 422 && /Bangladesh/.test(JSON.stringify(abroad.body?.errors?.area_id ?? '')), `estimate in a non-Bangladesh store: 422 "${abroad.body?.errors?.area_id?.[0]}"`)
    }
  })

  // ---------- 2. Admin: the top promo strip ----------
  await part('admin promo strip', async () => {
    const admin = await newPage({ viewport: { width: 1440, height: 900 } })
    await adminSignIn(admin, ADMIN_USER)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    await admin.goto(`${BASE}/admin/home-page`, { waitUntil: 'networkidle' })
    const strip = admin.getByRole('region', { name: 'Top promo strip' })
    await strip.waitFor()
    await strip.getByRole('checkbox', { name: 'Show the top promo strip' }).check()
    await strip.getByLabel('Message', { exact: true }).fill(MESSAGE)
    await strip.getByLabel('Message in Bangla', { exact: true }).fill(MESSAGE_BN)
    await strip.getByLabel('Coupon code (optional)').fill('NOSUCHCODE1')
    await admin.getByRole('button', { name: 'Save home page' }).click()
    log(await visible(admin.getByText("This coupon doesn't exist or isn't active.").first(), 10000), 'admin: an unknown coupon is refused on its field')
    await strip.getByLabel('Coupon code (optional)').fill(CODE.toLowerCase())
    await axe(admin, 'admin home page with the promo strip')
    await admin.getByRole('button', { name: 'Save home page' }).click()
    log(await visible(admin.getByText(/Home page saved\./)), 'admin: saved with a real coupon')
    const stored = (await admin$('/home')).body?.data?.top_bar
    log(stored?.enabled === true && stored.coupon_code === CODE && stored.message_bn === MESSAGE_BN, `API: top_bar ${JSON.stringify(stored)}`)
    await admin.context().close()
  })

  // ---------- 3. Store: top bar, coupon, mega menu, search in category ----------
  await part('top bar and coupon', async () => {
    const shop = await newPage()
    await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const header = shop.locator('.site-header')
    log(await visible(header.getByText(MESSAGE)), 'top bar: the admin\'s promo message')
    const copy = header.getByRole('button', { name: `Copy code ${CODE}` })
    log(await visible(copy), `top bar: "Copy code ${CODE}"`)
    await copy.click()
    log(await visible(shop.getByRole('status').filter({ hasText: /copied/i }).first(), 5000), 'copying says so (status)')
    log((await clipboard(shop)) === CODE, `the clipboard holds ${CODE}`)
    const banner = shop.getByRole('button', { name: `Copy coupon code ${CODE}` })
    log(await visible(banner), 'home: the coupon banner with its Copy button (a real coupon)')
    const home = (await api('/api/v1/home', { headers: { 'Accept-Language': 'bn' } })).body?.data?.top_bar
    log(home?.message === MESSAGE_BN && home?.coupon_code === CODE, `/home in Bangla: "${home?.message}", ${home?.coupon_code}`)
    await axe(shop, 'home with the top bar and coupon')
    // Closing the promo is remembered.
    await header.getByRole('button', { name: 'Close announcement' }).click()
    await shop.reload({ waitUntil: 'networkidle' })
    log(!(await header.getByText(MESSAGE).isVisible()), 'closing the promo is remembered after a reload')
    await shop.context().close()

    // An inactive coupon: the message stays, the code goes.
    await admin$(`/coupons/${couponId}`, { method: 'PATCH', body: { is_active: false } })
    const off = (await api('/api/v1/home')).body?.data?.top_bar
    log(off?.message === MESSAGE && off?.coupon_code === null, 'a switched-off coupon is not shown (message kept)')
    const resave = await admin$('/home', { method: 'PUT', body: homeBody((await admin$('/home')).body.data) })
    log(resave.status === 200, `saving the home page with the unchanged, now inactive code still works (${resave.status})`)
    await admin$(`/coupons/${couponId}`, { method: 'PATCH', body: { is_active: true } })
  })

  await part('mega menu and search in category', async () => {
    const shop = await newPage()
    await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const button = shop.getByRole('button', { name: 'All categories' })
    await button.click()
    log((await button.getAttribute('aria-expanded')) === 'true', 'mega menu: "All categories" opens (aria-expanded)')
    const panel = shop.getByRole('navigation', { name: 'All categories' })
    log((await panel.getByRole('link').count()) >= 20, `mega menu: ${await panel.getByRole('link').count()} links`)
    await axe(shop, 'open mega menu')
    await shop.keyboard.press('Escape')
    log((await button.getAttribute('aria-expanded')) === 'false' && (await shop.evaluate(() => document.activeElement?.textContent?.includes('All categories'))), 'Escape closes it and returns focus to the button')
    await button.focus()
    await shop.keyboard.press('ArrowDown')
    // Focus moves once the panel has drawn (a frame later).
    const focused = await shop.waitForFunction(() => document.activeElement?.tagName === 'A', null, { timeout: 3000 }).then(() => 'A', async () => shop.evaluate(() => document.activeElement?.tagName))
    log(focused === 'A', 'ArrowDown on the button opens it and moves to the first link')
    await shop.keyboard.press('Escape')
    await button.click()
    await panel.getByRole('link', { name: 'Smartphones', exact: true }).first().click()
    await shop.waitForURL(/\/categories\/smartphones/)
    log(true, 'a mega menu link opens its category')

    await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await shop.getByLabel('Search in').selectOption({ label: 'Smartphones' })
    await shop.getByRole('combobox', { name: 'Search products' }).first().fill('pro')
    await shop.keyboard.press('Enter')
    await shop.waitForURL(/[?&]category=smartphones/)
    const url = new URL(shop.url())
    log(url.searchParams.get('q') === 'pro', `search in a category: ${url.pathname}${url.search}`)
    log(await visible(shop.getByRole('heading', { name: /Results for "pro" in Smartphones/ })), 'the heading names the category')
    await shop.locator('.product-card').first().waitFor({ timeout: 15000 }).catch(() => {})
    const cards = await shop.locator('.product-card').count()
    const outside = await shop.locator('.product-card').evaluateAll((items) => items.filter((item) => !/phone|galaxy|oppo|realme|vivo|pixel/i.test(item.textContent)).length)
    log(cards > 0 && outside === 0, `${cards} results, all smartphones`)
    await shop.context().close()
  })

  // ---------- 4. Tabs and compact lists ----------
  await part('tabs and lists', async () => {
    const shop = await newPage({ viewport: { width: 1440, height: 900 } })
    await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const tablist = shop.getByRole('tablist').first()
    await tablist.scrollIntoViewIfNeeded()
    const tabs = await tablist.getByRole('tab').allInnerTexts()
    const hasSales = (await api('/api/v1/products?sort=best_selling&per_page=1')).body?.meta?.has_sales
    log(tabs.includes('Best selling') === Boolean(hasSales), `tabs ${tabs.join(' | ')} ("Best selling" ${hasSales ? 'shown: there are real sales' : 'hidden: no sales'})`)
    const first = tablist.getByRole('tab').first()
    await first.focus()
    await shop.keyboard.press('ArrowRight')
    const second = tablist.getByRole('tab').nth(1)
    log((await second.getAttribute('aria-selected')) === 'true' && (await shop.evaluate(() => document.activeElement?.getAttribute('role'))) === 'tab', 'ArrowRight selects and focuses the next tab')
    const panelId = await second.getAttribute('aria-controls')
    const panel = shop.locator(`#${panelId}`)
    await panel.locator('.product-card').first().waitFor({ timeout: 15000 })
    log((await panel.locator('.product-card').count()) >= 4, `its panel shows ${await panel.locator('.product-card').count()} products`)
    await shop.keyboard.press('End')
    log((await tablist.getByRole('tab').last().getAttribute('aria-selected')) === 'true', 'End selects the last tab')
    await axe(shop, 'home tabs')
    if (hasSales) {
      const best = (await api('/api/v1/products?sort=best_selling&per_page=4')).body.data.filter((item) => item.units_sold > 0).map((item) => item.name)
      // The compact list is a section named by its heading, holding an ordered list of links.
      const list = shop.locator('.compact-list').filter({ has: shop.getByRole('heading', { name: 'Best selling', exact: true }) })
      await list.locator('ol a').first().waitFor({ timeout: 15000 })
      const names = (await list.locator('ol a').allInnerTexts()).map((text) => text.trim()).filter(Boolean)
      log(best.length > 0 && best.every((name) => names.some((shown) => shown.startsWith(name))), `"Best selling" list = the API's real sellers (${best.join(', ')})`)
    }
    const view = shop.getByRole('link', { name: 'View all: Top rated' })
    await view.click()
    await shop.waitForURL(/sort=rating-desc/)
    log(true, `"View all: Top rated" → ${new URL(shop.url()).search}`)
    await shop.context().close()
  })

  // ---------- 5. Deliver to (Bangladesh store) ----------
  await part('deliver to', async () => {
    const patch = await admin$('/settings', { method: 'PATCH', body: { checkout: { default_country: 'Bangladesh' } } })
    if (patch.status !== 200) throw new Error(`could not set Bangladesh (${patch.status} ${JSON.stringify(patch.body?.errors ?? '')})`)
    const shop = await newPage({ viewport: { width: 1280, height: 900 } })
    await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const open = shop.getByRole('button', { name: /^Deliver to/ })
    log(await visible(open), `"${(await open.first().getAttribute('aria-label')) ?? (await open.first().innerText())}" in the header`)
    await open.first().click()
    const dialog = shop.getByRole('dialog', { name: 'Deliver to' })
    await dialog.waitFor()
    const choose = async (label, option) => {
      const select = dialog.getByLabel(label)
      await shop.waitForFunction(([wanted]) => [...document.querySelectorAll('dialog select')].some((s) => !s.disabled && [...s.options].some((o) => o.textContent.trim() === wanted)), [option], { timeout: 15000 })
      await select.selectOption({ label: option })
    }
    log(await dialog.getByRole('button', { name: 'Deliver here' }).isDisabled(), '"Deliver here" waits for an area')
    await choose('Division', 'Dhaka')
    await choose('District', 'Dhaka')
    await choose('Area (upazila or thana)', 'Banani')
    const summary = dialog.getByRole('region', { name: /Delivering to Banani/ })
    log(await visible(summary), 'the estimate: "Delivering to Banani, Dhaka"')
    log(await visible(dialog.getByText(/Delivery zone: Inside Dhaka/)), '"Delivery zone: Inside Dhaka"')
    log((await dialog.getByRole('list', { name: 'Delivery options' }).getByRole('listitem').count()) >= 1, 'a list of delivery options with prices and days')
    await axe(shop, 'Deliver to dialog')
    await dialog.getByRole('button', { name: 'Deliver here' }).click()
    await dialog.waitFor({ state: 'hidden' })
    log(await visible(shop.locator('.site-header').getByText(/Deliver to: Banani, Dhaka/)), 'top bar: "Deliver to: Banani, Dhaka …"')
    await shop.reload({ waitUntil: 'networkidle' })
    log(await visible(shop.getByRole('button', { name: /^Deliver to: Banani/ })), 'remembered after a reload')

    // Checkout: an empty Bangladesh address is pre-filled with the chosen place.
    await shop.goto(`${BASE}/products/124`, { waitUntil: 'networkidle' })
    await shop.locator('.product-details').getByRole('button', { name: /add to cart/i }).first().click()
    await shop.keyboard.press('Escape')
    await shop.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    await shop.locator('select[name="shipping.areaId"]').waitFor({ timeout: 20000 })
    await shop.waitForFunction(() => document.querySelector('select[name="shipping.areaId"]')?.selectedOptions?.[0]?.textContent?.trim() === 'Banani', null, { timeout: 15000 }).catch(() => {})
    const picked = await shop.evaluate(() => ['divisionId', 'districtId', 'areaId'].map((field) => document.querySelector(`select[name="shipping.${field}"]`)?.selectedOptions?.[0]?.textContent?.trim()))
    log(picked.join(' / ') === 'Dhaka / Dhaka / Banani', `checkout pre-filled: ${picked.join(' / ')}`)
    log(!(await shop.getByRole('navigation', { name: 'Quick links' }).isVisible()), 'no tab bar or promo in the checkout')
    // Clear
    await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await shop.getByRole('button', { name: /^Deliver to: Banani/ }).first().click()
    await shop.getByRole('dialog', { name: 'Deliver to' }).getByRole('button', { name: 'Clear' }).click()
    log(await visible(shop.getByRole('status').filter({ hasText: 'Delivery area cleared.' }).first(), 5000), '"Clear" forgets the area')
    await shop.context().close()
    await admin$('/settings', { method: 'PATCH', body: { checkout: { default_country: savedCheckout?.default_country ?? null } } })
  })

  // ---------- 6. Phones, tablets, footer ----------
  await part('phones and footer', async () => {
    const phone = await newPage({ viewport: { width: 390, height: 844 } })
    await phone.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const bar = phone.getByRole('navigation', { name: 'Quick links' })
    log(await visible(bar), 'phone: the bottom tab bar')
    const names = await bar.locator('a, button').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label') ?? item.textContent.trim()))
    log(names.length === 5, `tabs: ${names.join(' | ')}`)
    await bar.getByRole('button', { name: 'Search' }).click()
    log(await phone.evaluate(() => document.activeElement?.id === 'mobile-search-input'), '"Search" focuses the search box')
    await bar.getByRole('button', { name: 'Categories' }).click()
    log(await visible(phone.getByRole('dialog').first(), 5000), '"Categories" opens the category drawer')
    await phone.keyboard.press('Escape')
    const covered = await phone.evaluate(() => {
      const footer = document.querySelector('footer')
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
      return new Promise((resolve) => setTimeout(() => {
        const tab = document.querySelector('nav[aria-label="Quick links"]').getBoundingClientRect()
        const last = [...footer.querySelectorAll('a, button')].at(-1).getBoundingClientRect()
        resolve(last.bottom > tab.top)
      }, 800))
    })
    log(!covered, 'the tab bar never covers the end of the page')
    log((await sidewaysOverflow(phone)) <= 0, `390px: no sideways scroll (${await sidewaysOverflow(phone)}px)`)
    await axe(phone, 'home at 390px')
    const badges = phone.getByRole('list', { name: 'We accept' })
    log((await badges.getByRole('listitem').count()) >= 1, `footer: "We accept" ${await badges.getByRole('listitem').allInnerTexts()}`)
    await phone.context().close()

    const tablet = await newPage({ viewport: { width: 768, height: 1024 } })
    for (const path of ['/', '/products', '/products/84', '/cart']) {
      await tablet.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
      for (const width of [768, 900]) {
        await tablet.setViewportSize({ width, height: 1024 })
        await tablet.waitForTimeout(300)
        const overflow = await sidewaysOverflow(tablet)
        log(overflow <= 0, `${width}px ${path}: no sideways scroll (${overflow}px)`)
      }
    }
    await tablet.context().close()
  })
}
