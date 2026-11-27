import { createHash, timingSafeEqual } from 'node:crypto'

/*
 * Online demo gate (2026-11-27, docs/DEMO.md). `npm run preview` can be shared through a
 * Cloudflare quick tunnel; the demo accounts' passwords are in this public repository, so
 * the whole site (store, admin and the sign-in service) sits behind one HTTP Basic password
 * while it is reachable from the internet.
 *
 * Active only when BUYNEST_DEMO_PASSWORD is set in the environment of the preview process
 * (demo.sh asks for it; it is never written to a file). Without it nothing changes, so
 * development, the unit tests and the browser suites behave exactly as before.
 *
 * Any user name is accepted; only the password counts, compared in constant time.
 * Demo pages also ask search engines not to index them.
 */
export const DEMO_REALM = 'BuyNest demo'
export const DEMO_HOSTS = ['.trycloudflare.com']

const digest = (text) => createHash('sha256').update(String(text), 'utf8').digest()

/** The password from an `Authorization: Basic …` header, or null. */
export function basicPassword(header) {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(header ?? '').trim())
  if (!match) return null
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  return colon === -1 ? null : decoded.slice(colon + 1)
}

/** True when the header carries the demo password (constant-time comparison of SHA-256 digests). */
export function demoPasswordMatches(header, password) {
  const given = basicPassword(header)
  if (given === null || !password) return false
  return timingSafeEqual(digest(given), digest(password))
}

/** Connect middleware for the preview server; `password` empty or missing → passes everything through. */
export function demoGateMiddleware(password) {
  return (req, res, next) => {
    if (!password) return next()
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    if (demoPasswordMatches(req.headers.authorization, password)) return next()
    res.statusCode = 401
    res.setHeader('WWW-Authenticate', `Basic realm="${DEMO_REALM}", charset="UTF-8"`)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end('This BuyNest demo is private. Ask the store owner for the demo password.\n')
  }
}
