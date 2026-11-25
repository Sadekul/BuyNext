// Dialog animations: the mini cart, the mobile menu, and quick view open and close smoothly (no jump back).
import { BASE, launch, reporter } from './lib.mjs'

const report = reporter('dialog motion')
const { log } = report
const browser = await launch()

/**
 * Samples a dialog's position and opacity every animation frame while `action` runs:
 * for 0.7 s from the first frame the dialog is visible (or, when closing, from the
 * start), waiting up to 5 s for it to appear (its code may load on first use).
 */
async function track(page, selector, action) {
  await page.evaluate((sel) => {
    window.__samples = []
    window.__tracking = true
    const begun = performance.now()
    let start = null
    const tick = () => {
      const now = performance.now()
      const dialog = document.querySelector(sel)
      const rect = dialog?.getBoundingClientRect()
      if (rect?.width) {
        start ??= now
        window.__samples.push({ x: Math.round(rect.x), y: Math.round(rect.y), opacity: Number(getComputedStyle(dialog).opacity) })
      }
      const sampling = start === null ? now - begun < 5000 : now - start < 700
      if (sampling) requestAnimationFrame(tick)
      else window.__tracking = false
    }
    requestAnimationFrame(tick)
  }, selector)
  await action()
  await page.waitForFunction(() => window.__tracking === false, null, { timeout: 8000 })
  await page.waitForTimeout(100)
  return page.evaluate(() => window.__samples)
}

/** True when values only ever move one way: no snap back. */
const oneWay = (values) => {
  const direction = Math.sign(values.at(-1) - values[0])
  return values.every((value, i) => i === 0 || Math.sign(value - values[i - 1]) !== -direction)
}

// Mini cart: slides in from the right, and back out
let page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' })
const opening = await track(page, 'dialog.modal--drawer-right', () =>
  page.locator('.product-card').nth(4).getByRole('button', { name: /add to cart/i }).click(),
)
const openX = opening.map((sample) => sample.x)
log(openX[0] > openX.at(-1) && oneWay(openX), `mini cart opens with one steady slide (${openX[0]} → ${openX.at(-1)}, ${openX.length} frames)`)
log(openX.length >= 20, `mini cart animation runs smoothly (${openX.length} frames in 0.7s)`)
const closing = await track(page, 'dialog.modal--drawer-right', () => page.locator('dialog.modal--drawer-right').getByRole('button', { name: 'Close', exact: true }).click())
const closeX = closing.map((sample) => sample.x)
log(closeX.at(-1) > closeX[0] && oneWay(closeX), `mini cart slides out when closed (${closeX[0]} → ${closeX.at(-1)})`)
log(!(await page.evaluate(() => document.querySelector('dialog.modal--drawer-right').open)), 'mini cart is closed afterwards')

// Mobile menu: slides in from the left
page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
const menu = (await track(page, 'dialog.modal--drawer', () => page.getByRole('button', { name: 'Open menu' }).click())).map((sample) => sample.x)
log(menu[0] < 0 && menu.at(-1) === 0 && oneWay(menu), `mobile menu slides in from the left (${menu[0]} → ${menu.at(-1)})`)

// Quick view: fades in and ends fully visible
page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' })
await page.locator('.product-card').first().hover()
const quickView = page.locator('.product-card').first().getByRole('button', { name: /quick view/i })
await quickView.waitFor() // revealed on hover: wait for it before timing the animation
const fade = (await track(page, 'dialog.modal--center', () => quickView.click())).map((sample) => sample.opacity)
log(fade.length > 0 && fade[0] < 0.5 && oneWay(fade), `quick view fades in (${fade[0]?.toFixed(2)} → ${fade.at(-1)?.toFixed(2)})`)
await page.waitForTimeout(400)
log((await page.evaluate(() => getComputedStyle(document.querySelector('dialog.modal--center')).opacity)) === '1', 'quick view ends fully visible')

report.done()
await browser.close()
