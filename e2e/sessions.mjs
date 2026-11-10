// Sign-in sessions: HttpOnly cookies, "Keep me signed in", renewal, sign-out, other websites.
import { BASE, DEMO_ADMIN, headerCounts, launch, reporter, storefrontSignIn, visible, watchErrors } from './lib.mjs'

const report = reporter('sessions')
const { log } = report
const browser = await launch()
const errors = []
const newContext = (storageState) => browser.newContext({ viewport: { width: 1280, height: 900 }, storageState })
const newPage = async (ctx) => watchErrors(await ctx.newPage(), errors)
const save = async (page, id) => {
  await page.goto(`${BASE}/products/${id}`, { waitUntil: 'networkidle' })
  await page.locator('.product-details .wishlist-button--button').click()
}
const accountKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('.user-')))
const allStorage = (page) => page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
// What survives closing the browser: only cookies with an expiry date.
const afterBrowserRestart = (state) => ({ ...state, cookies: state.cookies.filter((cookie) => cookie.expires > 0) })
const greeting = (page) => visible(page.getByRole('heading', { name: /Hi, Emily/ }), 10000)

// ---------- Not remembered ----------
let ctx = await newContext()
let page = await newPage(ctx)
await storefrontSignIn(page, DEMO_ADMIN, { remember: false })
const access = (await ctx.cookies()).find((cookie) => cookie.name === 'buynest_at')
log(
  access?.httpOnly && access.secure && access.sameSite === 'Strict' && access.path === '/api',
  `session cookie is HttpOnly, Secure, SameSite=Strict, Path=/api (${JSON.stringify(access && { httpOnly: access.httpOnly, secure: access.secure, sameSite: access.sameSite, path: access.path })})`,
)
log(access?.expires === -1, 'not remembered: the session cookie ends with the browser')
log(!/token|eyJ/i.test(await allStorage(page)), 'no token anywhere in localStorage or sessionStorage')
log(!(await page.evaluate(() => document.cookie)).includes('buynest_at'), 'page JavaScript cannot read the session cookie')
log(await greeting(page), 'account page loads with the cookie session')
const me = await page.evaluate(async () => (await fetch('/api/auth/me')).text())
log(!/password|ssn|iban|cardNumber|"ip"/i.test(me), 'profile from the sign-in service has no password, SSN, bank, or IP data')
await page.reload({ waitUntil: 'networkidle' })
log(await greeting(page), 'still signed in after a reload')
const tab2 = await newPage(ctx)
await tab2.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
log(await greeting(tab2), 'a new tab shares the session')
await tab2.close()
await save(page, 3)
log((await accountKeys(page)).length > 0, 'account items saved')

// Browser closed and reopened without signing out
let state = afterBrowserRestart(await ctx.storageState())
await ctx.close()
ctx = await newContext(state)
page = await newPage(ctx)
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
log(await page.locator('.site-header__action-label', { hasText: 'Sign in' }).isVisible(), 'after the browser restarts: signed out')
log((await accountKeys(page)).length === 0, `after the browser restarts: account items deleted (${await accountKeys(page)})`)

// Signed in again, then an explicit sign-out
await storefrontSignIn(page, DEMO_ADMIN, { remember: false })
await save(page, 3)
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Sign out' }).click()
await page.waitForURL(`${BASE}/`)
await page.waitForTimeout(300)
log((await ctx.cookies()).filter((cookie) => cookie.name.startsWith('buynest_')).length === 0, 'sign-out deletes every session cookie')
log((await accountKeys(page)).length === 0, 'not remembered: sign-out deletes the account items')
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
log(/\/login/.test(page.url()), 'after sign-out the account page needs a sign-in')
await ctx.close()

// ---------- Remembered ----------
ctx = await newContext()
page = await newPage(ctx)
await storefrontSignIn(page, DEMO_ADMIN, { remember: true })
const refresh = (await ctx.cookies()).find((cookie) => cookie.name === 'buynest_rt')
log(refresh?.expires > Date.now() / 1000 + 6 * 86400, '"Keep me signed in": the session lasts 7 days')
await save(page, 4)
state = afterBrowserRestart(await ctx.storageState())
await ctx.close()
ctx = await newContext(state)
page = await newPage(ctx)
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
log(await greeting(page), '"Keep me signed in": still signed in after the browser restarts')
await page.getByRole('button', { name: 'Sign out' }).click()
await page.waitForURL(`${BASE}/`)
await page.waitForTimeout(300)
log((await accountKeys(page)).length > 0, '"Keep me signed in": sign-out keeps the account items for next time')
await storefrontSignIn(page, DEMO_ADMIN, { remember: true })
log((await headerCounts(page)).wishlist >= 1, `"Keep me signed in": items come back on sign-in (wishlist ${(await headerCounts(page)).wishlist})`)

// Silent renewal: the access token expired, the refresh token is still valid
const authCalls = []
page.on('response', (response) => response.url().includes('/api/auth/') && authCalls.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`))
await ctx.clearCookies({ name: 'buynest_at' })
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
log((await greeting(page)) && authCalls.some((call) => call.startsWith('POST /api/auth/refresh 200')), `expired access token renewed silently (${authCalls.join(' → ')})`)
log((await ctx.cookies()).some((cookie) => cookie.name === 'buynest_at'), 'renewal issued a new access cookie')

// Another website (127.0.0.1 is a different site from localhost) cannot use the session
// Not watched for errors: the browser logs its CORS block there, which is the expected outcome.
const evil = await ctx.newPage()
const sentHeaders = []
evil.on('request', (request) => request.url().includes('/api/') && sentHeaders.push(request.headers()))
await evil.goto(`${BASE.replace('localhost', '127.0.0.1')}/`, { waitUntil: 'networkidle' })
const attempt = await evil.evaluate(async (target) => {
  try {
    const response = await fetch(`${target}/api/auth/me`, { credentials: 'include' })
    return `read ${response.status}: ${(await response.text()).slice(0, 40)}`
  } catch (error) {
    return `blocked (${error.message})`
  }
}, BASE)
log(attempt.startsWith('blocked'), `another website cannot read the profile: ${attempt}`)
log(!sentHeaders.some((headers) => (headers.cookie ?? '').includes('buynest_at')), 'the session cookie is not sent with requests from another website')
await ctx.close()

// Regression: a reload straight after signing in must not forget "Keep me signed in"
let kept = 0
for (let run = 0; run < 5; run++) {
  ctx = await newContext()
  page = await newPage(ctx)
  await storefrontSignIn(page, DEMO_ADMIN, { remember: true })
  await save(page, 4) // full page load right after signing in
  state = afterBrowserRestart(await ctx.storageState())
  await ctx.close()
  ctx = await newContext(state)
  page = await newPage(ctx)
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.waitForTimeout(300)
  if ((await accountKeys(page)).length > 0) kept++
  await ctx.close()
}
log(kept === 5, `reload right after sign-in keeps "Keep me signed in" (${kept}/5 kept their items)`)

// Sign-out followed at once by a reload, or by closing the tab, still ends the session
let reloadSignedOut = 0
let closeCleared = 0
const RUNS = 4
for (let run = 0; run < RUNS; run++) {
  for (const mode of ['reload', 'close']) {
    ctx = await newContext()
    page = await newPage(ctx)
    await storefrontSignIn(page, DEMO_ADMIN)
    await page.getByRole('button', { name: 'Sign out' }).click()
    if (mode === 'reload') {
      await page.goto(`${BASE}/account`)
      if (await page.waitForURL(/\/login/, { timeout: 10000 }).then(() => true, () => false)) reloadSignedOut++
    } else {
      await page.close()
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const left = (await ctx.cookies()).filter((cookie) => ['buynest_at', 'buynest_rt', 'buynest_session'].includes(cookie.name))
      if (left.length === 0) closeCleared++
    }
    await ctx.close()
  }
}
log(reloadSignedOut === RUNS, `sign-out + instant reload → signed out (${reloadSignedOut}/${RUNS})`)
log(closeCleared === RUNS, `sign-out + instant tab close → all session cookies deleted (${closeCleared}/${RUNS})`)

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
