/*
 * URL redirects (docs/backend/PHASE7_CONTRACT.md §5): checks shared by the
 * Redirects screen and the "add a redirect" offer after a delete. The API
 * repeats them and has the last word.
 */
export const REDIRECT_CODES = [
  { value: 301, label: 'Permanent (301)' },
  { value: 302, label: 'Temporary (302)' },
]

/** A store path: starts with one "/", no query or fragment, no spaces. */
export const isFromPath = (value) => typeof value === 'string' && value.length <= 255 && /^\/(?!\/)[^\s?#]*$/.test(value)
/** Where it goes: a store path (query allowed) or an https:// address. */
export const isToPath = (value) => typeof value === 'string' && value.length <= 2048 && (/^\/(?!\/)\S*$/.test(value) || /^https:\/\/[^\s/]+\S*$/i.test(value))

export function redirectErrors({ fromPath, toPath }) {
  const errors = {}
  if (!isFromPath(fromPath)) errors.fromPath = ['Enter a store path starting with /, without ? or #, for example /old-sale.']
  if (!isToPath(toPath)) errors.toPath = ['Enter a store path starting with / or an https:// address.']
  else if (toPath === fromPath) errors.toPath = ['A redirect must go somewhere else.']
  return errors
}

/** The store addresses of things the admin deletes (the storefront's routes). */
export const storePaths = {
  product: (product) => `/products/${product.id}`,
  category: (category) => `/categories/${category.slug}`,
  page: (page) => `/pages/${page.slug}`,
}
