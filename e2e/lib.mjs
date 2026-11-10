/*
 * Shared helpers for BuyNest's browser checks.
 * They drive the system Chrome through playwright-core (no browser download).
 *   BASE_URL     the site to test (default: the dev server, http://localhost:5173)
 *   CHROME_PATH  the Chrome/Chromium binary (default: /usr/bin/google-chrome)
 */
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const AXE_PATH = require.resolve('axe-core/axe.min.js')

export const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
export const isProductionBuild = new URL(BASE).port === '4173'

export const DEMO_ADMIN = { username: 'emilys', password: 'emilyspass' } // DummyJSON role "admin"
export const DEMO_ADMIN_2 = { username: 'michaelw', password: 'michaelwpass' } // also "admin"
export const DEMO_CUSTOMER = { username: 'averyp', password: 'averyppass' } // role "user"

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
export async function storefrontSignIn(page, { username, password }, { remember = true } = {}) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  const box = page.getByLabel('Keep me signed in')
  if ((await box.isChecked()) !== remember) await box.click()
  await page.getByRole('button', { name: /^sign in$/i }).click()
  // Usually /account, or the page the shopper was sent to sign in from (e.g. /checkout).
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15000 })
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
