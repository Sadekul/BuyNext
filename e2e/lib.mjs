/*
 * Shared helpers for BuyNest's browser checks.
 * They drive the system Chrome through playwright-core (no browser download).
 *   BASE_URL      the site to test (default: the dev server, http://localhost:5173)
 *   CHROME_PATH   the Chrome/Chromium binary (default: /usr/bin/google-chrome)
 *   E2E_ACCOUNTS  laravel (default: BuyNest's API, seeded with `php artisan db:seed`)
 *                 or dummyjson (DummyJSON's demo users), matching VITE_ACCOUNTS_BACKEND
 *   LARAVEL_URL   the Laravel API, for its local test inbox (default http://127.0.0.1:8000)
 */
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')

export const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
export const isProductionBuild = new URL(BASE).port === '4173'

export const LARAVEL = (process.env.E2E_ACCOUNTS ?? 'laravel') === 'laravel'
export const LARAVEL_URL = (process.env.LARAVEL_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '')

/*
 * Accounts. `firstName` is what the storefront greets ("Hi, Ava"), `name` what the admin shows.
 * BuyNest accounts: created by `php artisan db:seed` in backend/ (local development only).
 * DummyJSON: public demo users; emilys and michaelw have the role "admin".
 */
export const SHOPPER = LARAVEL
  ? { email: 'customer@buynest.test', password: 'CustomerPass2026', firstName: 'Ava' }
  : { username: 'emilys', password: 'emilyspass', firstName: 'Emily' }
export const SHOPPER_2 = LARAVEL
  ? { email: 'shopper2@buynest.test', password: 'ShopperPass2026', firstName: 'Ben' }
  : { username: 'michaelw', password: 'michaelwpass', firstName: 'Michael' }
export const ADMIN_USER = LARAVEL
  ? { email: 'admin@buynest.test', password: 'AdminPass2026', name: 'Store Admin' }
  : { username: 'emilys', password: 'emilyspass', name: 'Emily Johnson' }
/** A storefront customer, who must never get into the admin. */
export const NOT_ADMIN = LARAVEL ? SHOPPER : { username: 'averyp', password: 'averyppass', firstName: 'Avery' }
/** The sign-in field: BuyNest accounts use an email, DummyJSON a username. */
export const ID_LABEL = LARAVEL ? 'Email' : 'Username'
const idOf = (account) => account.email ?? account.username

export function launch() {
  return chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] })
}

/** PASS/FAIL lines, printed at the end; any FAIL makes the process exit with 1. */
export function reporter(name) {
  const lines = []
  return {
    log(ok, message) {
      lines.push(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
    },
    done() {
      const failed = lines.filter((line) => line.startsWith('FAIL')).length
      console.log(`\n# ${name}\n${lines.join('\n')}\n${lines.length - failed} passed, ${failed} failed`)
      if (failed > 0) process.exitCode = 1
    },
  }
}

/** Collects uncaught errors and console errors (expected HTTP failures excluded). */
export function watchErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource|status of 40[0-9]/.test(message.text())) {
      errors.push(message.text().slice(0, 200))
    }
  })
  return page
}

/** Resolves true when the locator becomes visible in time, false otherwise (never throws). */
export const visible = (locator, timeout = 15000) => locator.first().waitFor({ timeout }).then(() => true, () => false)

/** axe-core accessibility audit; returns violation summaries like "color-contrast(4)". Needs bypassCSP. */
export async function axeViolations(page) {
  await page.addScriptTag({ path: AXE_PATH })
  return page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] })
    return result.violations.map((violation) => `${violation.id}(${violation.nodes.length})`)
  })
}

/** Signs in on the storefront's /login page; `remember` sets "Keep me signed in". */
export async function storefrontSignIn(page, account, { remember = true } = {}) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel(ID_LABEL).fill(idOf(account))
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  const box = page.getByLabel('Keep me signed in')
  if ((await box.isChecked()) !== remember) await box.click()
  await page.getByRole('button', { name: /^sign in$/i }).click()
  // Usually /account, or the page the shopper was sent to sign in from (e.g. /checkout).
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15000 })
}

/** Signs in on the admin's own sign-in page (/admin/login). */
export async function adminSignIn(page, account, { remember = false } = {}) {
  if (!new URL(page.url()).pathname.startsWith('/admin/login')) await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' })
  await page.getByLabel(ID_LABEL).fill(idOf(account))
  await page.getByLabel('Password').fill(account.password)
  if (remember) await page.getByLabel(/Keep me signed in/).check()
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** The 6-digit code in the newest email to `email`, from the Laravel test inbox (local development only). */
export async function latestCode(email, { after = 0 } = {}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(`${LARAVEL_URL}/dev/mailbox/latest?to=${encodeURIComponent(email.toLowerCase())}`)
    if (response.ok) {
      const { data } = await response.json()
      const code = data.text.match(/Your code: (\d{6})/)?.[1]
      if (code && data.id > after) return { code, id: data.id, subject: data.subject }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`No code emailed to ${email}`)
}

export async function storefrontSignOut(page) {
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(`${BASE}/`)
}

/** Header counters: { wishlist, cart } (-1 when the badge isn't found). */
export const headerCounts = (page) =>
  page.evaluate(() => {
    const count = (label) =>
      Number(document.querySelector(`.site-header [aria-label^="${label},"]`)?.getAttribute('aria-label').match(/(\d+) items/)?.[1] ?? -1)
    return { wishlist: count('Wishlist'), cart: count('Cart') }
  })

/** Pixels the page scrolls sideways (0 = fits the viewport). */
export const sidewaysOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/**
 * Fills the checkout address fields that are still empty, like a shopper would.
 * DummyJSON demo users come with a saved address; a new BuyNest account has none yet.
 */
export async function fillEmptyAddress(page) {
  const address = { line1: '12 Market Street', city: 'Springfield', state: 'Oregon', postalCode: '29112' }
  for (const [field, value] of Object.entries(address)) {
    const input = page.locator(`[name="shipping.${field}"]`)
    if ((await input.count()) > 0 && !(await input.inputValue())) await input.fill(value)
  }
}
