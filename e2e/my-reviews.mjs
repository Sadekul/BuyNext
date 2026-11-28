// Phase 23 in a real browser: My account → My reviews (docs/backend/PHASE23_CONTRACT.md §3).
//
// Runs against the usual servers (the store on :5173, the API on :8000). Needs the BuyNest API (E2E_ACCOUNTS=laravel).
// Nothing reaches an outside service.
//
// Checks: Ava's My reviews page (heading, the "My reviews" link in the account menu, none of the suite's products
// yet, the empty state when she has no reviews at all, axe); Ava writes review A (2 photos) on product 1 and review B
// (no photos) on product 2 with "New reviews wait for approval" on: both "Waiting for approval", A's thumbnails load
// through the owner address /api/shop/me/reviews/{id}/photos/{photoId} (no-store, nosniff, sandbox CSP), the
// storefront's list answer is allow-listed, a visitor gets 401 and Ben 404 for that address, and the API answers 404
// to Ben's DELETE of A (the review and photo) and refuses a staff token; product 1's page says "You've already
// reviewed this product" with a link to My reviews instead of the form; staff approve A, reject B and hide A's
// photo 2: A "Published" with photo 2 "Hidden by the shop" (still visible to Ava), B "Not published", the viewer
// opens, 390px fits; the data export lists A's photos (width, height, hidden, added_at, no file) and photos_note;
// Ava deletes A's photo 2 ("Keep it" first changes nothing, then "Delete photo": "The photo was deleted.", 1 photo
// left, renumbered, status kept, its owner address 404, audited); Ava deletes review A (dialog text, "Your review was
// deleted.", the card goes, focus on a heading, the store no longer lists it, review_count back down, the remaining
// photo's public URL 404, audited); product 1's page shows the form again and a new review (no photos) is "Waiting
// for approval"; 390px and axe with the "Delete your review?" dialog open; Bangla heading and status badges (the
// Bangla words are looked up in frontend/src/locales by their English text) and axe in Bangla.
//
// Put back or removed (in finally, even on failure): catalog.reviews_require_approval and catalog.review_photos_enabled
// as read at the start, every review on the suite's two products (their photo files go with them), both products,
// and the demo accounts' saved carts and language (the Bangla part saves bn to Ava's account). Ava
// (customer@buynest.test) only writes reviews on the suite's own products; Ben (shopper2@buynest.test) only proves
// that someone else's review answers 404.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ADMIN_USER,
  BASE,
  LARAVEL,
  LARAVEL_URL,
  SHOPPER,
  SHOPPER_2,
  axeViolations,
  clearSavedCart,
  launch,
  overflowCulprits,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('my-reviews: My reviews page, owner-only photos, delete a photo / a review, 404 for others, Bangla, export')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const run = Date.now().toString(36)
const marker = `e2e${run}`
const product1Name = `E2E Review Lamp ${marker}`
const product2Name = `E2E Review Mug ${marker}`
const textA = `Warm light and a sturdy base, photos attached, ${marker}.`
const textB = `Keeps tea hot for a long time, ${marker}.`
const textC = `Writing again after deleting my first review, ${marker}.`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const BENGALI = /[ঀ-৿]/
const OWNER_URL = /^\/api\/shop\/me\/reviews\/\d+\/photos\/\d+$/
const PUBLIC_URL = /^\/media\/reviews\/[a-f0-9]{32}\.(?:jpg|png|webp)$/
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const api = async (path, { method = 'GET', token, body, form } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(!form && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: form ?? (body && JSON.stringify(body)),
    })
    // A busy run can hit the API's per-minute limit: wait as asked (a short wait only), then retry.
    const wait = Number(response.headers.get('retry-after')) || 5
    if (response.status === 429 && attempt < 4 && wait <= 90) {
      await sleep(wait * 1000)
      continue
    }
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) }
  }
}

/** A review photo through the store's public address (/media/reviews/<name>), as a visitor gets it. */
const publicPhoto = async (url) => {
  const response = await fetch(`${BASE}${url}`)
  await response.arrayBuffer().catch(() => null)
  return response.status
}

/**
 * Bangla words by their English text: every key of frontend/src/locales/en/*.json whose value is `english`, read in
 * the matching bn file (the vitest suite checks both files have the same keys). An empty list when not found.
 */
const LOCALES = join(import.meta.dirname, '..', 'frontend', 'src', 'locales')
function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) flatten(inner, prefix ? `${prefix}.${key}` : key, out)
  else out[prefix] = value
  return out
}
function banglaFor(english) {
  const found = new Set()
  try {
    for (const file of readdirSync(join(LOCALES, 'en')).filter((name) => name.endsWith('.json'))) {
      const en = flatten(JSON.parse(readFileSync(join(LOCALES, 'en', file), 'utf8')))
      const bn = flatten(JSON.parse(readFileSync(join(LOCALES, 'bn', file), 'utf8')))
      for (const [key, value] of Object.entries(en)) if (value === english && typeof bn[key] === 'string' && BENGALI.test(bn[key])) found.add(bn[key])
    }
  } catch {
    // No locale files next to the suite: the Bangla checks fall back to "has Bangla letters, not the English".
  }
  return [...found]
}

const made = { productIds: [], reviewA: null, reviewB: null, photoIds: [], ownerUrls: [], publicUrl: null }
const errors = []
let owner = null
let avaToken = null
let benToken = null
let browser = null
let savedCatalog = null // Settings → Catalog before the suite
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const ava$ = (path, options = {}) => api(`/api/v1${path}`, { token: avaToken, ...options })
const ben$ = (path, options = {}) => api(`/api/v1${path}`, { token: benToken, ...options })
const reviewsOfRun = async () => (await admin$(`/reviews?search=${encodeURIComponent(marker)}&per_page=50`)).body?.data ?? []
const publicProduct = async (id) => (await api(`/api/v1/products/${id}`)).body?.data
/** Ava's own reviews of one product, from the API (newest first). */
const avasReviewsOf = async (productId) => (await ava$(`/me/reviews?product_id=${productId}`)).body?.data ?? []
const customerToken = async (account) => (await api('/api/v1/auth/login', { method: 'POST', body: { email: account.email, password: account.password } })).body?.data?.tokens?.access_token

try {
  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  savedCatalog = (await admin$('/settings')).body?.data?.catalog ?? null
  if (!savedCatalog || !('review_photos_enabled' in savedCatalog)) throw new Error(`the API has no catalog.review_photos_enabled setting (phase 22 not migrated?): ${JSON.stringify(savedCatalog)}`)
  avaToken = await customerToken(SHOPPER)
  benToken = await customerToken(SHOPPER_2)
  if (!avaToken || !benToken) throw new Error('Ava or Ben could not sign in to the API')
  const probe = await ava$('/me/reviews')
  if (probe.status !== 200) throw new Error(`GET /api/v1/me/reviews answered ${probe.status} (phase 23 API not built yet?)`)
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

// ---------------------------------------------------------------- Photos made for the suite
async function makePhotos() {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } })
  const page = await context.newPage()
  const box = async (width, height, colours) => {
    await page.setContent(`<body style="margin:0"><div id="box" style="width:${width}px;height:${height}px;background:linear-gradient(135deg, ${colours.join(', ')})"></div></body>`)
    return page.locator('#box').screenshot({ type: 'png' })
  }
  const photos = {
    green: { name: 'lamp-on.png', mimeType: 'image/png', buffer: await box(800, 600, ['#065f46', '#a7f3d0']) },
    orange: { name: 'lamp-base.png', mimeType: 'image/png', buffer: await box(600, 800, ['#c2410c', '#fed7aa']) },
  }
  await context.close()
  return photos
}

// ---------------------------------------------------------------- Checks
async function runChecks() {
  const axe = async (page, name) => {
    const violations = await axeViolations(page)
    log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
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
  /**
   * A customer signed in (English sign-in page) in a fresh browser (the store's answers may be cached for a minute in
   * one browser). After sign-in the account's language wins over the cookie (phase 13), so Bangla is chosen with the
   * header switch, as a shopper would. Clean-up resets Ava's language.
   */
  async function signedIn(account, path, { lang = null, viewport } = {}) {
    const page = await newPage(viewport)
    await storefrontSignIn(page, account)
    if (path) await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    if (lang === 'bn') {
      await page.locator('.site-header').getByRole('button', { name: 'বাংলা', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.lang === 'bn', null, { timeout: 15000 })
      await page.waitForLoadState('networkidle')
    }
    return page
  }
  const myReviews = (options) => signedIn(SHOPPER, '/account/reviews', options)
  const pageHeading = (page) => page.getByRole('heading', { name: 'My reviews', exact: true })
  /** A review card: the (outermost) article or list item holding "Delete your review of {product}". */
  const cardOf = (page, name) => page.locator('article, li').filter({ has: page.getByRole('button', { name: `Delete your review of ${name}`, exact: true }) }).first()
  const badge = (card, text) => card.getByText(text, { exact: true })
  const ownerImages = (card) => card.locator('img[src*="/api/shop/me/reviews/"]')
  const notice = (page, text) => page.locator('[role="status"], [aria-live="polite"]').filter({ hasText: text })
  const dialogWith = (page, text) => page.getByRole('dialog').filter({ hasText: text })
  const stars = async (card, rating) => {
    const name = `${rating} out of 5 stars`
    return (await card.getByRole('img', { name, exact: true }).count()) + (await card.getByLabel(name, { exact: true }).count()) + (await card.getByText(name, { exact: true }).count()) > 0
  }
  /** Waits for the images to finish (scrolled into view first: lazy images load only near the screen); their natural widths. */
  async function naturalWidths(locator) {
    const count = await locator.count()
    for (let index = 0; index < count; index++) await locator.nth(index).scrollIntoViewIfNeeded().catch(() => {})
    for (let wait = 0; wait < 40; wait++) {
      const widths = await locator.evaluateAll((images) => images.map((image) => (image.complete ? image.naturalWidth : -1)))
      if (widths.every((width) => width !== -1)) return widths
      await sleep(250)
    }
    return locator.evaluateAll((images) => images.map((image) => image.naturalWidth))
  }
  /** An owner photo address fetched with the page's cookies (the customer's session, or none). */
  async function ownerPhoto(page, url) {
    const response = await page.request.get(`${BASE}${url}`, { failOnStatusCode: false })
    const headers = response.headers()
    await response.body().catch(() => null)
    return { status: response.status(), type: headers['content-type'] ?? '', cache: headers['cache-control'] ?? '', nosniff: headers['x-content-type-options'] ?? '', csp: headers['content-security-policy'] ?? '' }
  }
  const focusedHeading = (page) =>
    page.evaluate(() => {
      const element = document.activeElement
      return element && (/^H[1-6]$/.test(element.tagName) || element.getAttribute('role') === 'heading') ? element.textContent.trim().slice(0, 80) : null
    })
  const fits = async (page, name) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const overflow = await sidewaysOverflow(page)
    log(overflow <= 0, `390px ${name}: no sideways scroll (${overflow}px)${overflow > 0 ? ` — sticks out: ${await overflowCulprits(page)}` : ''}`)
    await page.setViewportSize({ width: 1280, height: 900 })
  }

  const photos = await makePhotos()

  // ---------- 0. Settings and the suite's two products ----------
  const settingsAnswer = await admin$('/settings', { method: 'PATCH', body: { catalog: { reviews_require_approval: true, review_photos_enabled: true } } })
  log(settingsAnswer.status === 200, `Settings → Catalog: reviews wait for approval, photos on (${settingsAnswer.status})`)
  for (const [index, name] of [product1Name, product2Name].entries()) {
    const created = await admin$('/products', {
      method: 'POST',
      body: { name, category: 'home-decoration', price: 18 + index, stock_quantity: 40, status: 'active', sku: `E2E-MYR${index + 1}-${run}`.toUpperCase(), brand: 'NestWorks', weight: 400 },
    })
    const id = created.body?.data?.id ?? null
    if (id) made.productIds.push(id)
    log(created.status === 201 && Boolean(id), `the suite's product ${index + 1} (#${id}, ${name})`)
  }
  if (made.productIds.length !== 2) throw new Error('the test products could not be made')
  const [product1, product2] = made.productIds

  // ---------- 1. My reviews with none on the suite's products ----------
  await part('My reviews before', async () => {
    const page = await signedIn(SHOPPER, '/account')
    const menuLink = page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'My reviews', exact: true })
    log(await visible(menuLink), 'the account menu has "My reviews"')
    log((await menuLink.first().getAttribute('href').catch(() => null)) === '/account/reviews', `it links to /account/reviews (${await menuLink.first().getAttribute('href').catch(() => null)})`)
    await menuLink.first().click()
    await page.waitForURL((url) => url.pathname === '/account/reviews', { timeout: 15000 }).catch(() => {})
    await page.waitForLoadState('networkidle')
    log(await visible(pageHeading(page)), `the page loads with the heading "My reviews" (${new URL(page.url()).pathname})`)
    const listed = await ava$('/me/reviews')
    const total = listed.body?.meta?.total ?? -1
    const suiteNames = (await page.getByText(new RegExp(escapeRegExp(marker))).count()) === 0
    log(suiteNames, "none of the suite's products is listed yet")
    if (total === 0) {
      log(await visible(page.getByText("You haven't written any reviews yet.", { exact: true }).or(page.getByText('You haven’t written any reviews yet.', { exact: true }))), 'no reviews: "You haven\'t written any reviews yet."')
      log(await visible(page.getByRole('link', { name: 'Browse products', exact: true })), 'with a "Browse products" link')
    } else {
      log(total > 0, `Ava has ${total} other review(s), so the empty state isn't expected`)
    }
    await axe(page, 'My reviews')
    await page.context().close()
  })

  // ---------- 2. Review A (2 photos) on product 1, review B (no photos) on product 2 ----------
  await part('two pending reviews', async () => {
    const form = new FormData()
    form.append('rating', '4')
    form.append('title', 'Lovely lamp')
    form.append('comment', textA)
    for (const photo of [photos.green, photos.orange]) form.append('photos[]', new Blob([photo.buffer], { type: photo.mimeType }), photo.name)
    const a = await ava$(`/products/${product1}/reviews`, { method: 'POST', form })
    const b = await ava$(`/products/${product2}/reviews`, { method: 'POST', body: { rating: 3, title: 'Good mug', comment: textB } })
    log(a.status === 201 && b.status === 201 && a.body?.data?.status === 'pending' && b.body?.data?.status === 'pending', `Ava writes A (2 photos) and B (no photos): ${a.status} ${a.body?.data?.status}, ${b.status} ${b.body?.data?.status}`)

    // The API: her own reviews, every status, the owner photo addresses
    const [itemA] = await avasReviewsOf(product1)
    const [itemB] = await avasReviewsOf(product2)
    made.reviewA = itemA?.id ?? null
    made.reviewB = itemB?.id ?? null
    const photoRows = [...(itemA?.photos ?? [])].sort((x, y) => x.position - y.position)
    made.photoIds = photoRows.map((photo) => photo.id)
    made.ownerUrls = photoRows.map((photo) => photo.url)
    log(
      itemA?.comment === textA && itemA.status === 'pending' && itemA.rating === 4 && itemA.product?.id === product1 && itemA.product?.name === product1Name && itemA.product?.available === true,
      `API me/reviews?product_id: A pending, 4 stars, product { id, name, available: true } (${JSON.stringify(itemA?.product)})`,
    )
    log(
      photoRows.length === 2 && photoRows.every((photo, index) => photo.url === `/api/shop/me/reviews/${made.reviewA}/photos/${photo.id}` && photo.hidden === false && photo.width > 0 && photo.height > 0 && photo.position === index),
      `A's photos have the storefront owner address, hidden false, positions 0 and 1 (${made.ownerUrls.join(', ')})`,
    )
    log(itemB?.comment === textB && itemB.status === 'pending' && Array.isArray(itemB.photos) && itemB.photos.length === 0, `B pending without photos (${itemB?.status})`)
    const onePerPage = await ava$('/me/reviews?per_page=1')
    log(onePerPage.status === 200 && onePerPage.body?.data?.length === 1 && onePerPage.body?.meta?.total >= 2 && onePerPage.body?.data?.[0]?.id === made.reviewB, `paginated, newest first: per_page=1 gives B first (total ${onePerPage.body?.meta?.total})`)
    const direct = await fetch(`${LARAVEL_URL}/api/v1/me/reviews/${made.reviewA}/photos/${made.photoIds[0]}`, { headers: { Authorization: `Bearer ${avaToken}` } })
    await direct.arrayBuffer().catch(() => null)
    log(direct.status === 200 && /no-store/.test(direct.headers.get('cache-control') ?? '') && /^image\//.test(direct.headers.get('content-type') ?? ''), `API: Ava's own photo of a pending review: ${direct.status} ${direct.headers.get('content-type')}, ${direct.headers.get('cache-control')}`)
    const staff = await api('/api/v1/me/reviews', { token: owner })
    log([401, 403].includes(staff.status), `a staff token is refused on me/reviews (${staff.status})`)

    // The page: both waiting, A's thumbnails through the owner address
    const page = await myReviews()
    const cardA = cardOf(page, product1Name)
    const cardB = cardOf(page, product2Name)
    await cardA.waitFor({ timeout: 15000 }).catch(() => {})
    log((await cardA.count()) === 1 && (await cardB.count()) === 1, 'My reviews lists A and B (each with "Delete your review of {product}")')
    log((await visible(badge(cardA, 'Waiting for approval'))) && (await visible(badge(cardB, 'Waiting for approval'))), 'both are "Waiting for approval"')
    log((await stars(cardA, 4)) && (await stars(cardB, 3)), 'the stars are named "4 out of 5 stars" / "3 out of 5 stars"')
    log((await visible(cardA.getByText(textA))) && (await visible(cardA.getByText('Lovely lamp'))), "A's card shows its title and text")
    const productLink = cardA.getByRole('link', { name: product1Name, exact: true })
    log((await productLink.count()) >= 1 && new RegExp(`/products/${product1}$`).test((await productLink.first().getAttribute('href')) ?? ''), `the product name links to its page (${await productLink.first().getAttribute('href').catch(() => null)})`)
    const images = ownerImages(cardA)
    const sources = await images.evaluateAll((elements) => elements.map((element) => new URL(element.src).pathname))
    const widths = await naturalWidths(images)
    log(sources.length === 2 && sources.every((source) => OWNER_URL.test(source)) && widths.every((width) => width > 0), `A's 2 thumbnails load through the owner address (${sources.join(', ')}; widths ${widths.join(', ')})`)
    log((await ownerImages(cardB).count()) === 0, 'B has no thumbnails')

    const mine = await ownerPhoto(page, made.ownerUrls[0])
    log(
      mine.status === 200 && /^image\/(jpeg|png|webp)/.test(mine.type) && /no-store/.test(mine.cache) && /private/.test(mine.cache) && mine.nosniff === 'nosniff' && /sandbox/.test(mine.csp),
      `the owner address answers Ava ${mine.status} ${mine.type}, "${mine.cache}", nosniff, sandbox CSP`,
    )
    const listAnswer = await page.request.get(`${BASE}/api/shop/me/reviews?productId=${product1}`, { failOnStatusCode: false })
    const list = await listAnswer.json().catch(() => null)
    const allowed = new Set(['id', 'status', 'rating', 'title', 'comment', 'date', 'verifiedPurchase', 'product', 'photos'])
    const first = list?.reviews?.[0] ?? {}
    log(
      listAnswer.status() === 200 && list?.reviews?.length === 1 && Object.keys(first).every((key) => allowed.has(key)) &&
        Object.keys(first.product ?? {}).every((key) => ['id', 'name', 'thumbnail', 'available'].includes(key)) &&
        (first.photos ?? []).every((photo) => Object.keys(photo).every((key) => ['id', 'url', 'width', 'height', 'hidden'].includes(key)) && OWNER_URL.test(photo.url)) &&
        typeof list.page === 'number' && typeof list.pages === 'number' && typeof list.total === 'number',
      `the storefront's list answer is allow-listed ({ reviews, page, pages, total }; review keys ${Object.keys(first).join(', ')})`,
    )
    await axe(page, 'My reviews with two pending reviews and photos')

    // Nobody else: a visitor 401, Ben 404, and the API refuses Ben's DELETE with 404
    const visitor = await newPage()
    const anonymous = await ownerPhoto(visitor, made.ownerUrls[0])
    log(anonymous.status === 401, `without a session the owner address answers ${anonymous.status} (401 expected)`)
    await visitor.context().close()
    const ben = await signedIn(SHOPPER_2)
    const asBen = await ownerPhoto(ben, made.ownerUrls[0])
    log(asBen.status === 404, `Ben, signed in, gets ${asBen.status} for A's photo address (404, not 403)`)
    await ben.context().close()
    const benPhoto = await ben$(`/me/reviews/${made.reviewA}/photos/${made.photoIds[0]}`)
    const benDeletesPhoto = await ben$(`/me/reviews/${made.reviewA}/photos/${made.photoIds[1]}`, { method: 'DELETE' })
    const benDeletes = await ben$(`/me/reviews/${made.reviewA}`, { method: 'DELETE' })
    log(benPhoto.status === 404 && benDeletesPhoto.status === 404 && benDeletes.status === 404, `API to Ben: photo ${benPhoto.status}, DELETE photo ${benDeletesPhoto.status}, DELETE review ${benDeletes.status} (all 404)`)
    const benList = (await ben$(`/me/reviews?product_id=${product1}`)).body?.data ?? null
    const stillThere = await avasReviewsOf(product1)
    log(Array.isArray(benList) && benList.length === 0 && stillThere[0]?.photos?.length === 2, "Ben's list has none of Ava's reviews, and A still has both photos")
    await page.context().close()
  })

  // ---------- 3. Product 1's page: "already reviewed" instead of the form ----------
  await part('already reviewed', async () => {
    const page = await signedIn(SHOPPER, `/products/${product1}`)
    const reviews = page.locator('#reviews')
    const already = reviews.getByText(/You.ve already reviewed this product/)
    log(await visible(already), 'product 1\'s page: "You\'ve already reviewed this product."')
    const link = reviews.getByRole('link', { name: /My reviews/ })
    log((await link.count()) >= 1 && (await link.first().getAttribute('href')) === '/account/reviews', `with a link to My reviews (${await link.first().getAttribute('href').catch(() => null)})`)
    log(await visible(reviews.getByText('Waiting for approval', { exact: true })), 'and the status badge "Waiting for approval"')
    log((await page.locator('form.review-form').count()) === 0, 'the review form is not shown')
    await page.context().close()
  })

  // ---------- 4. Staff approve A, reject B, hide A's photo 2 ----------
  await part('after moderation', async () => {
    if (!made.reviewA || !made.reviewB || made.photoIds.length !== 2) throw new Error('reviews A / B were not written')
    const approved = await admin$(`/reviews/${made.reviewA}`, { method: 'PATCH', body: { status: 'approved' } })
    const rejected = await admin$(`/reviews/${made.reviewB}`, { method: 'PATCH', body: { status: 'rejected' } })
    const hidden = await admin$(`/reviews/${made.reviewA}/photos/${made.photoIds[1]}`, { method: 'PATCH', body: { hidden: true } })
    log(approved.status === 200 && rejected.status === 200 && hidden.status === 200, `staff approve A (${approved.status}), reject B (${rejected.status}), hide A's photo 2 (${hidden.status})`)
    const detail = await publicProduct(product1)
    const publicA = detail?.reviews?.find((row) => row.comment === textA)
    made.publicUrl = publicA?.photos?.[0]?.url ?? null
    log(detail?.review_count === 1 && publicA?.photos?.length === 1 && PUBLIC_URL.test(made.publicUrl ?? ''), `the store lists A with 1 public photo (review_count ${detail?.review_count}, ${made.publicUrl})`)

    const [itemA] = await avasReviewsOf(product1)
    log(itemA?.status === 'approved' && itemA.photos?.length === 2 && itemA.photos.find((photo) => photo.id === made.photoIds[1])?.hidden === true, "Ava's API still lists the hidden photo, with hidden: true")

    const page = await myReviews()
    const cardA = cardOf(page, product1Name)
    const cardB = cardOf(page, product2Name)
    await cardA.waitFor({ timeout: 15000 }).catch(() => {})
    log(await visible(badge(cardA, 'Published')), 'A is "Published"')
    log(await visible(badge(cardB, 'Not published')), 'B is "Not published"')
    log((await ownerImages(cardA).count()) === 2 && (await cardA.getByText('Hidden by the shop', { exact: true }).count()) === 1, `A shows both photos to Ava, one labelled "Hidden by the shop" (${await ownerImages(cardA).count()} thumbnails)`)
    const hiddenPhoto = await ownerPhoto(page, made.ownerUrls[1])
    log(hiddenPhoto.status === 200 && /no-store/.test(hiddenPhoto.cache), `the hidden photo's owner address still answers Ava ${hiddenPhoto.status}`)
    log((await cardA.getByRole('button', { name: `Delete photo 2 of your review of ${product1Name}`, exact: true }).count()) === 1, `each photo has "Delete photo N of your review of {product}"`)

    // The phase 22 viewer opens from a thumbnail
    const thumb = cardA.locator('button').filter({ has: page.locator('img[src*="/api/shop/me/reviews/"]') }).first()
    await thumb.click()
    const viewer = dialogWith(page, /Photo \d+ of \d+/)
    log(await visible(viewer.getByText(/^Photo 1 of 2$/)), 'a thumbnail opens the photo viewer ("Photo 1 of 2")')
    await page.keyboard.press('Escape')
    await viewer.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    log(!(await viewer.first().isVisible().catch(() => false)), 'Escape closes the viewer')
    await fits(page, 'My reviews with photos')
    await axe(page, 'My reviews: published, hidden photo, not published')
    await page.context().close()
  })

  // ---------- 9. The data export (here, while A still has both photos) ----------
  await part('export', async () => {
    const exported = await ava$('/me/export')
    if (exported.status === 429) throw new Error(`the data export allows 3 a customer an hour: wait ${exported.headers.get('retry-after') ?? '?'} s and run again`)
    const rowA = exported.body?.reviews?.find((row) => row.comment === textA)
    const rowB = exported.body?.reviews?.find((row) => row.comment === textB)
    const keys = (rowA?.photos ?? []).map((photo) => Object.keys(photo).sort().join(','))
    log(
      exported.status === 200 && rowA?.photos?.length === 2 && keys.every((key) => key === 'added_at,height,hidden,width') && rowA.photos.map((photo) => photo.hidden).join() === 'false,true' && Array.isArray(rowB?.photos) && rowB.photos.length === 0,
      `export: A's photos are { width, height, hidden, added_at } (no file, no address), B's photos [] (${exported.status}, ${JSON.stringify(rowA?.photos)})`,
    )
    log(/My reviews/.test(exported.body?.photos_note ?? ''), `export: photos_note "${exported.body?.photos_note}"`)
  })

  // ---------- 5. Ava deletes A's photo 2 ----------
  await part('delete a photo', async () => {
    const page = await myReviews()
    const cardA = cardOf(page, product1Name)
    await cardA.waitFor({ timeout: 15000 })
    const deletePhoto2 = cardA.getByRole('button', { name: `Delete photo 2 of your review of ${product1Name}`, exact: true })
    await deletePhoto2.click()
    const dialog = dialogWith(page, 'Delete this photo?')
    log(await visible(dialog), 'the dialog asks "Delete this photo?"')
    log((await dialog.getByRole('button', { name: 'Delete photo', exact: true }).count()) === 1 && (await dialog.getByRole('button', { name: 'Keep it', exact: true }).count()) === 1, 'with "Delete photo" and "Keep it"')
    await axe(page, 'My reviews with "Delete this photo?" open')
    await dialog.getByRole('button', { name: 'Keep it', exact: true }).click()
    await dialog.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    log(!(await dialog.first().isVisible().catch(() => false)) && (await ownerImages(cardA).count()) === 2 && (await avasReviewsOf(product1))[0]?.photos?.length === 2, '"Keep it" closes the dialog and changes nothing (2 photos)')

    await deletePhoto2.click()
    await dialog.first().waitFor({ timeout: 5000 })
    const answer = page.waitForResponse((response) => /^\/api\/shop\/me\/reviews\/\d+\/photos\/\d+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null)
    await dialog.getByRole('button', { name: 'Delete photo', exact: true }).click()
    log((await answer)?.status() === 200, `"Delete photo" calls DELETE /api/shop/me/reviews/{id}/photos/{photoId} (${(await answer)?.status()})`)
    log(await visible(notice(page, 'The photo was deleted.')), '"The photo was deleted."')
    await cardA.locator(`img[src$="${made.ownerUrls[1]}"]`).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    log((await ownerImages(cardA).count()) === 1 && (await cardA.getByText('Hidden by the shop', { exact: true }).count()) === 0, `1 photo left, no "Hidden by the shop" (${await ownerImages(cardA).count()} thumbnails)`)
    log(!(await page.evaluate(() => document.activeElement === document.body)), 'focus is not lost to the page body')
    const [itemA] = await avasReviewsOf(product1)
    log(itemA?.status === 'approved' && itemA.photos?.length === 1 && itemA.photos[0].id === made.photoIds[0] && itemA.photos[0].position === 0, `API: 1 photo at position 0, the review still approved (${itemA?.status})`)
    const gone = await ownerPhoto(page, made.ownerUrls[1])
    log(gone.status === 404, `the deleted photo's owner address answers ${gone.status}`)
    const audit = (await admin$(`/audit?action=${encodeURIComponent('review.photo_deleted_by_customer')}&per_page=20`)).body?.data ?? []
    log(audit.some((entry) => entry.action === 'review.photo_deleted_by_customer' && JSON.stringify(entry).includes(String(made.reviewA))), `audited as review.photo_deleted_by_customer (${audit.length} entries)`)
    await page.context().close()
  })

  // ---------- 6. Ava deletes review A ----------
  await part('delete a review', async () => {
    const before = await publicProduct(product1)
    const publicBefore = made.publicUrl ? await publicPhoto(made.publicUrl) : 0
    log(before?.review_count === 1 && publicBefore === 200, `before: the store counts 1 review and A's photo is public (${before?.review_count}, ${publicBefore})`)

    const page = await myReviews()
    const cardA = cardOf(page, product1Name)
    await cardA.waitFor({ timeout: 15000 })
    await cardA.getByRole('button', { name: `Delete your review of ${product1Name}`, exact: true }).click()
    const dialog = dialogWith(page, 'Delete your review?')
    log(await visible(dialog), 'the dialog asks "Delete your review?"')
    log(
      await visible(dialog.getByText(new RegExp(`^Your review of ${escapeRegExp(product1Name)} will be removed from the store\\. This can.t be undone\\.$`))),
      `"Your review of ${product1Name} will be removed from the store. This can't be undone."`,
    )
    log((await dialog.getByRole('button', { name: 'Delete review', exact: true }).count()) === 1 && (await dialog.getByRole('button', { name: 'Keep it', exact: true }).count()) === 1, 'with "Delete review" and "Keep it"')
    const answer = page.waitForResponse((response) => /^\/api\/shop\/me\/reviews\/\d+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null)
    await dialog.getByRole('button', { name: 'Delete review', exact: true }).click()
    log((await answer)?.status() === 200, `"Delete review" calls DELETE /api/shop/me/reviews/{id} (${(await answer)?.status()})`)
    log(await visible(notice(page, 'Your review was deleted.')), '"Your review was deleted."')
    await cardA.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    log((await page.getByRole('button', { name: `Delete your review of ${product1Name}`, exact: true }).count()) === 0, "A's card is gone")
    await page.waitForTimeout(300)
    const heading = await focusedHeading(page)
    log(heading !== null, `focus moves to a heading (the next card's or the page's): "${heading}"`)
    log((await cardOf(page, product2Name).count()) === 1, 'B is still listed')
    await page.context().close()

    const detail = await publicProduct(product1)
    log(!detail?.reviews?.some((row) => row.comment === textA) && detail?.review_count === 0, `the store no longer has A (review_count ${detail?.review_count}, was 1)`)
    const visitor = await newPage()
    await visitor.goto(`${BASE}/products/${product1}`, { waitUntil: 'networkidle' })
    await visitor.locator('#reviews').waitFor({ timeout: 15000 }).catch(() => {})
    log((await visitor.locator('#reviews').getByText(textA).count()) === 0, "product 1's public page no longer lists A")
    await visitor.context().close()
    const publicAfter = made.publicUrl ? await publicPhoto(made.publicUrl) : 0
    log(publicAfter === 404, `the remaining photo's public URL answers ${publicAfter}`)
    const ownerAfter = await ava$(`/me/reviews/${made.reviewA}/photos/${made.photoIds[0]}`)
    log(ownerAfter.status === 404, `and its owner address (API) ${ownerAfter.status}`)
    const audit = (await admin$(`/audit?action=${encodeURIComponent('review.deleted_by_customer')}&per_page=20`)).body?.data ?? []
    log(audit.some((entry) => entry.action === 'review.deleted_by_customer' && JSON.stringify(entry).includes(String(made.reviewA))), `audited as review.deleted_by_customer (${audit.length} entries)`)
  })

  // ---------- 7. The form is back; a new review waits ----------
  await part('write again', async () => {
    const page = await signedIn(SHOPPER, `/products/${product1}`)
    const form = page.locator('form.review-form')
    log(await visible(form), "product 1's page shows the review form again")
    log((await page.locator('#reviews').getByText(/You.ve already reviewed this product/).count()) === 0, 'without "You\'ve already reviewed this product"')
    await form.locator('label[for$="-rating-5"]').click()
    await form.getByLabel('Your review').fill(textC)
    const answer = page.waitForResponse((response) => /^\/api\/shop\/products\/\d+\/reviews$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST', { timeout: 30000 })
    await form.getByRole('button', { name: 'Submit review' }).click()
    const response = await answer
    log(response.status() === 201, `a new review (no photos) is accepted (${response.status()})`)
    await page.context().close()

    const list = await myReviews()
    const card = cardOf(list, product1Name)
    await card.waitFor({ timeout: 15000 }).catch(() => {})
    log((await visible(card.getByText(textC))) && (await visible(badge(card, 'Waiting for approval'))), 'My reviews: the new review is "Waiting for approval"')
    await list.context().close()
  })

  // ---------- 8. 390px and the "Delete your review?" dialog; Bangla ----------
  await part('390px and dialog', async () => {
    const page = await myReviews()
    await cardOf(page, product2Name).waitFor({ timeout: 15000 })
    await fits(page, 'My reviews')
    await cardOf(page, product2Name).getByRole('button', { name: `Delete your review of ${product2Name}`, exact: true }).click()
    const dialog = dialogWith(page, 'Delete your review?')
    await dialog.first().waitFor({ timeout: 5000 })
    await axe(page, 'My reviews with "Delete your review?" open')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const overflow = await sidewaysOverflow(page)
    const box = await dialog.first().boundingBox()
    log(overflow <= 0 && box && box.x >= 0 && box.x + box.width <= 391, `390px with the dialog open: no sideways scroll (${overflow}px), the dialog fits`)
    await page.setViewportSize({ width: 1280, height: 900 })
    await dialog.getByRole('button', { name: 'Keep it', exact: true }).click()
    await dialog.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    log((await cardOf(page, product2Name).count()) === 1 && (await avasReviewsOf(product2)).length === 1, '"Keep it": B stays')
    await page.context().close()
  })

  await part('Bangla', async () => {
    const page = await myReviews({ lang: 'bn' })
    const heading = banglaFor('My reviews')
    const waiting = banglaFor('Waiting for approval')
    const notPublished = banglaFor('Not published')
    const headings = (await page.getByRole('heading').allInnerTexts()).map((text) => text.trim())
    log(
      heading.length > 0 ? headings.some((text) => heading.includes(text)) : headings.some((text) => BENGALI.test(text)) && !headings.includes('My reviews'),
      `the page heading is in Bangla (${heading.join(' / ') || 'not found in the locale files'}; headings: ${headings.join(' | ')})`,
    )
    const card = (name) => page.locator('article, li').filter({ hasText: name }).first()
    await card(product2Name).waitFor({ timeout: 15000 }).catch(() => {})
    const textB2 = (await card(product2Name).innerText().catch(() => '')).replace(/\s+/g, ' ')
    const textA2 = (await card(product1Name).innerText().catch(() => '')).replace(/\s+/g, ' ')
    log(
      (notPublished.length > 0 ? notPublished.some((word) => textB2.includes(word)) : BENGALI.test(textB2)) && !/Not published/.test(textB2),
      `B's badge is in Bangla (${notPublished.join(' / ') || 'not found in the locale files'})`,
    )
    log(
      (waiting.length > 0 ? waiting.some((word) => textA2.includes(word)) : BENGALI.test(textA2)) && !/Waiting for approval/.test(textA2),
      `the new review's badge is in Bangla (${waiting.join(' / ') || 'not found in the locale files'})`,
    )
    await axe(page, 'My reviews in Bangla')
    await page.context().close()
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
  await attempt('reviews', async () => {
    // Every review on the suite's products (their photo files go with them, after the transaction commits).
    for (const row of await reviewsOfRun()) {
      const deleted = await admin$(`/reviews/${row.id}`, { method: 'DELETE' })
      if (![200, 204].includes(deleted.status)) throw new Error(`DELETE review ${row.id} answered ${deleted.status}`)
    }
  })
  await attempt('products', async () => {
    for (const id of made.productIds) {
      // Parked as a Draft first, like catalog.mjs.
      await admin$(`/products/${id}`, { method: 'PATCH', body: { status: 'draft' } })
      const deleted = await admin$(`/products/${id}`, { method: 'DELETE' })
      if (![200, 204].includes(deleted.status)) throw new Error(`DELETE product ${id} answered ${deleted.status}`)
    }
  })
  await attempt('catalog settings', async () => {
    if (!savedCatalog) return
    const answer = await admin$('/settings', { method: 'PATCH', body: { catalog: savedCatalog } })
    if (answer.status !== 200) throw new Error(`PATCH settings answered ${answer.status}`)
  })
  // Saved carts, and Ava's language (the Bangla part saved bn to her account).
  await attempt('saved carts and language', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })

  const catalog = (await admin$('/settings')).body?.data?.catalog
  const leftReviews = (await reviewsOfRun()).length
  const leftProducts = ((await admin$(`/products?search=${encodeURIComponent(marker)}`)).body?.data ?? []).length
  const settingsBack = JSON.stringify(catalog) === JSON.stringify(savedCatalog)
  log(
    problems.length === 0 && settingsBack && leftReviews === 0 && leftProducts === 0,
    `cleanup: the suite's reviews and both products removed, Settings → Catalog as before${problems.length || !settingsBack || leftReviews || leftProducts ? ` — left: ${[...problems, `catalog ${JSON.stringify(catalog)}`, `${leftReviews} reviews`, `${leftProducts} products`].join('; ')}` : ''}`,
  )
}
