import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../services/apiClient'
import { CLIENT_ERRORS_ENDPOINT, MAX_REPORTS_PER_PAGE, MAX_STACK_BYTES, installErrorReporting, reportError } from './errorReporting'

/** The reports sent with navigator.sendBeacon, parsed. */
const beaconReports = (beacon) => Promise.all(beacon.mock.calls.map(([, blob]) => blob.text().then(JSON.parse)))

describe('browser error reporting', () => {
  let stop
  let beacon

  beforeEach(() => {
    beacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { ...window.navigator, sendBeacon: beacon })
    window.history.replaceState(null, '', '/checkout?email=jane@example.com#payment')
  })
  afterEach(() => {
    stop?.()
    stop = undefined
    window.history.replaceState(null, '', '/')
  })

  it('does nothing until it is installed (tests, the DummyJSON demo)', () => {
    expect(reportError(new Error('Boom'))).toBe(false)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('sends the message, stack, path only, app, and release with sendBeacon', async () => {
    stop = installErrorReporting({ app: 'store', release: '2026.11.17' })
    const error = new Error('Boom')
    error.stack = 'Error: Boom\n    at Checkout (https://shop.example/assets/index.js?v=2:10:5)'
    expect(reportError(error, { componentStack: '\n    at Checkout\n    at App' })).toBe(true)
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon.mock.calls[0][0]).toBe(CLIENT_ERRORS_ENDPOINT)
    const [report] = await beaconReports(beacon)
    expect(report).toEqual({
      message: 'Boom',
      stack: 'Error: Boom\n    at Checkout (https://shop.example/assets/index.js:10:5)\nComponent stack:\n    at Checkout\n    at App',
      url: '/checkout',
      app: 'store',
      release: '2026.11.17',
    })
  })

  it('sends the same error once, and at most 5 reports per page load', () => {
    stop = installErrorReporting({ app: 'store' })
    const fail = () => new Error('Same') // the same error from the same place (e.g. a re-render loop)
    expect(reportError(fail())).toBe(true)
    expect(reportError(fail())).toBe(false)
    for (let index = 0; index < 10; index += 1) reportError(new Error(`Error ${index}`))
    expect(beacon).toHaveBeenCalledTimes(MAX_REPORTS_PER_PAGE)
  })

  it('cuts the stack to 8 KB', async () => {
    stop = installErrorReporting({ app: 'admin' })
    const error = new Error('Deep')
    error.stack = `Error: Deep\n${'    at frame (https://shop.example/a.js:1:1)\n'.repeat(400)}`
    reportError(error)
    const [report] = await beaconReports(beacon)
    expect(new TextEncoder().encode(report.stack).length).toBeLessThanOrEqual(MAX_STACK_BYTES)
    expect(report.app).toBe('admin')
  })

  it("skips expected failures: the server's answers, cancelled requests, extensions, cross-origin scripts", () => {
    stop = installErrorReporting({ app: 'store' })
    expect(reportError(new ApiError('Please check the highlighted fields.', { status: 422 }))).toBe(false)
    expect(reportError(new DOMException('Aborted', 'AbortError'))).toBe(false)
    expect(reportError('Script error.')).toBe(false)
    const fromExtension = new Error('ext')
    fromExtension.stack = 'Error: ext\n    at x (chrome-extension://abc/content.js:1:1)'
    expect(reportError(fromExtension)).toBe(false)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('catches uncaught errors and unhandled rejections', async () => {
    stop = installErrorReporting({ app: 'store' })
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('Uncaught'), message: 'Uncaught' }))
    const rejection = new Event('unhandledrejection')
    rejection.reason = new Error('Rejected')
    window.dispatchEvent(rejection)
    expect((await beaconReports(beacon)).map((report) => report.message)).toEqual(['Uncaught', 'Rejected'])
  })

  it('falls back to fetch with keepalive when sendBeacon is missing or refuses', () => {
    vi.stubGlobal('navigator', { ...window.navigator, sendBeacon: undefined })
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))
    vi.stubGlobal('fetch', fetchMock)
    stop = installErrorReporting({ app: 'store' })
    reportError(new Error('No beacon'))
    expect(fetchMock).toHaveBeenCalledWith(CLIENT_ERRORS_ENDPOINT, expect.objectContaining({ method: 'POST', keepalive: true }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).url).toBe('/checkout')
  })
})
