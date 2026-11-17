import { clientIp, json, laravel, readLimitedBody } from './http.js'

/*
 * Browser error reports (phase 9), at POST /api/client-errors on the store's
 * own address. The storefront and the admin app (both on this origin) send
 * what crashed: a React error boundary, window.onerror, or a promise nobody
 * caught. This service checks and trims the report and forwards it to the
 * Laravel API (POST /api/v1/client-errors, with the shared key), which
 * passes it to Sentry tagged `client`. The browser never talks to Sentry
 * itself: no third-party script, and the Content-Security-Policy stays as it is.
 *
 *   POST /api/client-errors { message, stack?, url, app: "store" | "admin", release? } → 202 { ok: true }
 *
 * Defence in depth (the browser side caps and deduplicates too, but anyone
 * can call this):
 *   - the body is at most 16 KB (bigger → 413, without reading the rest);
 *   - only the five fields above go on, each trimmed: message ≤ 1,000
 *     characters, stack ≤ 8 KB, url = the PATH only (no query or fragment,
 *     which can hold tokens or emails), release ≤ 64 safe characters;
 *   - query strings and fragments in addresses inside the message and stack
 *     are removed, and anything that looks like an email address or a card
 *     number is masked;
 *   - each visitor (IP address) may send 10 reports a minute, and the same
 *     report once a minute; extra reports are dropped silently (still 202, so
 *     a looping error doesn't turn into a storm of failing requests).
 * The limits are kept in this server's memory, so on serverless hosts they
 * apply per running instance: a brake, not a guarantee. The API applies its
 * own rate limit behind it.
 */

export const MAX_BODY_BYTES = 16 * 1024
export const MAX_STACK_BYTES = 8 * 1024
const MAX_MESSAGE = 1000
const WINDOW_MS = 60_000
export const PER_VISITOR = 10
const MAX_TRACKED = 5000 // visitors and report fingerprints remembered at once
const APPS = ['store', 'admin']

const accepted = () => json({ ok: true }, 202)

// ---- scrubbing ----

/** "https://shop.example/a?b=1#c" → "https://shop.example/a" inside any text. */
// A stack frame's ":line:column" after the query is kept.
const stripQueries = (text) => text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#)'"]*)[?#][^\s)'"]*?((?::\d+){0,2})(?=[\s)'"]|$)/gi, '$1$2')
const maskEmails = (text) => text.replace(/[^\s@<>()'"]+@[^\s@<>()'"]+\.[a-z]{2,}/gi, '[email]')
const maskCards = (text) => text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, '[number]')
export const scrub = (text) => maskCards(maskEmails(stripQueries(text)))

/** Cuts a string to at most `maxBytes` of UTF-8 (never in the middle of a character). */
export function cutBytes(text, maxBytes) {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  return new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/�+$/, '')
}

/** A page address (absolute or a path) → its path only, or null. */
export function pathOnly(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const { pathname } = new URL(value.trim(), 'https://store.invalid')
    return pathname.slice(0, 300)
  } catch {
    return null
  }
}

/** The browser's report → the fields the API gets, or null when it isn't a report. */
export function toReport(body) {
  const message = typeof body?.message === 'string' ? scrub(body.message.trim()).slice(0, MAX_MESSAGE) : ''
  const app = APPS.includes(body?.app) ? body.app : null
  if (!message || !app) return null
  const stack = typeof body.stack === 'string' && body.stack.trim() ? cutBytes(scrub(body.stack.trim()), MAX_STACK_BYTES) : null
  const release = typeof body.release === 'string' && /^[\w.+-]{1,64}$/.test(body.release) ? body.release : null
  return { message, stack, url: pathOnly(body.url) ?? '/', app, release }
}

// ---- per-visitor limits (in memory) ----

const visitors = new Map() // ip → { count, resetAt }
const recent = new Map() // ip + fingerprint → time sent

function forget(map, now, isOld) {
  if (map.size < MAX_TRACKED) return
  for (const [key, value] of map) if (isOld(value, now)) map.delete(key)
  // Still full (a flood of distinct visitors): drop the oldest half.
  if (map.size >= MAX_TRACKED) [...map.keys()].slice(0, MAX_TRACKED / 2).forEach((key) => map.delete(key))
}

/** True when this visitor may send this report now (and counts it). */
export function allow(visitor, report, now = Date.now()) {
  forget(visitors, now, (entry, time) => entry.resetAt <= time)
  forget(recent, now, (sentAt, time) => time - sentAt >= WINDOW_MS)

  const fingerprint = `${visitor}\n${report.app}\n${report.message}\n${report.stack?.split('\n', 2).join('\n') ?? ''}`
  const sentAt = recent.get(fingerprint)
  if (sentAt !== undefined && now - sentAt < WINDOW_MS) return false

  const entry = visitors.get(visitor)
  if (!entry || entry.resetAt <= now) visitors.set(visitor, { count: 1, resetAt: now + WINDOW_MS })
  else if (entry.count >= PER_VISITOR) return false
  else entry.count += 1

  recent.set(fingerprint, now)
  return true
}

/** Tests: start with empty limits. */
export function resetClientErrorLimits() {
  visitors.clear()
  recent.clear()
}

export async function handleClientErrorRequest(request) {
  if (request.method !== 'POST') return json({ message: 'Not found.' }, 404)
  const { bytes, tooLarge } = await readLimitedBody(request, MAX_BODY_BYTES)
  if (tooLarge) return json({ message: 'The report is too large.' }, 413)

  let body
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) // sendBeacon sends text/plain: the type isn't checked
  } catch {
    return json({ message: 'The report could not be read.' }, 400)
  }
  const report = toReport(body)
  if (!report) return json({ message: 'The report could not be read.' }, 422)

  if (!allow(clientIp(request) ?? 'unknown', report)) return accepted()
  // Whatever the API answers, the browser hears 202: a report is best effort.
  // (Awaited: a serverless function may stop as soon as it has answered.)
  await laravel('/api/v1/client-errors', { method: 'POST', request, body: report })
  return accepted()
}
