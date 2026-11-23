import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

// jsdom does no layout (and the tests load no CSS), so this checks the rule itself: on phones
// the cart's single grid column must be minmax(0, 1fr). Without it the implicit `auto` track
// takes the order summary's min-content width, which in Bangla (longer button texts) is wider
// than a 390px screen and makes the whole page scroll sideways (found by e2e/bangla.mjs).
describe('CartPage.css', () => {
  it('keeps the phone layout to one column that can shrink to the screen', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/CartPage.css'), 'utf8')
    const base = css.match(/(?:^|\n)\.cart-page__layout\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(base).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/)
  })
})
