// Phase 13 in a real browser: the store in Bangla (বাংলা) and English (docs/backend/PHASE13_CONTRACT.md, docs/I18N.md).
// The header switch (cookie `buynest_lang`, <html lang>, titles), home / listing / product / cart in Bangla with Bangla
// digits, "Use Bangla digits" off in Settings → General, search with a Bangla word, a product named in Bangla in the
// admin product form, the English fallback (lang="en"), a category's Bangla name, checkout with a Bangla error from the
// form and one from the API, the order (confirmation, `orders.locale`, email, invoice PDF) in Bangla, the account's
// language kept after sign-out / sign-in in a fresh browser, the admin (grid filter, email template Bangla tab, customer
// and order language), the store's default language, the one-time "বাংলায় দেখুন" hint, axe and 390px, and English
// unchanged after switching back.
//
// Runs against the usual servers (the store on :5173, the API on :8000). Needs the BuyNest API (E2E_ACCOUNTS=laravel)
// and its test inbox. A throwaway customer signs up through the API (code from the test inbox) and is deleted at the end
// (its order moved on to Delivered first; orders and invoices stay). The suite makes its own category and two products
// (Bangla texts cleared, then removed at the end) and puts Settings → General (default language, Bangla digits) back as
// read at the start, even on failure. Email templates are only previewed, never saved.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
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
  latestCode,
  launch,
  preserveStock,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('bangla: the store in Bangla and English (switch, content, digits, search, checkout, emails, PDF, account, admin)')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const run = Date.now().toString(36)
const tag = String(Date.now()).slice(-6)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const BN_DIGITS = '০১২৩৪৫৬৭৮৯'
const bnDigits = (text) => String(text).replace(/[0-9]/g, (digit) => BN_DIGITS[Number(digit)])
const hasBangla = (text) => /[ঀ-৿]/.test(text ?? '')
const api = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
      body: body && JSON.stringify(body),
    })
    // A busy run can hit the API's per-minute limit: wait as asked, then retry.
    if (response.status === 429 && attempt < 4) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) }
  }
}

// The throwaway customer (signed up through the API, deleted at the end).
const rina = { firstName: 'Rina', lastName: `Banglason${run}`, email: `bangla.${run}@example.com`, password: 'BanglaPass2026', phone: '+880 1711 000111' }
const names = {
  lamp: `E2E Clay Lamp ${run}`,
  lampBn: `মাটির প্রদীপ ${bnDigits(tag)}`,
  hook: `E2E Plain Hook ${run}`,
  category: `E2E Bangla Shelf ${run}`,
  categoryBn: `পরীক্ষার তাক ${bnDigits(tag)}`,
}
const texts = {
  lampDescription: 'A hand-made clay lamp for the Bangla browser check.',
  lampShortBn: 'হাতে তৈরি মাটির প্রদীপ, ঘর সাজাতে চমৎকার।',
  lampDescriptionBn: 'বাংলা ব্রাউজার পরীক্ষার জন্য হাতে তৈরি একটি মাটির প্রদীপ।',
  hookDescription: 'A plain steel hook that nobody has translated yet.',
}
const made = { products: [], category: null, categorySlug: null, orders: new Set(), customerId: null }
const errors = []
let owner = null
let browser = null
let restoreStock = async () => 0
let savedGeneral = null // Settings → General before the suite
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const orderOf = async (number) => (await admin$(`/orders/${number}`)).body?.data
const customerOf = async (id) => (await admin$(`/customers/${id}`)).body?.data

try {
  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  savedGeneral = (await admin$('/settings')).body?.data?.general ?? null
  if (!savedGeneral || savedGeneral.default_locale === undefined) throw new Error('the API has no general.default_locale (phase 13 not migrated?)')
  log(savedGeneral.default_locale === 'en' && savedGeneral.bangla_digits === true, `the store starts in English with Bangla digits on (default_locale ${savedGeneral.default_locale}, bangla_digits ${savedGeneral.bangla_digits})`)
  const store = (await api('/api/v1/store')).body?.data
  log(JSON.stringify(store?.locales) === '["en","bn"]' && store?.default_locale === 'en' && store?.bangla_digits === true, `GET /store: locales ${JSON.stringify(store?.locales)}, default_locale ${store?.default_locale}, bangla_digits ${store?.bangla_digits}`)
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
  async function newPage({ viewport = { width: 1280, height: 900 }, cookie, locale } = {}) {
    const context = await browser.newContext({ viewport, bypassCSP: true, ...(locale && { locale }) })
    context.setDefaultTimeout(15000)
    if (cookie) await context.addCookies([{ name: 'buynest_lang', value: cookie, url: BASE }])
    return watchErrors(await context.newPage(), errors)
  }
  async function adminPage() {
    const admin = await newPage({ viewport: { width: 1440, height: 900 } })
    await adminSignIn(admin, ADMIN_USER)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    return admin
  }
  const htmlLang = (page) => page.evaluate(() => document.documentElement.lang)
  const waitLang = (page, lang, timeout = 10000) => page.waitForFunction((want) => document.documentElement.lang === want, lang, { timeout }).then(() => true, () => false)
  const langCookie = async (page) => (await page.context().cookies(BASE)).find((cookie) => cookie.name === 'buynest_lang')
  const mainText = async (page) => (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  const switchTo = async (page, label) => {
    await page.locator('.site-header').getByRole('button', { name: label, exact: true }).click()
    return waitLang(page, label === 'বাংলা' ? 'bn' : 'en')
  }
  async function closeMiniCart(page) {
    const miniCart = page.getByRole('dialog', { name: /Your cart|আপনার কার্ট/ })
    if (await visible(miniCart, 3000)) {
      await page.keyboard.press('Escape')
      await miniCart.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    }
  }
  /** Waits until the checkout is priced by the server ("Checking prices…" / "দাম যাচাই হচ্ছে…" gone). */
  const settled = (page) =>
    page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Checking prices|দাম যাচাই হচ্ছে/.test(b.textContent)), null, { timeout: 20000 }).catch(() => {})
  async function download(page, click) {
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()])
    const path = await file.path()
    return { name: file.suggestedFilename(), bytes: path ? readFileSync(path) : Buffer.alloc(0) }
  }
  async function waitForMail(email, match, { after = 0, tries = 40 } = {}) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const response = await fetch(`${LARAVEL_URL}/dev/mailbox/latest?to=${encodeURIComponent(email.toLowerCase())}`)
      if (response.ok) {
        const { data } = await response.json()
        if (data.id > after && match.test(data.subject)) return data
      }
      await sleep(250)
    }
    return null
  }
  /** Polls Settings → General until `key` is `value` (the save notice may still be on screen from the last save). */
  async function generalIs(key, value) {
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await admin$('/settings')).body?.data?.general?.[key] === value) return true
      await sleep(250)
    }
    return false
  }
  const lastMailId = async (email) => {
    const response = await fetch(`${LARAVEL_URL}/dev/mailbox/latest?to=${encodeURIComponent(email.toLowerCase())}`)
    return response.ok ? ((await response.json()).data?.id ?? 0) : 0
  }

  // ---------- Test category and products (through the API, like the other suites) ----------
  const categoryMade = await admin$('/categories', { method: 'POST', body: { name: names.category, description: 'Things the Bangla browser check creates and removes.', translations: { bn: { name: names.categoryBn } } } })
  made.category = categoryMade.body?.data?.id ?? null
  made.categorySlug = categoryMade.body?.data?.slug ?? null
  log(categoryMade.status === 201 && categoryMade.body?.data?.translations?.bn?.name === names.categoryBn, `a test category with a Bangla name (${names.category} / ${names.categoryBn}, /${made.categorySlug})`)
  if (!made.categorySlug) throw new Error(`the test category could not be made (${categoryMade.status} ${JSON.stringify(categoryMade.body?.errors ?? categoryMade.body?.message)})`)
  const P = {}
  for (const [key, body] of Object.entries({
    lamp: { name: names.lamp, description: texts.lampDescription, price: 1250, specifications: [{ label: 'Material', value: 'Clay', label_bn: 'উপাদান', value_bn: 'মাটি' }] },
    hook: { name: names.hook, description: texts.hookDescription, price: 8, specifications: [] },
  })) {
    const created = await admin$('/products', { method: 'POST', body: { ...body, category: made.categorySlug, stock_quantity: 50, status: 'active', sku: `E2E-BN-${key}-${run}`.toUpperCase(), brand: 'NestWorks', weight: 400 } })
    P[key] = created.body?.data?.id
    if (P[key]) made.products.push(P[key])
  }
  log(Boolean(P.lamp && P.hook), `two test products in it (#${P.lamp} ${names.lamp} at $1,250.00, #${P.hook} ${names.hook} untranslated)`)
  if (!P.lamp || !P.hook) throw new Error('the test products could not be made')

  // ---------- The throwaway customer: signs up through the API, code from the test inbox ----------
  const registered = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { first_name: rina.firstName, last_name: rina.lastName, email: rina.email, phone: rina.phone, password: rina.password, password_confirmation: rina.password, accept_terms: true },
  })
  const verified = registered.status === 201 ? await api('/api/v1/auth/verify-email', { method: 'POST', body: { email: rina.email, code: (await latestCode(rina.email)).code } }) : registered
  made.customerId = ((await admin$(`/customers?search=${encodeURIComponent(rina.email)}`)).body?.data ?? []).find((row) => row.email === rina.email)?.id ?? null
  const fresh = made.customerId ? await customerOf(made.customerId) : null
  log(verified.status === 200 && Boolean(made.customerId) && fresh?.locale === null, `a throwaway customer signed up and confirmed, no language saved yet (${rina.email}, #${made.customerId}, locale ${fresh?.locale})`)
  if (!made.customerId) throw new Error('the throwaway customer could not sign up')

  // ---------- 1. The admin product form's Bangla section ----------
  await part('admin product form', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/products/${P.lamp}`, { waitUntil: 'networkidle' })
    const section = admin.locator('fieldset.bangla-section')
    await section.waitFor()
    log((await section.locator('legend').first().innerText()).includes('বাংলা') && (await visible(section.getByText('Missing texts'))), 'admin product form: a "Bangla (বাংলা)" section, "Missing texts"')
    const nameField = section.getByLabel('Name in Bangla', { exact: true })
    log((await nameField.getAttribute('lang')) === 'bn', 'the Bangla name field has lang="bn"')
    log(await visible(section.getByText(`Shoppers using Bangla see: “${names.lamp}”.`)), 'an empty Bangla name says "Falls back to English" with the English name')
    await nameField.fill(names.lampBn)
    await section.getByLabel('Short description in Bangla (optional)', { exact: true }).fill(texts.lampShortBn)
    await section.getByLabel('Description in Bangla', { exact: true }).fill(texts.lampDescriptionBn)
    log((await section.getByLabel('Label 1 in Bangla', { exact: true }).inputValue()) === 'উপাদান', 'the specification row shows its Bangla label (উপাদান)')
    await axe(admin, 'admin product form with the Bangla section')
    await admin.getByRole('button', { name: 'Save changes' }).click()
    log(await visible(admin.getByText(/Changes saved\./)), 'Save changes: "Changes saved."')
    const saved = (await admin$(`/products/${P.lamp}`)).body?.data
    log(
      saved?.translations?.bn?.name === names.lampBn && saved?.translations?.bn?.short_description === texts.lampShortBn && saved?.bangla?.complete === true,
      `saved: translations.bn.name "${saved?.translations?.bn?.name}", short description, bangla.complete ${saved?.bangla?.complete}`,
    )
    // Admin products grid: the Bangla filter.
    const filterSelect = admin.locator('label.toolbar__select').filter({ has: admin.locator('span', { hasText: /^Bangla$/ }) }).locator('select')
    await admin.goto(`${BASE}/admin/products?q=${encodeURIComponent(run)}`, { waitUntil: 'networkidle' })
    await admin.getByRole('link', { name: `Edit ${names.hook}` }).waitFor()
    await filterSelect.selectOption('complete')
    await admin.waitForURL(/bangla=complete/)
    await admin.getByRole('link', { name: `Edit ${names.hook}` }).waitFor({ state: 'detached' }).catch(() => {})
    await admin.getByRole('link', { name: `Edit ${names.lamp}` }).waitFor()
    const complete = await admin.locator('table tbody').innerText()
    log(complete.includes(names.lamp) && !complete.includes(names.hook), 'products grid, Bangla: Complete → the translated lamp only')
    await filterSelect.selectOption('missing')
    await admin.waitForURL(/bangla=missing/)
    await admin.getByRole('link', { name: `Edit ${names.lamp}` }).waitFor({ state: 'detached' }).catch(() => {})
    await admin.getByRole('link', { name: `Edit ${names.hook}` }).waitFor()
    const missing = await admin.locator('table tbody').innerText()
    log(missing.includes(names.hook) && !missing.includes(names.lamp), 'products grid, Bangla: Missing → the untranslated hook only')
    const rows = (await admin$(`/products?search=${encodeURIComponent(run)}&bangla=missing`)).body?.data ?? []
    log(rows.length === 1 && rows[0].id === P.hook && rows[0].bangla_complete === false, `the API filter agrees (bangla=missing → #${rows.map((row) => row.id).join(', #')})`)
    await admin.context().close()
  })

  // ---------- 2. The hint for a browser that prefers Bangla ----------
  await part('language hint', async () => {
    const page = await newPage({ locale: 'bn-BD' })
    await page.goto(`${BASE}/products/${P.lamp}`, { waitUntil: 'networkidle' })
    const hint = page.getByRole('complementary', { name: 'Language' })
    log(await visible(hint.getByRole('button', { name: 'বাংলায় দেখুন' })), 'a browser preferring Bangla on an English store: one "বাংলায় দেখুন" offer')
    log((await htmlLang(page)) === 'en' && (await page.locator('.product-details__title').innerText()).includes(names.lamp), 'the store did not switch on its own (lang="en", the English product name)')
    await axe(page, 'product page with the language hint')
    await hint.getByRole('button', { name: 'বাংলায় দেখুন' }).click()
    log(await waitLang(page, 'bn'), '"বাংলায় দেখুন" switches to Bangla (<html lang="bn">)')
    log(await visible(page.locator('.product-details__title').getByText(names.lampBn)), `the product name comes back in Bangla (${names.lampBn})`)
    log((await langCookie(page))?.value === 'bn', 'and saves the choice in the cookie')
    log(!(await visible(page.getByRole('button', { name: 'বাংলায় দেখুন' }), 1500)), 'the offer is gone')
    await page.context().close()

    // Dismissed once: never again in that browser.
    const other = await newPage({ locale: 'bn-BD' })
    await other.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const otherHint = other.getByRole('complementary', { name: 'Language' })
    await otherHint.getByRole('button', { name: 'Dismiss' }).click()
    await other.reload({ waitUntil: 'networkidle' })
    log(!(await visible(other.getByRole('button', { name: 'বাংলায় দেখুন' }), 2000)) && (await htmlLang(other)) === 'en', '"Dismiss": the offer does not come back after a reload, the store stays English')
    await other.context().close()

    const english = await newPage({ locale: 'en-US' })
    await english.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    log(!(await visible(english.getByRole('button', { name: 'বাংলায় দেখুন' }), 2000)), 'an English browser gets no offer')
    await english.context().close()
  })

  // ---------- 3. Switch in the header, browse in Bangla, cart ----------
  let shop = null
  await part('switch and browse', async () => {
    shop = await newPage()
    await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    log((await htmlLang(shop)) === 'en' && !(await langCookie(shop)), 'a first visit: English (<html lang="en">), no language cookie')
    const englishTitle = await shop.title()
    const group = shop.locator('.site-header').getByRole('group', { name: 'Language' })
    const options = await group.getByRole('button').evaluateAll((buttons) => buttons.map((b) => `${b.textContent}:${b.lang}:${b.getAttribute('aria-pressed')}`))
    log(options.join(',') === 'বাংলা:bn:false,English:en:true', `the header switch: ${options.join(', ')} (each in its own language with lang)`)
    log((await shop.locator('footer').getByRole('button', { name: 'বাংলা', exact: true }).count()) === 1, 'the footer has the switch too')
    log(await switchTo(shop, 'বাংলা'), 'বাংলা → <html lang="bn">')
    const cookie = await langCookie(shop)
    const days = cookie ? Math.round((cookie.expires * 1000 - Date.now()) / 86400000) : 0
    log(cookie?.value === 'bn' && cookie.sameSite === 'Lax' && days >= 364 && days <= 366, `cookie buynest_lang=bn (SameSite=${cookie?.sameSite}, ${days} days)`)
    await shop.waitForFunction((before) => document.title !== before, englishTitle, { timeout: 5000 }).catch(() => {})
    const title = await shop.title()
    const description = await shop.locator('meta[name="description"]').getAttribute('content')
    log(hasBangla(title) && hasBangla(description), `the title and meta description follow ("${title}" / "${description?.slice(0, 40)}…")`)
    const header = await shop.locator('.site-header').innerText()
    log(header.includes('সব পণ্য') && !/Shop all|Sign in\b/.test(header), 'the header in Bangla ("সব পণ্য", no "Shop all")')
    // Product prices only: the home hero is the store's own (English) content, not translated here.
    const homePrices = await shop.locator('main .product-card__price').allInnerTexts()
    log(homePrices.length > 0 && homePrices.every((price) => /\$[০-৯]/.test(price) && !/\d/.test(price)), `home: ${homePrices.length} product prices with Bangla digits (${homePrices[0]?.replace(/\s+/g, ' ')}), none with Latin digits`)
    log(!/Add to cart/.test(await mainText(shop)), 'home: no "Add to cart" left in English')
    await axe(shop, 'home in Bangla (lang="bn")')
    await phone(shop, 'the home page in Bangla')

    // The category listing: the category's Bangla name, Bangla and English product names.
    await shop.goto(`${BASE}/categories/${made.categorySlug}`, { waitUntil: 'networkidle' })
    const heading = shop.getByRole('heading', { level: 1 })
    await heading.waitFor()
    log((await heading.innerText()).includes(names.categoryBn), `category page: the Bangla name "${(await heading.innerText()).trim()}"`)
    const cards = shop.locator('.product-card')
    await cards.filter({ hasText: names.hook }).first().waitFor()
    const listing = await mainText(shop)
    log(listing.includes(names.lampBn) && listing.includes('$১,২৫০.০০'), `listing: "${names.lampBn}" at $১,২৫০.০০`)
    log(listing.includes(names.hook) && listing.includes('$৮.০০'), `listing: the untranslated "${names.hook}" in English at $৮.০০`)
    await axe(shop, 'category listing in Bangla')
    await phone(shop, 'the listing in Bangla')

    // Product page: translated content.
    await shop.goto(`${BASE}/products/${P.lamp}`, { waitUntil: 'networkidle' })
    const details = shop.locator('.product-details')
    await details.locator('.product-details__title').getByText(names.lampBn).waitFor()
    log((await details.locator('.product-details__title').getAttribute('lang')) === null, 'product page: the Bangla name, no lang override')
    log(await visible(details.getByText(texts.lampShortBn)), 'the Bangla short description under the title')
    log(await visible(shop.getByText(texts.lampDescriptionBn).first()), 'the Bangla description')
    log(await visible(details.locator('.product-details__price-current').getByText('$১,২৫০.০০')), 'price $১,২৫০.০০')
    const specTable = shop.locator('table').filter({ has: shop.locator('th[scope="row"]', { hasText: 'উপাদান' }) })
    log(await visible(specTable.getByText('মাটি')), 'specifications in Bangla (উপাদান: মাটি)')
    log((await shop.title()).includes(names.lampBn), `the page title has the Bangla name ("${await shop.title()}")`)
    await axe(shop, 'product page in Bangla')
    await phone(shop, 'the product page in Bangla')

    // The untranslated product: English text, marked lang="en".
    await shop.goto(`${BASE}/products/${P.hook}`, { waitUntil: 'networkidle' })
    const hookTitle = shop.locator('.product-details__title')
    await hookTitle.getByText(names.hook).waitFor()
    log((await hookTitle.getAttribute('lang')) === 'en', 'untranslated product: the English name with lang="en"')
    log(await visible(shop.getByText(texts.hookDescription).first()), 'and its English description (fallback per field)')
    log(await visible(shop.locator('.product-details').getByRole('button', { name: /কার্টে যোগ করুন/ })), 'the app text around it stays Bangla ("কার্টে যোগ করুন")')
    await axe(shop, 'untranslated product page in Bangla')

    // The API answers the same.
    const lampApi = (await api(`/api/v1/products/${P.lamp}`, { headers: { 'Accept-Language': 'bn' } })).body?.data
    const hookApi = await api(`/api/v1/products/${P.hook}`, { headers: { 'Accept-Language': 'bn' } })
    log(lampApi?.name === names.lampBn && lampApi?.locale === 'bn' && hookApi.body?.data?.locale === 'en' && hookApi.headers.get('content-language') === 'bn', `API in Bangla: lamp locale ${lampApi?.locale}, hook locale ${hookApi.body?.data?.locale} (Content-Language ${hookApi.headers.get('content-language')})`)

    // Search with a Bangla word.
    await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    const search = shop.locator('.site-header input[type="search"]').first()
    await search.fill('প্রদীপ')
    await search.press('Enter')
    await shop.waitForURL(/\/products\?q=/)
    await shop.locator('.product-card').filter({ hasText: names.lampBn }).first().waitFor({ timeout: 15000 }).catch(() => {})
    const results = await mainText(shop)
    log(results.includes('"প্রদীপ"-এর ফলাফল') && results.includes(names.lampBn), `search "প্রদীপ": "${results.match(/"প্রদীপ"-এর ফলাফল/)?.[0]}" with ${names.lampBn}`)
    const searchApi = (await api(`/api/v1/products?search=${encodeURIComponent('প্রদীপ')}`, { headers: { 'Accept-Language': 'bn' } })).body
    log((searchApi?.data ?? []).some((row) => row.id === P.lamp) && !searchApi?.meta?.corrected_query, `the API finds it by its Bangla name, no typo correction (corrected_query ${searchApi?.meta?.corrected_query ?? null})`)
    await axe(shop, 'search results in Bangla')

    // The cart.
    await shop.goto(`${BASE}/products/${P.lamp}`, { waitUntil: 'networkidle' })
    await shop.locator('.product-details').getByRole('button', { name: /কার্টে যোগ করুন/ }).first().click()
    await closeMiniCart(shop)
    await shop.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    await shop.getByRole('heading', { name: 'শপিং কার্ট', level: 1 }).waitFor()
    await shop.getByText('সাবটোটাল (১টি পণ্য)').first().waitFor()
    const cart = await mainText(shop)
    log(cart.includes(names.lampBn) && cart.includes('সাবটোটাল (১টি পণ্য)') && cart.includes('$১,২৫০.০০'), 'cart: "শপিং কার্ট", the Bangla name, "সাবটোটাল (১টি পণ্য)" $১,২৫০.০০')
    await axe(shop, 'cart in Bangla')
    await phone(shop, 'the cart in Bangla')
  })

  // ---------- 4. "Use Bangla digits" off in Settings → General ----------
  await part('Bangla digits setting', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const general = admin.locator('form.settings__group').filter({ has: admin.getByRole('heading', { name: 'General', exact: true }) })
    const digits = general.getByRole('checkbox', { name: 'Use Bangla digits' })
    await digits.waitFor()
    log((await digits.isChecked()) && (await general.getByLabel('Default store language').inputValue()) === 'en', 'Settings → General: "Default store language" English, "Use Bangla digits" on')
    await digits.uncheck()
    await general.getByRole('button', { name: 'Save general' }).click()
    log(await visible(admin.getByText('General saved.')), 'turned off: "General saved."')
    log(await generalIs('bangla_digits', false), 'the API has bangla_digits false')

    const page = await newPage({ cookie: 'bn' })
    await page.goto(`${BASE}/products/${P.lamp}`, { waitUntil: 'networkidle' })
    const price = page.locator('.product-details .product-details__price-current')
    await page.locator('.product-details__title').getByText(names.lampBn).waitFor()
    log(await visible(price.getByText('$1,250.00')), `Bangla with the setting off: Latin digits ($1,250.00 next to "${await page.locator('.product-details').getByRole('button', { name: /কার্টে যোগ করুন/ }).first().innerText()}")`)
    await page.context().close()

    await digits.check()
    await general.getByRole('button', { name: 'Save general' }).click()
    log(await generalIs('bangla_digits', true), 'turned back on (bangla_digits true)')
    await admin.context().close()
  })

  // ---------- 5. Signed in: the language saved to the account, checkout, order, email, PDF ----------
  let number = null
  await part('account and checkout', async () => {
    const page = await newPage()
    await storefrontSignIn(page, rina)
    log((await htmlLang(page)) === 'en', 'the throwaway customer signs in (English, no language saved)')
    log(await switchTo(page, 'বাংলা'), 'switches to বাংলা while signed in')
    let saved = null
    for (let attempt = 0; attempt < 20 && saved !== 'bn'; attempt++) {
      saved = (await customerOf(made.customerId))?.locale
      if (saved !== 'bn') await sleep(250)
    }
    log(saved === 'bn', `the choice is saved to the account (customers.locale ${saved})`)

    // Checkout: a Bangla error from the form, then one from the API.
    await page.goto(`${BASE}/products/${P.lamp}`, { waitUntil: 'networkidle' })
    await page.locator('.product-details').getByRole('button', { name: /কার্টে যোগ করুন/ }).first().click()
    await closeMiniCart(page)
    await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
    const place = page.getByRole('button', { name: /^অর্ডার করুন · / })
    await place.waitFor({ timeout: 20000 })
    await settled(page)
    log((await place.innerText()).trim() === 'অর্ডার করুন · $১,২৫০.০০', `the button: "${(await place.innerText()).trim()}"`)
    await page.locator('[name="shipping.firstName"]').fill('')
    await place.click()
    log(await visible(page.getByText('নামের প্রথম অংশ লিখুন।').first()), 'an empty first name: "নামের প্রথম অংশ লিখুন।" (from the form)')
    await axe(page, 'checkout in Bangla with form errors')
    await phone(page, 'the checkout in Bangla')
    const address = { firstName: 'Rina', lastName: 'Akter', line1: 'House 12, Road 5', city: 'Dhaka', state: 'Dhaka', postalCode: '1207' }
    for (const [field, value] of Object.entries(address)) await page.locator(`[name="shipping.${field}"]`).fill(value)
    await page.locator('[name="shipping.country"]').selectOption('Bangladesh').catch(() => {})
    // A phone number without the country code passes the form but not the API.
    await page.locator('[name="phone"]').fill('01712 345678')
    const cod = page.getByRole('radio', { name: /ক্যাশ অন ডেলিভারি/ })
    if (await visible(cod, 3000)) await cod.check()
    await settled(page)
    await place.click()
    const apiMessage = 'দেশের কোডসহ ফোন নম্বর দিন, যেমন +880 1712 345678।'
    log(await visible(page.getByText(apiMessage).first(), 20000), `a phone number without the country code: "${apiMessage}" (from the API)`)
    log(new URL(page.url()).pathname === '/checkout', 'no order was placed')
    await page.locator('[name="phone"]').fill('+880 1712 345678')
    const mailBefore = await lastMailId(rina.email)
    await settled(page)
    await place.click()
    await page.waitForURL(/\/order-confirmation\/BN-/, { timeout: 30000 })
    number = new URL(page.url()).pathname.split('/').pop()
    made.orders.add(number)
    await page.getByRole('heading', { name: `ধন্যবাদ, ${rina.firstName}!` }).waitFor()
    const confirmation = await mainText(page)
    log((await htmlLang(page)) === 'bn' && confirmation.includes('$১,২৫০.০০') && !/\$\d/.test(confirmation), `order ${number}: the confirmation in Bangla ("ধন্যবাদ, ${rina.firstName}!", $১,২৫০.০০)`)
    await axe(page, 'order confirmation in Bangla')
    await phone(page, 'the confirmation in Bangla')
    const order = await orderOf(number)
    log(order?.locale === 'bn', `orders.locale = ${order?.locale}`)
    log(order?.items?.[0]?.name === names.lamp, `the order item keeps the English name for staff ("${order?.items?.[0]?.name}")`)

    const mail = await waitForMail(rina.email, new RegExp(number), { after: mailBefore })
    log(mail?.subject === `আপনার BuyNest অর্ডার ${number}`, `the order email's subject is Bangla ("${mail?.subject}")`)
    log(Boolean(mail) && mail.text.includes('অর্ডারের জন্য ধন্যবাদ') && /\$১,২৫০\.০০/.test(mail.text) && !/\$\d/.test(mail.text) && !/Thanks for your order/.test(mail.text), 'the order email body: "অর্ডারের জন্য ধন্যবাদ", $১,২৫০.০০, no English')

    // Invoice in the admin (through the API), then the PDF from the account order page.
    const invoiced = await admin$(`/orders/${number}/invoices`, { method: 'POST', body: { notify_customer: false } })
    const invoiceNumber = invoiced.body?.data?.number ?? (await orderOf(number))?.invoices?.[0]?.number
    log(invoiced.status === 201 && Boolean(invoiceNumber), `invoiced (${invoiceNumber})`)
    await page.goto(`${BASE}/account/orders/${number}`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: `অর্ডার ${number}` }).waitFor()
    const orderPage = await mainText(page)
    log(orderPage.includes('$১,২৫০.০০') && orderPage.includes(names.lamp), 'Account → the order in Bangla ($১,২৫০.০০; the item keeps its English name)')
    await axe(page, 'account order page in Bangla')
    const pdfButton = page.getByRole('button', { name: `ইনভয়েস ${invoiceNumber}-এর পিডিএফ ডাউনলোড করুন` })
    if (await visible(pdfButton, 5000)) {
      const file = await download(page, () => pdfButton.click())
      const isPdf = file.bytes.subarray(0, 4).toString('latin1') === '%PDF'
      const bengali = /NotoSansBengali/.test(file.bytes.toString('latin1'))
      log(isPdf && bengali, `the invoice PDF (${file.name}, ${file.bytes.length} bytes) embeds Noto Sans Bengali`)
      const text = pdfText(file.bytes)
      if (text === null) log(true, '(pdftotext not installed: the PDF text was not read)')
      else log(hasBangla(text) && /[০-৯]/.test(text) && !/Subtotal|Invoice\b/.test(text), `the PDF text is Bangla with Bangla digits (${text.replace(/\s+/g, ' ').slice(0, 60)}…)`)
    } else log(false, `no "ইনভয়েস ${invoiceNumber}-এর পিডিএফ ডাউনলোড করুন" button`)

    // Sign out; a fresh browser (no cookie) signs in and gets Bangla from the account.
    await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'সাইন আউট' }).click()
    await page.waitForURL(`${BASE}/`)
    await page.context().close()
    const other = await newPage()
    await storefrontSignIn(other, rina)
    log(await waitLang(other, 'bn'), 'a fresh browser, signed in: the account\'s Bangla is applied (<html lang="bn">)')
    log((await langCookie(other))?.value === 'bn', 'and written to that browser\'s cookie')
    log(await visible(other.getByRole('button', { name: 'সাইন আউট' })), 'the account page in Bangla ("সাইন আউট")')
    await axe(other, 'account page in Bangla')
    await other.context().close()
  })

  // ---------- 6. The admin: email template Bangla tab, customer and order language ----------
  await part('admin language screens', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/email-templates/order_confirmation`, { waitUntil: 'networkidle' })
    await admin.getByRole('tab', { name: /Bangla/ }).click()
    await admin.waitForURL(/lang=bn/)
    const frame = admin.locator('iframe.email-preview')
    await frame.waitFor({ timeout: 20000 })
    const subject = await admin.locator('.email-preview__subject strong').innerText()
    const srcdoc = (await frame.getAttribute('srcdoc')) ?? ''
    log(subject.startsWith('আপনার BuyNest অর্ডার') && (await frame.getAttribute('title')) === 'Preview of Order confirmation in Bangla', `email template → Bangla tab: the preview "${subject}"`)
    log(/lang="bn"/.test(srcdoc) && /[০-৯]/.test(srcdoc) && srcdoc.includes('অর্ডারের জন্য ধন্যবাদ'), 'the preview is Bangla (lang="bn", Bangla digits)')
    log((await admin.getByLabel('Subject').getAttribute('lang')) === 'bn', 'the Bangla subject field has lang="bn"')
    await axe(admin, 'email template editor, Bangla tab')
    const templates = (await admin$('/email-templates?locale=bn')).body?.data?.find((row) => row.key === 'order_confirmation')
    log(templates?.locales?.bn?.is_customized === false && templates?.locales?.en?.is_customized === false, 'the template was only previewed (both languages still default)')

    await admin.goto(`${BASE}/admin/customers/${made.customerId}`, { waitUntil: 'networkidle' })
    const tile = admin.locator('.stat').filter({ has: admin.locator('.stat__label', { hasText: /^Language$/ }) }).first()
    log(await visible(tile.getByText('Bangla (বাংলা)')), 'admin customer page: Language "Bangla (বাংলা)"')
    await admin.goto(`${BASE}/admin/orders/${number}`, { waitUntil: 'networkidle' })
    const language = admin.locator('dt', { hasText: /^Language$/ }).locator('xpath=following-sibling::dd[1]')
    await language.waitFor()
    log((await language.innerText()).replace(/\s+/g, ' ').includes('Bangla (বাংলা) · placed in this language'), `admin order page: "${(await language.innerText()).replace(/\s+/g, ' ').trim()}"`)
    await axe(admin, 'admin order page with the language')
    await admin.context().close()
  })

  // ---------- 7. The store's default language ----------
  await part('default store language', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const general = admin.locator('form.settings__group').filter({ has: admin.getByRole('heading', { name: 'General', exact: true }) })
    await general.getByLabel('Default store language').selectOption('bn')
    await general.getByRole('button', { name: 'Save general' }).click()
    log((await generalIs('default_locale', 'bn')) && (await api('/api/v1/store')).body?.data?.default_locale === 'bn', 'Default store language → Bangla (GET /store default_locale bn)')
    const visitor = await newPage()
    await visitor.goto(`${BASE}/products/${P.lamp}`, { waitUntil: 'networkidle' })
    log(await waitLang(visitor, 'bn'), 'a new visitor with no cookie sees Bangla (<html lang="bn">)')
    const visitorTitle = visitor.locator('.product-details__title')
    log(await visible(visitorTitle.getByText(names.lampBn)), `with the Bangla product name ("${await visitorTitle.innerText().catch(() => 'no title')}")`)
    log(!(await langCookie(visitor)), 'no cookie is written for a choice the visitor did not make')
    await visitor.context().close()
    await general.getByLabel('Default store language').selectOption('en')
    await general.getByRole('button', { name: 'Save general' }).click()
    log((await generalIs('default_locale', 'en')) && (await api('/api/v1/store')).body?.data?.default_locale === 'en', 'back to English (default_locale en)')
    await admin.context().close()
  })

  // ---------- 8. Back to English: unchanged ----------
  await part('back to English', async () => {
    const page = shop ?? (await newPage({ cookie: 'bn' }))
    await page.goto(`${BASE}/products/${P.lamp}`, { waitUntil: 'networkidle' })
    await page.locator('.product-details__title').getByText(names.lampBn).waitFor()
    log(await switchTo(page, 'English'), 'English → <html lang="en">')
    log((await langCookie(page))?.value === 'en', 'cookie buynest_lang=en')
    await page.locator('.product-details__title').getByText(names.lamp).waitFor({ timeout: 10000 }).catch(() => {})
    const details = page.locator('.product-details')
    log((await details.locator('.product-details__title').innerText()).trim() === names.lamp, `the product name is English again (${names.lamp})`)
    log(await visible(details.locator('.product-details__price-current').getByText('$1,250.00')), 'price $1,250.00')
    log(await visible(details.getByRole('button', { name: /Add to cart/ })), '"Add to cart"')
    log(!(await visible(details.getByText(texts.lampShortBn), 1000)), 'no Bangla short description in English')
    log((await page.title()).includes(names.lamp) && !hasBangla(await page.title()), `the title is English ("${await page.title()}")`)
    await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Shopping cart', level: 1 }).waitFor()
    const cart = await mainText(page)
    log(cart.includes(names.lamp) && cart.includes('Subtotal (1 item)') && cart.includes('$1,250.00') && !hasBangla(cart), 'cart in English: "Shopping cart", "Subtotal (1 item)" $1,250.00, no Bangla')
    const header = await page.locator('.site-header').innerText()
    log(header.includes('Shop all') && !hasBangla(header.replace('বাংলা', '')), 'the header in English again')
    await axe(page, 'cart in English after switching back')
    await page.context().close()
  })
}

/** The text of a PDF through pdftotext (null when it isn't installed). */
function pdfText(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'bangla-pdf-'))
  try {
    const file = join(dir, 'invoice.pdf')
    writeFileSync(file, bytes)
    const result = spawnSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8' })
    if (result.error) return null
    return result.stdout
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
  await attempt('general settings', async () => {
    if (!savedGeneral) return
    const answer = await admin$('/settings', { method: 'PATCH', body: { general: savedGeneral } })
    if (answer.status !== 200) throw new Error(`PATCH settings answered ${answer.status} ${JSON.stringify(answer.body?.errors ?? answer.body?.message)}`)
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
    // Bangla texts cleared first (products are only soft-deleted), moved out of the test category, parked as Drafts, deleted.
    const empty = { name: null, short_description: null, description: null, meta_title: null, meta_description: null }
    for (const id of made.products) {
      await admin$(`/products/${id}`, { method: 'PATCH', body: { translations: { bn: empty }, category: 'home-decoration', status: 'draft' } })
      await admin$(`/products/${id}`, { method: 'DELETE' })
    }
  })
  await attempt('category', async () => {
    if (!made.category) return
    await admin$(`/categories/${made.category}`, { method: 'PATCH', body: { translations: { bn: { name: null, description: null, meta_title: null, meta_description: null } } } })
    const deleted = await admin$(`/categories/${made.category}`, { method: 'DELETE' })
    if (deleted.status !== 204) throw new Error(`DELETE category answered ${deleted.status} ${JSON.stringify(deleted.body?.errors ?? deleted.body?.message)}`)
  })
  await attempt('saved carts', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })
  await attempt('stock', () => restoreStock())

  const general = (await admin$('/settings')).body?.data?.general
  const leftProducts = ((await admin$(`/products?search=${encodeURIComponent(run)}`)).body?.data ?? []).length
  const leftCustomer = ((await admin$(`/customers?search=${encodeURIComponent(rina.email)}`)).body?.data ?? []).length
  const leftCategory = made.category && JSON.stringify((await admin$('/categories')).body?.data ?? []).includes(`"id":${made.category},`)
  const leftTranslations = made.products.length ? translationRows(made.products, made.category) : 0
  const settingsBack = JSON.stringify(general) === JSON.stringify(savedGeneral)
  log(
    problems.length === 0 && settingsBack && leftProducts === 0 && leftCustomer === 0 && !leftCategory && leftTranslations === 0,
    `cleanup: Settings → General as before, test products (with their Bangla texts) and category removed, the throwaway customer deleted, stock put back (orders stay)${problems.length || !settingsBack || leftProducts || leftCustomer || leftCategory || leftTranslations ? ` — left: ${[...problems, `general ${JSON.stringify(general)}`, `${leftProducts} products`, `${leftCustomer} customer`, `category ${leftCategory}`, `${leftTranslations} translation rows`].join('; ')}` : ''}`,
  )
}

/** Bangla rows still in the translation tables for the suite's products and category (php artisan tinker, local only). */
function translationRows(products, category) {
  const result = spawnSync(
    'php',
    ['artisan', 'tinker', `--execute=echo DB::table('product_translations')->whereIn('product_id', [${products.join(',')}])->count() + DB::table('category_translations')->where('category_id', ${Number(category) || 0})->count();`],
    { cwd: new URL('../backend/', import.meta.url).pathname, encoding: 'utf8', timeout: 60_000 },
  )
  const count = Number(result.stdout.trim().split('\n').pop())
  return Number.isFinite(count) ? count : -1
}
