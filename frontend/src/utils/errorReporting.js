/*
 * Browser error reports (phase 9). When something crashes in a shopper's
 * browser we would otherwise never hear about it. This sends a short report
 * to BuyNest's own sign-in service (POST /api/client-errors,
 * server/clientErrorsApi.js), which checks it and passes it on to the API
 * and from there to Sentry. No third-party script runs in the page.
 *
 * What is caught:
 *   - render crashes caught by an ErrorBoundary (componentDidCatch calls reportError)
 *   - window "error" events: uncaught exceptions in event handlers, timers, …
 *   - "unhandledrejection": a promise that failed with nobody to catch it
 *
 * What a report holds, and nothing else: the error message, its stack (at
 * most 8 KB), the PATH of the page (never the query string or fragment, which
 * can hold tokens or emails), which app ("store" or "admin"), and the release.
 * Never form values, cookies, or anything read from the page.
 *
 * Politeness: the same error is sent once, and at most 5 reports per page
 * load, so an error inside a loop can't flood the server. Expected failures
 * (a request the server refused, a request cancelled on purpose, browser
 * extensions, cross-origin "Script error.") are not reported.
 * Sending uses navigator.sendBeacon (survives the page closing), or fetch
 * with keepalive where that isn't available.
 */

export const CLIENT_ERRORS_ENDPOINT = '/api/client-errors'
export const MAX_REPORTS_PER_PAGE = 5
export const MAX_STACK_BYTES = 8 * 1024
const MAX_MESSAGE = 1000

let settings = null // set by installErrorReporting
let sentCount = 0
const sentKeys = new Set()

/** "https://shop.example/assets/a.js?v=1#x" → "https://shop.example/assets/a.js" inside any text. */
// A stack frame's ":line:column" after the query is kept.
const stripQueries = (text) => text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#)'"]*)[?#][^\s)'"]*?((?::\d+){0,2})(?=[\s)'"]|$)/gi, '$1$2')

/** Cuts text to at most `maxBytes` of UTF-8. */
export function cutToBytes(text, maxBytes) {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  return new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/�+$/, '')
}

const EXTENSION = /(chrome|moz|safari(-web)?)-extension:\/\//
const IGNORED_MESSAGES = [/^Script error\.?$/i, /ResizeObserver loop/i]

/** True for errors that aren't BuyNest bugs (or that the page already handles). */
function isIgnored(error, message, stack) {
  if (!message) return true
  if (error?.name === 'AbortError' || error?.name === 'ApiError') return true // cancelled on purpose / the server said no (shown in the page)
  if (IGNORED_MESSAGES.some((pattern) => pattern.test(message))) return true
  return Boolean(stack) && EXTENSION.test(stack) && !stack.includes(window.location.origin)
}

/** Whatever was thrown (usually an Error) → its message as text. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

/** An Error (or anything thrown) → { message, stack }. */
function describe(error, componentStack) {
  const stack = [error instanceof Error ? error.stack : '', componentStack ? `Component stack:${componentStack}` : ''].filter(Boolean).join('\n')
  return { message: stripQueries(messageOf(error) ?? '').trim().slice(0, MAX_MESSAGE), stack: cutToBytes(stripQueries(stack), MAX_STACK_BYTES) }
}

function send(body) {
  const text = JSON.stringify(body)
  try {
    // text/plain: a "simple" body the browser sends without asking first; the service parses it as JSON.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(CLIENT_ERRORS_ENDPOINT, new Blob([text], { type: 'text/plain;charset=UTF-8' }))) return
    }
    fetch(CLIENT_ERRORS_ENDPOINT, { method: 'POST', body: text, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'same-origin', keepalive: true }).catch(() => {})
  } catch {
    // Reporting must never cause an error of its own.
  }
}

/**
 * Reports one error (no-op until installErrorReporting has run, e.g. in
 * tests or the DummyJSON demo). `info.componentStack` comes from React.
 * Returns true when a report was sent.
 */
export function reportError(error, info = {}) {
  if (!settings || sentCount >= MAX_REPORTS_PER_PAGE) return false
  const { message, stack } = describe(error, info.componentStack)
  if (isIgnored(error, message, stack)) return false
  const key = `${message}\n${stack.split('\n').find((line) => /^\s+at |@/.test(line)) ?? ''}`
  if (sentKeys.has(key)) return false
  sentKeys.add(key)
  sentCount += 1
  send({
    message,
    ...(stack && { stack }),
    url: window.location.pathname, // the path only
    app: settings.app,
    ...(settings.release && { release: settings.release }),
  })
  return true
}

function handleError(event) {
  reportError(event.error ?? event.message)
}

function handleRejection(event) {
  reportError(event.reason)
}

/**
 * Starts reporting for this page load: app "store" or "admin", and the
 * release (build) name when there is one. Returns a function that stops it.
 */
export function installErrorReporting({ app = 'store', release } = {}) {
  settings = { app, release: typeof release === 'string' && /^[\w.+-]{1,64}$/.test(release) ? release : null }
  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleRejection)
  return () => {
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleRejection)
    settings = null
    sentCount = 0
    sentKeys.clear()
  }
}
