/*
 * Phase 9 §3: browser error reports from the admin app. Same rules and the
 * same body as the storefront's reporter (frontend/src/utils/errorReporting.js),
 * sent to BuyNest's own service on this origin, POST /api/client-errors
 * (frontend/server/clientErrorsApi.js), which checks it and forwards it to
 * the API (and from there to Sentry, tagged `client`). No third-party script.
 *
 * What is caught: render crashes (components/ErrorBoundary.jsx calls
 * reportError), window "error" events, and promises that failed with nobody
 * to catch them ("unhandledrejection").
 *
 * The body, and nothing else: { message, stack (≤ 8 KB), url (the PATH only,
 * never the query or fragment), app: "admin", release }. Never form values,
 * cookies, or anything read from the page.
 *
 * Politeness: the same error once, at most 5 reports per page load. Expected
 * failures (an ApiError the page shows, a cancelled request, browser
 * extensions, cross-origin "Script error.") aren't reported.
 */

export const CLIENT_ERRORS_ENDPOINT = '/api/client-errors'
export const MAX_REPORTS_PER_PAGE = 5
export const MAX_STACK_BYTES = 8 * 1024
const MAX_MESSAGE = 1000

let settings = null // set by installErrorReporting
let sentCount = 0
const sentKeys = new Set()

/** "https://shop.example/assets/a.js?v=1#x" → "https://shop.example/assets/a.js" inside any text. */
const stripQueries = (text) => text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#)'"]*)[?#][^\s)'"]*/gi, '$1')

/** Cuts text to at most `maxBytes` of UTF-8. */
export function cutToBytes(text, maxBytes) {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  return new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/�+$/, '')
}

const EXTENSION = /(chrome|moz|safari(-web)?)-extension:\/\//
const IGNORED_MESSAGES = [/^Script error\.?$/i, /ResizeObserver loop/i]

function isIgnored(error, message, stack) {
  if (!message) return true
  if (error?.name === 'AbortError' || error?.name === 'ApiError' || error?.name === 'TimeoutError') return true
  if (IGNORED_MESSAGES.some((pattern) => pattern.test(message))) return true
  return Boolean(stack) && EXTENSION.test(stack) && !stack.includes(window.location.origin)
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

function describe(error, componentStack) {
  const stack = [error instanceof Error ? error.stack : '', componentStack ? `Component stack:${componentStack}` : ''].filter(Boolean).join('\n')
  return { message: stripQueries(messageOf(error) ?? '').trim().slice(0, MAX_MESSAGE), stack: cutToBytes(stripQueries(stack), MAX_STACK_BYTES) }
}

function send(body) {
  const text = JSON.stringify(body)
  try {
    // text/plain: a "simple" body; the service parses it as JSON.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(CLIENT_ERRORS_ENDPOINT, new Blob([text], { type: 'text/plain;charset=UTF-8' }))) return
    }
    fetch(CLIENT_ERRORS_ENDPOINT, { method: 'POST', body: text, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'same-origin', keepalive: true }).catch(() => {})
  } catch {
    // Reporting must never cause an error of its own.
  }
}

/** Reports one error (no-op until installErrorReporting ran). Returns true when a report was sent. */
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
    app: 'admin',
    ...(settings.release && { release: settings.release }),
  })
  return true
}

const handleError = (event) => reportError(event.error ?? event.message)
const handleRejection = (event) => reportError(event.reason)

/** Starts reporting for this page load (release: the build's name, if any). Returns a function that stops it. */
export function installErrorReporting({ release } = {}) {
  settings = { release: typeof release === 'string' && /^[\w.+-]{1,64}$/.test(release) ? release : null }
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
