import { ROUTES } from '../constants/routes'

/**
 * Only same-site paths ("/checkout"). Rejects full URLs and "//other-site.com";
 * browsers read a backslash as a slash, so "/\other-site.com" too.
 */
export function safeRedirectPath(path) {
  return typeof path === 'string' && /^\/(?![/\\])/.test(path) ? path : ROUTES.account
}

/**
 * Where an admin-made redirect may send the shopper (URL redirects and search
 * term redirects, phase 7): a store path ("/deals", never "//other.site") or
 * an https:// address. Anything else gives null and is ignored.
 */
export function safeRedirectTarget(value) {
  if (typeof value !== 'string' || value.length > 2048) return null
  if (/^\/(?![/\\])[^\s]*$/.test(value)) return value
  return /^https:\/\/[^\s/?#]+[^\s]*$/i.test(value) ? value : null
}

/** Goes to a safe redirect target: in-app paths through the router, other sites with a full load. */
export function followRedirect(target, navigate) {
  if (target.startsWith('/')) navigate(target, { replace: true })
  else window.location.replace(target)
}
