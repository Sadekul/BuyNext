// Home page: single banner or slider (docs/backend/HOME_SLIDER_CONTRACT.md) in a real browser.
// The admin switches "Top of the home page" to Slider, adds a slide (with Bangla), saves; the store shows an
// accessible carousel (labels, Previous / Next, dots, Pause / Play, axe, 390px, reduced motion, Bangla); the API
// refuses slider mode without an active slide; the admin deletes the slide and switches back to the single banner.
//
// Runs against the usual servers (the store on :5173, the API on :8000). The home content is read through the API
// at the start and put back exactly at the end, even on failure.
import { ADMIN_USER, BASE, LARAVEL_URL, adminSignIn, axeViolations, launch, reporter, sidewaysOverflow, visible, watchErrors } from './lib.mjs'

const report = reporter('slider: home page single banner or slider (admin editor, carousel, Bangla, accessibility)')
const { log } = report
const errors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const TITLE = 'E2E slider check'
const TITLE_BN = 'ই২ই স্লাইডার পরীক্ষা'

const api = async (path, { method = 'GET', token, body } = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${LARAVEL_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
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
let saved = null
let browser = null
const admin$ = (path, options = {}) => api(`/api/admin/v1${path}`, { token: owner, ...options })
const homeBody = (home) => ({
  hero_mode: home.hero_mode,
  hero: home.hero,
  banners: home.banners,
  slides: home.slides,
  slider: home.slider,
  featured_product_ids: home.featured_product_ids,
})

try {
  owner = (await api('/api/admin/v1/auth/login', { method: 'POST', body: { email: ADMIN_USER.email, password: ADMIN_USER.password } })).body?.data?.tokens?.access_token
  if (!owner) throw new Error('the demo Owner could not sign in to the API')
  saved = (await admin$('/home')).body?.data
  if (!saved || !Array.isArray(saved.slides)) throw new Error('the API has no home slides (slider migration not run?)')
  log(saved.slides.length >= 1, `${saved.slides.length} saved slides (the store is on "${saved.hero_mode}"; put back at the end)`)
  // Start from the single banner whatever staff chose (the content is put back at the end).
  if (saved.hero_mode !== 'banner') {
    const reset = await admin$('/home', { method: 'PUT', body: { ...homeBody(saved), hero_mode: 'banner' } })
    if (reset.status !== 200) throw new Error(`could not switch to the single banner (${reset.status})`)
  }
  browser = await launch()
  await runChecks()
} catch (error) {
  log(false, `suite stopped early: ${error.message.split('\n')[0]}`)
} finally {
  if (saved) {
    const put = await admin$('/home', { method: 'PUT', body: homeBody(saved) }).catch(() => null)
    const after = (await admin$('/home')).body?.data
    log(put?.status === 200 && after?.hero_mode === saved.hero_mode && after?.slides?.length === saved.slides.length, `cleanup: home content put back (${after?.hero_mode}, ${after?.slides?.length} slides)`)
  }
  await browser?.close().catch(() => {})
  log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
  report.done()
}

async function runChecks() {
  const axe = async (page, name) => {
    const violations = await axeViolations(page)
    log(violations.length === 0, `axe ${name}: ${violations.join(', ') || 'no violations'}`)
  }
  async function newPage({ viewport = { width: 1280, height: 900 }, cookie, reducedMotion } = {}) {
    const context = await browser.newContext({ viewport, bypassCSP: true, ...(reducedMotion && { reducedMotion }) })
    context.setDefaultTimeout(15000)
    if (cookie) await context.addCookies([{ name: 'buynest_lang', value: cookie, url: BASE }])
    return watchErrors(await context.newPage(), errors)
  }
  const carousel = (page, name = 'Featured') => page.getByRole('region', { name, exact: true })

  // ---------- 1. The store starts with the single banner ----------
  let shop = await newPage()
  await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  log(!(await visible(carousel(shop), 3000)) && (await visible(shop.getByRole('heading', { level: 1 }))), 'store: single banner, no carousel')
  await shop.context().close()

  // ---------- 2. The admin switches to the slider and adds a slide ----------
  const admin = await newPage({ viewport: { width: 1440, height: 900 } })
  await adminSignIn(admin, ADMIN_USER)
  await admin.getByRole('heading', { name: 'Overview' }).waitFor()
  await admin.goto(`${BASE}/admin/home-page`, { waitUntil: 'networkidle' })
  const modes = admin.getByRole('radiogroup', { name: 'Top of the home page' })
  await modes.waitFor()
  log(await modes.getByRole('radio', { name: 'Single banner' }).isChecked(), 'admin: "Top of the home page" is on "Single banner"')
  await modes.getByRole('radio', { name: 'Slider' }).check()
  await admin.getByRole('heading', { name: 'Slides' }).waitFor()
  const count = saved.slides.length
  log((await admin.getByRole('group', { name: /^Slide \d+:/ }).count()) === count, `admin: the slides editor lists the ${count} saved slides`)
  await admin.getByRole('button', { name: 'Add slide' }).click()
  const n = count + 1
  await admin.getByLabel(`Slide ${n}: Title`, { exact: true }).fill(TITLE)
  await admin.getByLabel(`Slide ${n}: Description`, { exact: true }).fill('Added by the browser check, removed at the end.')
  await admin.getByLabel(`Slide ${n}: Main button text (optional)`, { exact: true }).fill('Shop all')
  await admin.getByLabel(`Slide ${n}: Main button link`, { exact: true }).fill('/products')
  await admin.getByLabel(`Slide ${n}: Color`, { exact: true }).selectOption({ label: 'Beige' })
  await admin.getByLabel(`Slide ${n}: title in Bangla`, { exact: true }).fill(TITLE_BN)
  await axe(admin, 'admin home page, slides editor')
  // Client check: an empty title is refused before saving.
  await admin.getByLabel(`Slide ${n}: Title`, { exact: true }).fill('')
  await admin.getByRole('button', { name: 'Save home page' }).click()
  log(await visible(admin.getByLabel(`Slide ${n}: Title`, { exact: true }).and(admin.locator('[aria-invalid="true"]')), 5000), 'admin: an empty slide title is refused on the field')
  await admin.getByLabel(`Slide ${n}: Title`, { exact: true }).fill(TITLE)
  await admin.getByRole('button', { name: 'Save home page' }).click()
  log(await visible(admin.getByText(/Home page saved\./)), 'admin: "Home page saved."')
  const stored = (await admin$('/home')).body?.data
  const mine = stored?.slides?.find((slide) => slide.title === TITLE)
  log(stored?.hero_mode === 'slider' && stored.slides.length === n && mine?.tone === 'amber' && mine?.bn?.title === TITLE_BN && mine?.primary_cta?.url === '/products', `API: slider mode, ${stored?.slides?.length} slides, the new one amber with its Bangla title and button`)

  // ---------- 3. The store shows the carousel ----------
  shop = await newPage()
  await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const region = carousel(shop)
  log(await visible(region), 'store: the carousel "Featured" is shown')
  log((await region.getAttribute('aria-roledescription')) === 'carousel', 'roledescription "carousel"')
  log(await visible(shop.getByRole('group', { name: `1 of ${n}` })), `slide "1 of ${n}" is shown`)
  log((await shop.locator('h1').count()) === 1, 'the page still has one h1')
  const pause = shop.getByRole('button', { name: 'Pause slides' })
  log(await visible(pause), 'autoplay on: "Pause slides" button')
  await pause.click()
  log(await visible(shop.getByRole('button', { name: 'Play slides' })), 'paused: the button says "Play slides"')
  await shop.getByRole('button', { name: 'Next slide' }).click()
  log(await visible(shop.getByRole('group', { name: `2 of ${n}` })), `Next slide → "2 of ${n}"`)
  log((await shop.getByRole('button', { name: 'Show slide 2' }).getAttribute('aria-current')) === 'true', 'the dot "Show slide 2" is current')
  await shop.getByRole('button', { name: 'Previous slide' }).click()
  log(await visible(shop.getByRole('group', { name: `1 of ${n}` })), `Previous slide → "1 of ${n}"`)
  await shop.getByRole('button', { name: `Show slide ${n}` }).click()
  const last = shop.getByRole('group', { name: `${n} of ${n}` })
  log(await visible(last.getByRole('heading', { name: TITLE })), `the dot "Show slide ${n}" shows the new slide ("${TITLE}")`)
  const link = last.getByRole('link', { name: 'Shop all' })
  log((await link.getAttribute('href')) === '/products', 'its button links to /products')
  await shop.getByRole('button', { name: 'Show slide 1' }).focus()
  await shop.keyboard.press('ArrowRight')
  log(await visible(shop.getByRole('group', { name: `2 of ${n}` })), 'Right arrow on the controls → the next slide')
  const hiddenFocusable = await shop.evaluate(() => [...document.querySelectorAll('[aria-roledescription="slide"]')].filter((slide) => slide.inert === false && getComputedStyle(slide).visibility === 'hidden').length)
  log(hiddenFocusable === 0, 'hidden slides are inert (not focusable)')
  const firstImage = shop.locator('[aria-roledescription="slide"] img').first()
  log((await firstImage.getAttribute('loading')) === 'eager', 'the first slide image loads eagerly (largest paint)')
  await axe(shop, 'store home with the slider')
  await shop.setViewportSize({ width: 390, height: 844 })
  await shop.waitForTimeout(300)
  const overflow = await sidewaysOverflow(shop)
  log(overflow <= 0, `390px: the slider fits (overflow ${overflow}px)`)
  const box = await carousel(shop).boundingBox()
  await shop.getByRole('button', { name: 'Next slide' }).click()
  await shop.waitForTimeout(400)
  const boxAfter = await carousel(shop).boundingBox()
  log(Math.abs((box?.height ?? 0) - (boxAfter?.height ?? -1)) < 1, `no layout shift between slides (${Math.round(box?.height)}px)`)
  await shop.context().close()

  // Autoplay moves on by itself (default 6 s), and never with reduced motion.
  shop = await newPage()
  await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await shop.mouse.move(5, 890)
  log(await visible(shop.getByRole('group', { name: `2 of ${n}` }), 12000), 'autoplay: the next slide after a few seconds')
  await shop.context().close()
  shop = await newPage({ reducedMotion: 'reduce' })
  await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await carousel(shop).waitFor()
  log(!(await shop.getByRole('button', { name: /Pause slides|Play slides/ }).isVisible()), 'reduced motion: no autoplay and no Pause button')
  await shop.waitForTimeout(7000)
  log(await shop.getByRole('group', { name: `1 of ${n}` }).isVisible(), 'reduced motion: still on slide 1 after 7 s')
  await shop.context().close()

  // ---------- 4. Bangla ----------
  shop = await newPage({ cookie: 'bn' })
  await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const bnRegion = carousel(shop, 'বিশেষ আকর্ষণ')
  log(await visible(bnRegion), 'Bangla: the carousel "বিশেষ আকর্ষণ"')
  log((await bnRegion.getAttribute('aria-roledescription')) === 'ক্যারোসেল', 'Bangla: roledescription "ক্যারোসেল"')
  const nBn = String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d])
  log(await visible(shop.getByRole('group', { name: `${nBn}টির মধ্যে ১` })), `Bangla: slide "${nBn}টির মধ্যে ১" (Bangla digits)`)
  await shop.getByRole('button', { name: 'স্লাইড থামান' }).click()
  await shop.getByRole('button', { name: `স্লাইড ${nBn} দেখান` }).click()
  log(await visible(shop.getByRole('heading', { name: TITLE_BN })), `Bangla: the new slide's Bangla title ("${TITLE_BN}")`)
  log(await visible(shop.getByRole('group', { name: `${nBn}টির মধ্যে ${nBn}` }).getByRole('link', { name: 'Shop all' })), 'Bangla: an untranslated button keeps its English text')
  await shop.waitForTimeout(600) // the 400 ms cross-fade: axe mid-fade measures half-transparent text
  await axe(shop, 'store home with the slider in Bangla')
  await shop.context().close()

  // ---------- 5. The API refuses slider mode without an active slide ----------
  const current = (await admin$('/home')).body?.data
  const refused = await admin$('/home', { method: 'PUT', body: { ...homeBody(current), slides: current.slides.map((slide) => ({ ...slide, is_active: false })) } })
  log(refused.status === 422 && /at least one active slide/.test(JSON.stringify(refused.body?.errors?.slides ?? '')), `API: slider mode with no active slide → 422 "${refused.body?.errors?.slides?.[0]}"`)

  // ---------- 6. The admin deletes the slide and switches back ----------
  await admin.reload({ waitUntil: 'networkidle' })
  await admin.getByRole('heading', { name: 'Slides' }).waitFor()
  await admin.getByRole('button', { name: `Delete slide ${n}` }).click()
  const confirm = admin.getByRole('dialog', { name: `Delete slide ${n}?` })
  await confirm.getByRole('button', { name: 'Delete slide' }).click()
  await confirm.waitFor({ state: 'hidden' })
  log((await admin.getByRole('group', { name: /^Slide \d+:/ }).count()) === count, `admin: slide ${n} deleted (${count} left)`)
  await admin.getByRole('radiogroup', { name: 'Top of the home page' }).getByRole('radio', { name: 'Single banner' }).check()
  await admin.getByRole('button', { name: 'Save home page' }).click()
  log(await visible(admin.getByText(/Home page saved\./)), 'admin: saved with the single banner')
  const back = (await admin$('/home')).body?.data
  log(back?.hero_mode === 'banner' && back.slides.length === count && !back.slides.some((slide) => slide.title === TITLE), `API: banner mode, ${back?.slides?.length} slides kept, the test slide gone`)
  shop = await newPage()
  await shop.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  log(!(await visible(carousel(shop), 3000)) && (await visible(shop.getByRole('heading', { level: 1, name: saved.hero.title }))), `store: back to the single banner ("${saved.hero.title}")`)
  await shop.context().close()
  await admin.context().close()
}
