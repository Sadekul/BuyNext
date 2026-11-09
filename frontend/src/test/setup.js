import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Unmount rendered components and reset storage between tests.
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

/*
 * jsdom doesn't implement every browser API BuyNest uses. These small
 * stand-ins keep component tests focused on React behavior.
 */
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close() {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
Element.prototype.scrollIntoView = vi.fn()
window.scrollTo = vi.fn()
