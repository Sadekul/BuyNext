import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import ErrorBoundary from '../components/ErrorBoundary'
import { CLIENT_ERRORS_ENDPOINT, MAX_REPORTS_PER_PAGE, MAX_STACK_BYTES, installErrorReporting, reportError } from './errorReporting'

/*
 * Phase 9 §3: the admin's browser error reports go to the store's
 * POST /api/client-errors with exactly the contract's body.
 */
let stop = null
afterEach(() => {
  stop?.()
  stop = null
})

function captureBeacons() {
  const sent = []
  vi.stubGlobal('navigator', {
    ...navigator,
    sendBeacon: vi.fn((url, blob) => {
      sent.push({ url, blob })
      return true
    }),
  })
  return sent
}
const bodyOf = async (entry) => JSON.parse(await entry.blob.text())

describe('admin error reporting', () => {
  it('does nothing until installed', () => {
    const sent = captureBeacons()
    expect(reportError(new Error('Boom'))).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('sends { message, stack, url (path only), app: "admin", release } once per error, at most 5 per page', async () => {
    const sent = captureBeacons()
    window.history.pushState({}, '', '/admin/orders/BN-1?token=secret#x')
    stop = installErrorReporting({ release: 'abc123' })
    const error = new Error('Boom at https://shop.example/a?code=123')
    error.stack = `Error: Boom\n    at render (https://shop.example/admin/assets/index.js?v=1:1:2)\n${'x'.repeat(MAX_STACK_BYTES)}`
    expect(reportError(error)).toBe(true)
    expect(reportError(error)).toBe(false) // the same error once

    expect(sent[0].url).toBe(CLIENT_ERRORS_ENDPOINT)
    const body = await bodyOf(sent[0])
    expect(Object.keys(body).sort()).toEqual(['app', 'message', 'release', 'stack', 'url'])
    expect(body).toMatchObject({ message: 'Boom at https://shop.example/a', url: '/admin/orders/BN-1', app: 'admin', release: 'abc123' })
    expect(new TextEncoder().encode(body.stack).length).toBeLessThanOrEqual(MAX_STACK_BYTES)
    expect(body.stack).toContain('index.js')
    expect(body.stack).not.toContain('v=1')

    for (let index = 0; index < 10; index += 1) reportError(new Error(`Other ${index}`))
    expect(sent).toHaveLength(MAX_REPORTS_PER_PAGE)
  })

  it('skips errors the page already shows (ApiError, cancelled requests) and reports unhandled rejections', async () => {
    const sent = captureBeacons()
    stop = installErrorReporting({ release: 'bad release name!' })
    const apiError = Object.assign(new Error('Please sign in'), { name: 'ApiError' })
    expect(reportError(apiError)).toBe(false)
    expect(reportError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false)

    const event = new Event('unhandledrejection')
    event.reason = new Error('Lost promise')
    window.dispatchEvent(event)
    expect(sent).toHaveLength(1)
    const body = await bodyOf(sent[0])
    expect(body.message).toBe('Lost promise')
    expect(body).not.toHaveProperty('release')
  })

  it('a render crash is reported by the error boundary, with a way to reload', async () => {
    const sent = captureBeacons()
    stop = installErrorReporting({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken() {
      throw new Error('Render failed')
    }
    const { getByRole } = render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    )
    expect(getByRole('alert')).toHaveTextContent('Something went wrong on this page')
    expect(getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    const body = await bodyOf(sent[0])
    expect(body.message).toBe('Render failed')
    expect(body.stack).toContain('Component stack:')
  })
})
