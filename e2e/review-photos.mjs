// Phase 22 in a real browser: product reviews with photos (docs/backend/PHASE22_CONTRACT.md §4).
//
// Runs against the usual servers (the store on :5173, the API on :8000). Needs the BuyNest API (E2E_ACCOUNTS=laravel)
// and its test inbox (the throwaway customer's sign-up code). Nothing reaches an outside service.
//
// Checks: with the setting off the review form has no photo field and the API refuses photos (photos_disabled);
// Settings → Catalog "Customers can add photos to reviews" ticked through the admin, with "New reviews wait for
// approval" off, so a review without photos is published straight away and one with photos still waits (Q2);
// Ava's review form: the photo field and hint, 4 photos refused ("up to 3"), a text file named .jpg refused in the
// browser, 3 previews and "Remove photo 3", sent as multipart with 2 photos, the pending message mentions the photo
// check; the photos stay private while pending (public 404, staff 200 never cached); admin Reviews with the
// "With photos" filter: 2 thumbnails that load, Approve, "Hide photo 2" → "Hidden from the store"; the store shows 1
// thumbnail, the viewer ("Photo 1 of 1", Escape returns focus), "With photos (1)" filters out the review without
// photos, the hidden photo's URL 404s and the visible one is 200 with a 5-minute cache and no Exif / GPS bytes;
// Bangla texts; "Show photo 2" brings it back (API answer, 2 thumbnails, Next / Previous in the viewer); axe and 390px.
//
// The photos are made here: PNGs and a JPEG from page.screenshot() of coloured boxes, the JPEG with an EXIF APP1
// segment (an ImageDescription and a GPS block) spliced in after SOI, and a text file named .jpg.
//
// Put back or removed (in finally, even on failure): catalog.reviews_require_approval and catalog.review_photos_enabled
// as read at the start, both reviews (their photo files go with them; the deleted photo URLs are then checked to 404),
// the suite's product, the throwaway customer (signed up through the API, code from the test inbox) and the demo
// accounts' saved carts and language. Ava (customer@buynest.test) only writes a review on the suite's own product.
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
  overflowCulprits,
  reporter,
  sidewaysOverflow,
  storefrontSignIn,
  visible,
  watchErrors,
} from './lib.mjs'

const report = reporter('review-photos: photos on reviews, private until approved, hide / show, viewer, filter, metadata removed')
const { log } = report
if (!LARAVEL) {
  console.log('(Skipped: needs the BuyNest API, E2E_ACCOUNTS=laravel)')
  report.done()
  process.exit(0)
}

const run = Date.now().toString(36)
const marker = `e2e${run}`
const productName = `E2E Photo Kurta ${marker}`
const avaText = `The colour is exactly as in the photos, ${marker}.`
const otherText = `Sturdy and well stitched, no photos needed, ${marker}.`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const BENGALI = /[ঀ-৿]/
const PHOTO_URL = /\/media\/reviews\/[a-f0-9]{32}\.(?:jpg|png|webp)/g

const api = async (path, { method = 'GET', token, body, form } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(!form && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
      body: form ?? (body && JSON.stringify(body)),
    })
    // A busy run can hit the API's per-minute limit: wait as asked, then retry.
    if (response.status === 429 && attempt < 4) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}

/** A review photo through the store's own address (/media/reviews/<name>), as the browser gets it. */
const storePhoto = async (name, { base = BASE, prefix = '/media/reviews/' } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${base}${prefix}${name}`)
    if (response.status === 429 && attempt < 4) {
      await sleep((Number(response.headers.get('retry-after')) || 5) * 1000)
      continue
    }
    return {
      status: response.status,
      type: response.headers.get('content-type') ?? '',
      cache: response.headers.get('cache-control') ?? '',
      nosniff: response.headers.get('x-content-type-options') ?? '',
      bytes: Buffer.from(await response.arrayBuffer()),
    }
  }
}
const apiPhoto = (name) => storePhoto(name, { base: LARAVEL_URL, prefix: '/api/v1/review-photos/' })

// The throwaway customer: writes the review without photos (and tries photos while they are off).
const rumi = { firstName: 'Rumi', lastName: `Photoless${run}`, email: `review-photos.${run}@example.com`, password: 'ReviewPhotos2026', phone: '+1 555 010 4588' }
const made = { productId: null, customerId: null, photoNames: [] }
const errors = []
let owner = null
let browser = null
let savedCatalog = null // Settings → Catalog before the suite
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const reviewsOfRun = async (extra = '') => (await admin$(`/reviews?search=${encodeURIComponent(marker)}&per_page=50${extra}`)).body?.data ?? []
const publicProduct = async () => (await api(`/api/v1/products/${made.productId}`)).body?.data

try {
  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  savedCatalog = (await admin$('/settings')).body?.data?.catalog ?? null
  if (!savedCatalog || !('review_photos_enabled' in savedCatalog)) throw new Error(`the API has no catalog.review_photos_enabled setting (phase 22 not migrated?): ${JSON.stringify(savedCatalog)}`)
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
/**
 * A small big-endian TIFF (the inside of an EXIF APP1 segment): IFD0 with an ImageDescription that spells out a
 * position ("GPS 23.8103 N, 90.4125 E") and a GPSInfo pointer to a GPS IFD (version, latitude and longitude refs).
 */
function exifTiff() {
  const description = Buffer.from('GPS 23.8103 N, 90.4125 E (BuyNest review-photos fixture)\0', 'latin1')
  const entry = (tag, type, count, value) => {
    const bytes = Buffer.alloc(12)
    bytes.writeUInt16BE(tag, 0)
    bytes.writeUInt16BE(type, 2)
    bytes.writeUInt32BE(count, 4)
    if (Buffer.isBuffer(value)) value.copy(bytes, 8)
    else bytes.writeUInt32BE(value, 8)
    return bytes
  }
  const ifd = (entries) => {
    const count = Buffer.alloc(2)
    count.writeUInt16BE(entries.length)
    return Buffer.concat([count, ...entries, Buffer.alloc(4)]) // next IFD: none
  }
  const ifd0Size = 2 + 2 * 12 + 4
  const descriptionAt = 8 + ifd0Size
  let gpsAt = descriptionAt + description.length
  if (gpsAt % 2) gpsAt++
  const header = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]) // "MM", 42, IFD0 at 8
  const ifd0 = ifd([entry(0x010e, 2, description.length, descriptionAt), entry(0x8825, 4, 1, gpsAt)])
  const gps = ifd([
    entry(0x0000, 1, 4, Buffer.from([2, 2, 0, 0])), // GPSVersionID
    entry(0x0001, 2, 2, Buffer.from('N\0\0\0', 'latin1')), // GPSLatitudeRef
    entry(0x0003, 2, 2, Buffer.from('E\0\0\0', 'latin1')), // GPSLongitudeRef
  ])
  return Buffer.concat([header, ifd0, description, Buffer.alloc(gpsAt - descriptionAt - description.length), gps])
}

/** The JPEG with an APP1 "Exif" segment spliced in right after SOI (FF D8). */
function withGpsExif(jpeg) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('the screenshot is not a JPEG')
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifTiff()])
  const marker = Buffer.alloc(4)
  marker.writeUInt16BE(0xffe1, 0)
  marker.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)])
}

async function makePhotos() {
  const context = await browser.newContext({ viewport: { width: 2000, height: 1200 } })
  const page = await context.newPage()
  const box = async (width, height, colours, type) => {
    await page.setContent(
      `<body style="margin:0"><div id="box" style="width:${width}px;height:${height}px;background:linear-gradient(135deg, ${colours.join(', ')})"></div></body>`,
    )
    return page.locator('#box').screenshot(type === 'jpeg' ? { type: 'jpeg', quality: 90 } : { type: 'png' })
  }
  const photos = {
    // 2000 px wide: bigger than the 1600 px the store keeps, so the shrinking shows in the answer's width.
    gps: { name: 'market-day.jpg', mimeType: 'image/jpeg', buffer: withGpsExif(await box(2000, 1200, ['#047857', '#f97316', '#fde68a'], 'jpeg')) },
    green: { name: 'kurta-front.png', mimeType: 'image/png', buffer: await box(900, 600, ['#065f46', '#a7f3d0']) },
    orange: { name: 'kurta-sleeve.png', mimeType: 'image/png', buffer: await box(600, 900, ['#c2410c', '#fed7aa']) },
    blue: { name: 'kurta-label.png', mimeType: 'image/png', buffer: await box(500, 500, ['#1e3a8a', '#bfdbfe']) },
    // A text file named .jpg: the browser calls it image/jpeg (from the name), but it is not a photo.
    text: { name: 'not-a-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('Hello, this is plain text pretending to be a JPEG photo.\n') },
  }
  await context.close()
  if (!photos.gps.buffer.includes('Exif') || !photos.gps.buffer.includes('GPS')) throw new Error('the GPS fixture has no Exif / GPS bytes')
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
  async function newPage(viewport = { width: 1280, height: 900 }, lang = null) {
    const context = await browser.newContext({ viewport, bypassCSP: true })
    context.setDefaultTimeout(15000)
    if (lang) await context.addCookies([{ name: 'buynest_lang', value: lang, url: BASE }])
    return watchErrors(await context.newPage(), errors)
  }
  async function adminPage() {
    const admin = await newPage({ width: 1440, height: 900 })
    await adminSignIn(admin, ADMIN_USER)
    await admin.getByRole('heading', { name: 'Overview' }).waitFor()
    return admin
  }
  /** Ava, signed in (English sign-in page), on the suite's product. A fresh browser each time: the store info is cached for a minute. */
  async function avaOnProduct(lang = null) {
    // After sign-in the account's language wins over the cookie (phase 13: the account took English at sign-in),
    // so Bangla is chosen with the header switch, as a shopper would. Clean-up resets Ava's language.
    const page = await newPage()
    await storefrontSignIn(page, SHOPPER)
    if (lang === 'bn') {
      await page.locator('.site-header').getByRole('button', { name: 'বাংলা', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.lang === 'bn', null, { timeout: 15000 })
    }
    await page.goto(`${BASE}/products/${made.productId}`, { waitUntil: 'networkidle' })
    return page
  }
  /** A visitor in a fresh browser (the product's answers may be cached for a minute in one browser). */
  async function visitorOnProduct(viewport) {
    const page = await newPage(viewport)
    await page.goto(`${BASE}/products/${made.productId}`, { waitUntil: 'networkidle' })
    await page.locator('#reviews').waitFor({ timeout: 15000 }).catch(() => {})
    return page
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
  const previews = (form) => form.getByRole('button', { name: /^Remove photo \d+$/ })
  async function clearPreviews(form) {
    for (let guard = 0; guard < 6 && (await previews(form).count()) > 0; guard++) await previews(form).first().click()
  }
  /** The text around the file input (its label, button and hint): the nearest wrapper that has any text, inside the form. */
  const photoField = (form) =>
    form.locator('input[type="file"]').evaluate((input) => {
      let box = input.parentElement
      while (box && box.tagName !== 'FORM' && box.innerText.trim() === '') box = box.parentElement
      return box?.tagName === 'FORM' ? '' : (box?.innerText ?? '')
    })
  /** Reviews in the list that are actually shown (a filter may hide them rather than remove them). */
  const shownReviews = (page, text) => page.locator('#reviews li').filter({ hasText: text }).filter({ visible: true }).count()
  const thumbsOf = (item) => item.getByRole('button', { name: /^Open photo \d+ of \d+ from / })
  const viewerOf = (page) => page.getByRole('dialog').filter({ hasText: /Photo \d+ of \d+/ })
  const filterButton = (page) => page.getByRole('button', { name: /^With photos \(\d+\)$/ })

  const photos = await makePhotos()

  // ---------- 0. The suite's product and the throwaway customer ----------
  if (savedCatalog.review_photos_enabled !== false) await admin$('/settings', { method: 'PATCH', body: { catalog: { review_photos_enabled: false } } })
  const created = await admin$('/products', {
    method: 'POST',
    body: { name: productName, category: 'home-decoration', price: 25, stock_quantity: 40, status: 'active', sku: `E2E-RPH-${run}`.toUpperCase(), brand: 'NestWorks', weight: 400 },
  })
  made.productId = created.body?.data?.id ?? null
  log(created.status === 201 && Boolean(made.productId), `the suite's own product (#${made.productId})`)
  if (!made.productId) throw new Error(`the test product could not be made (${created.status} ${JSON.stringify(created.body?.errors ?? created.body?.message)})`)

  const registered = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { first_name: rumi.firstName, last_name: rumi.lastName, email: rumi.email, phone: rumi.phone, password: rumi.password, password_confirmation: rumi.password, accept_terms: true },
  })
  const verified = registered.status === 201 ? await api('/api/v1/auth/verify-email', { method: 'POST', body: { email: rumi.email, code: (await latestCode(rumi.email)).code } }) : registered
  made.customerId = ((await admin$(`/customers?search=${encodeURIComponent(rumi.email)}`)).body?.data ?? []).find((row) => row.email === rumi.email)?.id ?? null
  const rumiToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: rumi.email, password: rumi.password } })).body?.data?.tokens?.access_token
  log(verified.status === 200 && Boolean(made.customerId) && Boolean(rumiToken), `a throwaway customer signed up and confirmed (${rumi.email}, #${made.customerId})`)

  // ---------- 1. Setting off: no photo field, photos refused ----------
  await part('setting off', async () => {
    const store = (await api('/api/v1/store')).body?.data?.review_photos
    log(store?.enabled === false && store.max === 3 && store.max_megabytes === 5, `store info while off: review_photos ${JSON.stringify(store)}`)
    if (rumiToken) {
      const form = new FormData()
      form.append('rating', '5')
      form.append('comment', otherText)
      form.append('photos[]', new Blob([photos.green.buffer], { type: 'image/png' }), photos.green.name)
      const refused = await api(`/api/v1/products/${made.productId}/reviews`, { method: 'POST', token: rumiToken, form })
      log(
        refused.status === 422 && refused.body?.code === 'photos_disabled' && /Photos can.t be added to reviews\./.test(refused.body?.errors?.photos?.[0] ?? ''),
        `photos sent while off: ${refused.status} ${refused.body?.code} ("${refused.body?.errors?.photos?.[0]}")`,
      )
    }
    const shop = await avaOnProduct()
    const form = shop.locator('form.review-form')
    log(await visible(form), "Ava sees the review form on the suite's product")
    log((await form.locator('input[type="file"]').count()) === 0 && (await form.getByText(/Add photos/).count()) === 0, 'while the setting is off the form has no photo field')
    await shop.context().close()
  })

  // ---------- 2. Admin ticks the setting (Settings → Catalog); reviews publish straight away ----------
  await part('settings', async () => {
    const admin = await adminPage()
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    const form = admin.getByRole('form', { name: 'Catalog' })
    await form.waitFor()
    const photosBox = form.getByLabel('Customers can add photos to reviews')
    log(await visible(photosBox), 'Settings → Catalog: "Customers can add photos to reviews"')
    log(await visible(form.getByText('Reviews with photos always wait for approval. Photos are shrunk and their location data is removed.')), 'with its help text (photos always wait, shrunk, location removed)')
    await photosBox.check()
    await form.getByLabel('New reviews wait for approval').uncheck()
    await axe(admin, 'admin Settings with the photo setting')
    await form.getByRole('button', { name: 'Save catalog' }).click()
    log(await visible(form.getByText('Catalog saved.')), '"Catalog saved."')
    const catalog = (await admin$('/settings')).body?.data?.catalog
    log(catalog?.review_photos_enabled === true && catalog.reviews_require_approval === false, `saved: review_photos_enabled ${catalog?.review_photos_enabled}, reviews_require_approval ${catalog?.reviews_require_approval}`)
    const store = (await api('/api/v1/store')).body?.data?.review_photos
    log(store?.enabled === true && store.max === 3 && store.max_megabytes === 5, `store info: review_photos ${JSON.stringify(store)}`)
    await admin.context().close()

    // A review without photos follows "New reviews wait for approval" (off): published straight away.
    if (rumiToken) {
      const plain = await api(`/api/v1/products/${made.productId}/reviews`, { method: 'POST', token: rumiToken, body: { rating: 5, title: 'Well made', comment: otherText } })
      log(plain.status === 201 && plain.body?.data?.status === 'approved', `a review without photos is published straight away (${plain.status} ${plain.body?.data?.status})`)
    }
  })

  // ---------- 3a. The photo field in Bangla (before Ava's review: afterwards the page says she already reviewed it, phase 23) ----------
  await part('Bangla photo field', async () => {
    const page = await avaOnProduct('bn')
    const form = page.locator('form.review-form')
    await form.waitFor()
    const field = await photoField(form).catch(() => '')
    log(BENGALI.test(field) && !/Add photos|Up to 3 photos/.test(field), `the photo field is in Bangla ("${field.replace(/\s+/g, ' ').trim().slice(0, 80)}")`)
    // Back to English for the next steps: the switch saved Bangla to Ava's account, which wins at her next sign-in.
    await page.locator('.site-header').getByRole('button', { name: 'English', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 15000 })
    await page.context().close()
  })

  // ---------- 3. Ava writes a 4-star review with photos ----------
  let avaShop = null
  await part("Ava's review with photos", async () => {
    avaShop = await avaOnProduct()
    const form = avaShop.locator('form.review-form')
    await form.waitFor()
    const input = form.locator('input[type="file"]')
    log(await visible(form.getByText(/^Add photos \(optional\)$/)), 'the photo field: "Add photos (optional)"')
    log(await visible(form.getByText('Up to 3 photos, JPEG, PNG or WebP, 5 MB each.')), 'with the hint "Up to 3 photos, JPEG, PNG or WebP, 5 MB each."')
    const attributes = await input.evaluate((element) => ({ accept: element.accept, multiple: element.multiple })).catch(() => ({}))
    log(attributes.accept === 'image/jpeg,image/png,image/webp' && attributes.multiple === true, `the file input takes several JPEG / PNG / WebP photos (${JSON.stringify(attributes)})`)

    // Four photos: one too many.
    await input.setInputFiles([photos.green, photos.orange, photos.blue, photos.gps])
    log(await visible(form.getByText(/You can add up to 3 photos\./)), '4 photos: "You can add up to 3 photos."')
    log((await previews(form).count()) <= 3, `and never more than 3 previews (${await previews(form).count()})`)
    await clearPreviews(form)

    // A text file named .jpg: refused before anything is sent.
    await input.setInputFiles([photos.text])
    log(await visible(form.getByText(/not-a-photo\.jpg isn.t a JPEG, PNG or WebP photo\./)), 'a text file named .jpg is refused in the browser ("… isn\'t a JPEG, PNG or WebP photo.")')
    log((await previews(form).count()) === 0, 'and gets no preview')

    // Three good photos → three previews; remove the third → two.
    await input.setInputFiles([photos.gps, photos.green, photos.orange])
    await previews(form).nth(2).waitFor({ timeout: 10000 }).catch(() => {})
    const named = await Promise.all([1, 2, 3].map((n) => form.getByRole('button', { name: `Remove photo ${n}`, exact: true }).count()))
    log((await previews(form).count()) === 3 && named.every((count) => count === 1), `3 photos: 3 previews, each with "Remove photo 1…3" (${await previews(form).count()} previews)`)
    const previewImages = form.locator('img[src^="blob:"]')
    const widths = await naturalWidths(previewImages)
    log(widths.length === 3 && widths.every((width) => width > 0), `the previews show the chosen photos (${widths.length} images, widths ${widths.join(', ')})`)
    await axe(avaShop, 'review form with 3 previews')
    await form.getByRole('button', { name: 'Remove photo 3' }).click()
    log((await previews(form).count()) === 2 && (await form.locator('img[src^="blob:"]').count()) === 2, '"Remove photo 3": 2 previews left')

    // Send: 4 stars, a title, the text. With photos the form sends multipart (FormData).
    await form.locator('label[for$="-rating-4"]').click()
    await form.getByLabel('Title (optional)').fill('True colours')
    await form.getByLabel('Your review').fill(avaText)
    const answer = avaShop.waitForResponse((response) => /^\/api\/shop\/products\/\d+\/reviews$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST', { timeout: 30000 })
    await form.getByRole('button', { name: 'Submit review' }).click()
    const response = await answer
    const contentType = response.request().headers()['content-type'] ?? ''
    const body = await response.json().catch(() => null)
    made.photoNames = [...new Set(JSON.stringify(body ?? {}).match(PHOTO_URL) ?? [])].map((url) => url.split('/').pop())
    log(contentType.startsWith('multipart/form-data'), `sent as multipart/form-data (${contentType.split(';')[0]})`)
    log(response.status() === 201 && made.photoNames.length === 2, `201 with 2 photo URLs (${response.status()}: ${made.photoNames.join(', ')})`)
    const pending = avaShop.getByRole('status').filter({ hasText: /will appear after approval/ })
    log(await visible(pending.filter({ hasText: 'Your photos will be checked first.' })), `the pending message mentions the photo check ("${(await pending.first().innerText().catch(() => '')).trim()}")`)
    await avaShop.context().close()
    avaShop = null
  })

  // ---------- 4. Pending: the photos are private ----------
  let review = null
  await part('pending photos', async () => {
    review = (await reviewsOfRun()).find((row) => row.comment === avaText) ?? null
    const photoRows = [...(review?.photos ?? [])].sort((a, b) => a.position - b.position)
    log(
      review?.status === 'pending' && photoRows.length === 2 && photoRows.every((photo) => photo.hidden === false && photo.width > 0 && photo.height > 0 && photo.size_bytes > 0),
      `the review with photos is pending although reviews publish straight away (Q2): ${review?.status}, ${photoRows.length} photos ${JSON.stringify(photoRows.map(({ id, position, width, height }) => ({ id, position, width, height })))}`,
    )
    // In case the storefront's answer did not carry the URLs, the admin item may (any /media/reviews/… in it).
    if (made.photoNames.length === 0) made.photoNames = [...new Set(JSON.stringify(review ?? {}).match(PHOTO_URL) ?? [])].map((url) => url.split('/').pop())
    const throughStore = await Promise.all(made.photoNames.map((name) => storePhoto(name)))
    const throughApi = await Promise.all(made.photoNames.map((name) => apiPhoto(name)))
    log(
      made.photoNames.length === 2 && [...throughStore, ...throughApi].every((answer) => answer.status === 404),
      `while pending, the public photo URLs give 404 (store ${throughStore.map((answer) => answer.status).join('/')}, API ${throughApi.map((answer) => answer.status).join('/')})`,
    )
    // Staff see them in every status, never cached.
    const staff = await fetch(`${LARAVEL_URL}/api/admin/v1/reviews/${review?.id}/photos/${photoRows[0]?.id}`, { headers: { Authorization: `Bearer ${owner}` } })
    const staffType = staff.headers.get('content-type') ?? ''
    const staffCache = staff.headers.get('cache-control') ?? ''
    await staff.arrayBuffer().catch(() => null)
    log(staff.status === 200 && /^image\/(jpeg|png|webp)/.test(staffType) && /no-store/.test(staffCache) && /private/.test(staffCache), `the staff photo URL works while pending (${staff.status} ${staffType}, ${staffCache})`)
    const withPhotos = (await reviewsOfRun('&has_photos=1')).map((row) => row.comment)
    log(withPhotos.length === 1 && withPhotos[0] === avaText, `API has_photos=1: only the review with photos (${withPhotos.length})`)
  })

  // ---------- 5. Admin Reviews: "With photos", thumbnails, Approve, Hide photo 2 ----------
  let admin = null
  let reviewRow = null
  await part('admin moderation', async () => {
    admin = await adminPage()
    await admin.goto(`${BASE}/admin/reviews?q=${marker}`, { waitUntil: 'networkidle' })
    await admin.locator('tbody tr').first().waitFor({ timeout: 15000 }).catch(() => {})
    const filtered = admin.waitForRequest((request) => /\/api\/admin\/reviews\?/.test(request.url()) && /[?&]hasPhotos=(true|1)/.test(request.url()), { timeout: 15000 }).catch(() => null)
    const box = admin.getByRole('checkbox', { name: /with photos/i })
    if ((await box.count()) > 0) await box.first().check()
    else {
      const select = admin.locator('select').filter({ has: admin.locator('option', { hasText: /with photos/i }) }).first()
      await select.selectOption({ label: (await select.locator('option', { hasText: /with photos/i }).first().innerText()).trim() })
    }
    log(Boolean(await filtered), 'the "With photos" filter asks the server for reviews with photos (hasPhotos)')
    await admin.waitForLoadState('networkidle')
    reviewRow = admin.locator('tbody tr').filter({ hasText: avaText })
    await reviewRow.waitFor({ timeout: 15000 }).catch(() => {})
    // The previous list stays on screen until the filtered answer arrives: wait for the other review to go.
    await admin.locator('tbody tr').filter({ hasText: otherText }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    log((await reviewRow.count()) === 1 && (await admin.locator('tbody tr').filter({ hasText: otherText }).count()) === 0, 'with the filter: only the review with photos is listed')
    const thumbnails = reviewRow.locator('img[src*="/photos/"]')
    const widths = await naturalWidths(thumbnails)
    log(widths.length === 2 && widths.every((width) => width > 0), `the review shows 2 thumbnails that load (widths ${widths.join(', ')})`)
    await axe(admin, 'admin Reviews with photo thumbnails')

    await reviewRow.getByRole('button', { name: /^Approve the review by / }).click()
    log(await visible(admin.getByRole('status').filter({ hasText: 'was approved' })), 'Approve: notice')
    log(await visible(reviewRow.getByText('Approved')), 'the review is now Approved')

    const author = review?.author_name ?? ''
    const hide = reviewRow.getByRole('button', { name: /^Hide photo 2 of review by / })
    log((await reviewRow.getByRole('button', { name: `Hide photo 2 of review by ${author}`, exact: true }).count()) === 1, `the button is named "Hide photo 2 of review by ${author}"`)
    await hide.click()
    log(await visible(reviewRow.getByText('Hidden from the store')), 'Hide photo 2: "Hidden from the store"')
    log(await visible(reviewRow.getByRole('button', { name: `Show photo 2 of review by ${author}` })), 'and its button now says "Show photo 2 of review by …"')
    const photoRows = [...(((await reviewsOfRun()).find((row) => row.comment === avaText))?.photos ?? [])].sort((a, b) => a.position - b.position)
    log(photoRows[0]?.hidden === false && photoRows[1]?.hidden === true, `the API agrees: photo 1 shown, photo 2 hidden (${photoRows.map((photo) => photo.hidden).join(', ')})`)
  })

  // ---------- 6. The store: 1 thumbnail, the viewer, "With photos (1)", the public URLs ----------
  await part('storefront with 1 visible photo', async () => {
    const detail = await publicProduct()
    const publicReview = detail?.reviews?.find((row) => row.comment === avaText)
    log(
      detail?.review_photo_count === 1 && publicReview?.photos?.length === 1 && /^\/media\/reviews\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(publicReview.photos[0].url ?? ''),
      `API: review_photo_count ${detail?.review_photo_count}, the review lists ${publicReview?.photos?.length} photo (${publicReview?.photos?.[0]?.url})`,
    )
    log(
      publicReview?.photos?.[0]?.width > 0 && Math.max(publicReview.photos[0].width, publicReview.photos[0].height) <= 1600,
      `the 2000 px photo was shrunk to at most 1600 px (${publicReview?.photos?.[0]?.width} × ${publicReview?.photos?.[0]?.height})`,
    )

    const page = await visitorOnProduct()
    const item = page.locator('#reviews li').filter({ hasText: avaText })
    await item.first().waitFor({ timeout: 15000 }).catch(() => {})
    const thumbs = thumbsOf(item.first())
    const author = publicReview?.author_name ?? '?'
    const exactName = await item.first().getByRole('button', { name: new RegExp(`^Open photo 1 of 1 from ${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['’]s review$`) }).count()
    log((await thumbs.count()) === 1 && exactName === 1, `the review shows 1 thumbnail, named "Open photo 1 of 1 from ${author}'s review"`)
    const image = thumbs.first().locator('img')
    const attributes = await image.evaluate((element) => ({ alt: element.getAttribute('alt'), loading: element.getAttribute('loading'), width: element.getAttribute('width'), height: element.getAttribute('height') })).catch(() => ({}))
    log(attributes.alt === '' && attributes.loading === 'lazy' && Number(attributes.width) > 0 && Number(attributes.height) > 0, `the thumbnail image: empty alt (the button names it), lazy, real size (${JSON.stringify(attributes)})`)
    const [thumbWidth] = await naturalWidths(image)
    log(thumbWidth > 0, `the thumbnail loads (natural width ${thumbWidth})`)

    // The viewer
    await thumbs.first().click()
    const viewer = viewerOf(page)
    log(await visible(viewer), 'the thumbnail opens the photo viewer')
    log(await visible(viewer.getByText(/^Photo 1 of 1$/)), '"Photo 1 of 1"')
    log((await viewer.getByRole('button', { name: /^(Previous|Next) photo$/ }).count()) === 0 && (await visible(viewer.getByRole('button', { name: 'Close' }))), 'one photo: no Previous / Next, a Close button')
    const [largeWidth] = await naturalWidths(viewer.locator('img'))
    log(largeWidth > 0, `the viewer shows the photo (natural width ${largeWidth})`)
    await axe(page, 'product page with the photo viewer open')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const overflow = await sidewaysOverflow(page)
    const box = await viewer.boundingBox()
    log(overflow <= 0 && box && box.x >= 0 && box.x + box.width <= 391, `390px with the viewer open: no sideways scroll (${overflow}px), the viewer fits${overflow > 0 ? ` — sticks out: ${await overflowCulprits(page)}` : ''}`)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.keyboard.press('Escape')
    await viewer.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(150)
    log(!(await viewer.first().isVisible()) && (await thumbs.first().evaluate((element) => element === document.activeElement)), 'Escape closes the viewer and focus returns to the thumbnail')

    // "With photos (1)": counts reviews with photos, shows only them
    const filter = filterButton(page)
    const exactFilter = await page.getByRole('button', { name: 'With photos (1)', exact: true }).count()
    log(exactFilter === 1 && (await filter.first().getAttribute('aria-pressed')) === 'false', `the filter button "With photos (1)", not pressed (${exactFilter} found, aria-pressed ${await filter.first().getAttribute('aria-pressed').catch(() => null)})`)
    log((await shownReviews(page, otherText)) === 1, 'before filtering, the review without photos is listed too')
    await filter.first().click()
    log((await filter.first().getAttribute('aria-pressed')) === 'true', '"With photos (1)" is now pressed')
    log((await shownReviews(page, otherText)) === 0 && (await shownReviews(page, avaText)) === 1, 'and only the review with photos is listed')
    await axe(page, 'product reviews filtered to photos')
    await filter.first().click()
    log((await shownReviews(page, otherText)) === 1, 'pressed again: every review is back')
    await page.context().close()

    // The public URLs: the hidden one 404, the visible one 200, a short cache, no hidden data
    const [shown, hidden] = made.photoNames
    const hiddenAnswer = await storePhoto(hidden)
    log(hiddenAnswer.status === 404, `the hidden photo's public URL gives 404 (${hiddenAnswer.status})`)
    const shownAnswer = await storePhoto(shown)
    log(
      shownAnswer.status === 200 && /^image\/(jpeg|png|webp)/.test(shownAnswer.type) && /max-age=300/.test(shownAnswer.cache) && !/immutable/.test(shownAnswer.cache),
      `the visible photo gives 200 with a 5-minute cache (${shownAnswer.status} ${shownAnswer.type}, ${shownAnswer.cache})`,
    )
    log(shownAnswer.bytes.length > 0 && !shownAnswer.bytes.includes('Exif') && !shownAnswer.bytes.includes('GPS'), `its bytes contain neither "Exif" nor "GPS" (${shownAnswer.bytes.length} bytes, from the photo that had a GPS block)`)
  })

  // ---------- 7. Bangla ----------
  await part('Bangla', async () => {
    const page = await avaOnProduct('bn')
    await page.locator('#reviews').waitFor()
    // Ava has reviewed this product: the form gives way to the "already reviewed" note (phase 23), in Bangla too.
    const note = (await page.locator('#reviews a[href="/account/reviews"]').first().locator('xpath=..').innerText().catch(() => '')).trim()
    log(BENGALI.test(note) && !/already reviewed/.test(note), `the "already reviewed" note is in Bangla ("${note.replace(/\s+/g, ' ').slice(0, 80)}")`)
    const filter = page.locator('#reviews button[aria-pressed]').first()
    const filterText = (await filter.innerText().catch(() => '')).trim()
    log(BENGALI.test(filterText) && !/With photos/.test(filterText), `the filter button is in Bangla ("${filterText}")`)
    await axe(page, 'product page in Bangla')
    await page.context().close()
  })

  // ---------- 8. Admin shows photo 2 again ----------
  await part('show photo 2 again', async () => {
    if (!admin || !reviewRow) throw new Error('the admin part did not finish')
    await reviewRow.getByRole('button', { name: /^Show photo 2 of review by / }).click()
    await reviewRow.getByRole('button', { name: /^Hide photo 2 of review by / }).waitFor({ timeout: 15000 }).catch(() => {})
    log((await reviewRow.getByText('Hidden from the store').filter({ visible: true }).count()) === 0, 'Show photo 2: "Hidden from the store" is gone')
    await admin.context().close()
    admin = null

    // The image cache keeps a photo up to 5 minutes; the API answer changes at once.
    const detail = await publicProduct()
    const publicReview = detail?.reviews?.find((row) => row.comment === avaText)
    log(detail?.review_photo_count === 2 && publicReview?.photos?.length === 2, `API: review_photo_count ${detail?.review_photo_count}, the review lists ${publicReview?.photos?.length} photos`)
    const second = await storePhoto(made.photoNames[1])
    log(second.status === 200, `photo 2's public URL gives 200 again (${second.status})`)

    const page = await visitorOnProduct()
    const item = page.locator('#reviews li').filter({ hasText: avaText }).first()
    await item.waitFor({ timeout: 15000 }).catch(() => {})
    const thumbs = thumbsOf(item)
    log((await thumbs.count()) === 2, `the store shows 2 thumbnails (${await thumbs.count()})`)
    await thumbs.first().click()
    const viewer = viewerOf(page)
    await viewer.first().waitFor({ timeout: 5000 }).catch(() => {})
    log(await visible(viewer.getByText(/^Photo 1 of 2$/)), 'the viewer: "Photo 1 of 2"')
    await viewer.getByRole('button', { name: 'Next photo' }).click()
    log(await visible(viewer.getByText(/^Photo 2 of 2$/)), '"Next photo": "Photo 2 of 2"')
    await page.keyboard.press('ArrowLeft')
    log(await visible(viewer.getByText(/^Photo 1 of 2$/)), 'the left arrow key: back to "Photo 1 of 2"')
    await viewer.getByRole('button', { name: 'Close' }).click()
    await viewer.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    log(!(await viewer.first().isVisible()), '"Close" closes the viewer')
    await page.context().close()
  })
  await admin?.context().close().catch(() => {})
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
    // Its photo files go with each review (after the transaction commits).
    for (const row of await reviewsOfRun()) {
      const deleted = await admin$(`/reviews/${row.id}`, { method: 'DELETE' })
      if (![200, 204].includes(deleted.status)) throw new Error(`DELETE review ${row.id} answered ${deleted.status}`)
    }
  })
  await attempt('product', async () => {
    if (!made.productId) return
    // Parked as a Draft first, like catalog.mjs.
    await admin$(`/products/${made.productId}`, { method: 'PATCH', body: { status: 'draft' } })
    const deleted = await admin$(`/products/${made.productId}`, { method: 'DELETE' })
    if (![200, 204].includes(deleted.status)) throw new Error(`DELETE product answered ${deleted.status}`)
  })
  await attempt('the throwaway customer', async () => {
    const id = made.customerId ?? ((await admin$(`/customers?search=${encodeURIComponent(rumi.email)}`)).body?.data ?? []).find((row) => row.email === rumi.email)?.id
    if (!id) return
    const deleted = await admin$(`/customers/${id}`, { method: 'DELETE' })
    if (deleted.status !== 204) throw new Error(`DELETE customer answered ${deleted.status} ${JSON.stringify(deleted.body?.errors ?? deleted.body?.message)}`)
  })
  await attempt('catalog settings', async () => {
    if (!savedCatalog) return
    const answer = await admin$('/settings', { method: 'PATCH', body: { catalog: savedCatalog } })
    if (answer.status !== 200) throw new Error(`PATCH settings answered ${answer.status}`)
  })
  // Saved carts, and Ava's language (the Bangla part may have saved bn to her account).
  await attempt('saved carts and language', async () => {
    await clearSavedCart(SHOPPER)
    await clearSavedCart(SHOPPER_2)
  })

  const catalog = (await admin$('/settings')).body?.data?.catalog
  const leftReviews = (await reviewsOfRun()).length
  const leftProducts = ((await admin$(`/products?search=${encodeURIComponent(marker)}`)).body?.data ?? []).length
  const leftCustomer = ((await admin$(`/customers?search=${encodeURIComponent(rumi.email)}`)).body?.data ?? []).length
  const settingsBack = JSON.stringify(catalog) === JSON.stringify(savedCatalog)
  log(
    problems.length === 0 && settingsBack && leftReviews === 0 && leftProducts === 0 && leftCustomer === 0,
    `cleanup: both reviews, the product and the throwaway customer removed, Settings → Catalog as before${problems.length || !settingsBack || leftReviews || leftProducts || leftCustomer ? ` — left: ${[...problems, `catalog ${JSON.stringify(catalog)}`, `${leftReviews} reviews`, `${leftProducts} products`, `${leftCustomer} customer`].join('; ')}` : ''}`,
  )
  if (made.photoNames.length > 0) {
    const answers = await Promise.all(made.photoNames.map((name) => storePhoto(name)))
    const direct = await Promise.all(made.photoNames.map((name) => apiPhoto(name)))
    log([...answers, ...direct].every((answer) => answer.status === 404), `after the review is deleted its photo URLs give 404 (store ${answers.map((answer) => answer.status).join('/')}, API ${direct.map((answer) => answer.status).join('/')})`)
  }
}
