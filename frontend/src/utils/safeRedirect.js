import { ROUTES } from '../constants/routes'

/**
 * Only same-site paths ("/checkout"). Rejects full URLs and "//other-site.com";
 * browsers read a backslash as a slash, so "/\other-site.com" too.
 */
export function safeRedirectPath(path) {
  return typeof path === 'string' && /^\/(?![/\\])/.test(path) ? path : ROUTES.account
}
