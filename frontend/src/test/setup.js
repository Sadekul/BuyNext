import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Server-side tests (e.g. server/authBff.test.js) run in Node, without a DOM.
const hasDom = typeof window !== 'undefined'

// Unmount rendered components and reset storage between tests.
afterEach(() => {
  vi.unstubAllGlobals()
  if (!hasDom) return
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
