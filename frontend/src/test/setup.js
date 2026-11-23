import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
// Phase 13: the app's translations (English, synchronously), as main.jsx loads them.
import i18n from '../i18n'
import { resetIntlForTests } from '../i18n/intl'

// findBy…/waitFor give up after 1 s by default. Multi-step page flows (checkout, then a payment
// redirect) can take longer while ~50 test files run in parallel, so wait up to 5 s.
configure({ asyncUtilTimeout: 5000 })

// Server-side tests (e.g. server/authBff.test.js) run in Node, without a DOM.
const hasDom = typeof window !== 'undefined'

// Unmount rendered components and reset storage between tests.
afterEach(async () => {
  vi.unstubAllGlobals()
  // Phase 13: every test starts in English (a Bangla test switches on its own).
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
  resetIntlForTests()
  if (!hasDom) return
  document.cookie = 'buynest_lang=; Max-Age=0; Path=/'
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
  document.cookie = 'buynest_session=; Max-Age=0; Path=/' // the "signed in" hint cookie
})

/*
 * jsdom doesn't implement every browser API BuyNest uses. These small
 * stand-ins keep component tests focused on React behavior.
 */
if (hasDom && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close() {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
if (hasDom) {
  Element.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn()
}
