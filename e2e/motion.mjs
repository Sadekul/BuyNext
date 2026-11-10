// Dialog animations: the mini cart, the mobile menu, and quick view open and close smoothly (no jump back).
import { BASE, launch, reporter } from './lib.mjs'

const report = reporter('dialog motion')
const { log } = report
const browser = await launch()

/** Samples a dialog's position every animation frame while `action` runs. */
async function track(page, selector, action) {
  await page.evaluate((sel) => {
    window.__samples = []
    const start = performance.now()
    const tick = () => {
      const dialog = document.querySelector(sel)
      const rect = dialog?.getBoundingClientRect()
      if (rect?.width) window.__samples.push({ x: Math.round(rect.x), y: Math.round(rect.y), opacity: Number(getComputedStyle(dialog).opacity) })
      if (performance.now() - start < 700) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, selector)
  await action()
  await page.waitForTimeout(800)
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
const closing = await track(page, 'dialog.modal--drawer-right', () => page.getByRole('button', { name: 'Close' }).click())
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
const fade = (await track(page, 'dialog.modal--center', () => page.locator('.product-card').first().getByRole('button', { name: /quick view/i }).click())).map(
  (sample) => sample.opacity,
)
log(fade[0] < 0.5 && oneWay(fade), `quick view fades in (${fade[0].toFixed(2)} → ${fade.at(-1).toFixed(2)})`)
await page.waitForTimeout(400)
log((await page.evaluate(() => getComputedStyle(document.querySelector('dialog.modal--center')).opacity)) === '1', 'quick view ends fully visible')

report.done()
await browser.close()
