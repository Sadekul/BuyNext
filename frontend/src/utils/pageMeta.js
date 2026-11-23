/*
 * Search-engine and link-preview tags for the current page: the meta
 * description, the canonical link, Open Graph (Facebook, LinkedIn, Slack,
 * WhatsApp…) and a Twitter card, plus "noindex" for pages that shouldn't be
 * listed (backend phase 7, §5).
 *
 * Why not React 19's <meta> hoisting? React ADDS a <meta> for every one it
 * renders and never merges them, so a page tag plus a default tag would give
 * two descriptions. Instead, each <PageMeta> registers a "layer" here, and
 * applyPageMeta() writes the single set of tags in <head>: the most recent
 * layer wins, the site defaults fill the gaps. The <title> itself still uses
 * React 19's <title> (it replaces the one in index.html).
 */

import { translate } from '../i18n'

export const DEFAULT_DESCRIPTION =
  'BuyNest — Your Modern Shopping Destination. Shop electronics, fashion, beauty, and home essentials.'
const SITE_NAME = 'BuyNest'

/*
 * Phase 13: the site's default description and title in the active language
 * (common:site.*). The default title replaces index.html's English one on
 * pages without their own <PageMeta title>, and follows a language switch.
 */
const defaultDescription = () => translate('common:site.description', { defaultValue: DEFAULT_DESCRIPTION })
const siteTitle = (lng) => `${SITE_NAME} — ${translate('common:site.tagline', lng ? { lng } : undefined)}`
const isDefaultTitle = (title) => title === siteTitle('en') || title === siteTitle('bn')
const DEFAULT_IMAGE = '/favicon.svg'

const layers = new Map() // id → { title, description, image, type, canonicalPath, noindex }
let nextId = 1

export const createPageMetaId = () => nextId++

export function setPageMetaLayer(id, meta) {
  layers.set(id, meta)
  applyPageMeta()
}

export function removePageMetaLayer(id) {
  if (layers.delete(id)) applyPageMeta()
}

/** Meta descriptions are best under ~160 characters, on one line. */
export function toDescription(text, max = 160) {
  if (typeof text !== 'string') return null
  const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return null
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

const absolute = (path) => {
  try {
    return new URL(path, window.location.origin).href
  } catch {
    return null
  }
}

/** Sets one tag's attribute, creating the tag when needed; `value` null removes the tag. */
function upsert(selector, create, attribute, value) {
  let element = document.head.querySelector(selector)
  if (value === null || value === undefined || value === '') {
    element?.remove()
    return
  }
  if (!element) {
    element = create()
    document.head.appendChild(element)
  }
  if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value)
}

const metaTag = (key, keyName) => () => {
  const element = document.createElement('meta')
  element.setAttribute(keyName, key)
  return element
}
const named = (name, value) => upsert(`meta[name="${name}"]`, metaTag(name, 'name'), 'content', value)
const property = (name, value) => upsert(`meta[property="${name}"]`, metaTag(name, 'property'), 'content', value)

/** The page's merged tags: the latest layer over the site defaults. */
export function currentPageMeta() {
  const latest = [...layers.values()].at(-1) ?? {}
  return {
    title: latest.title ?? null,
    description: latest.description || defaultDescription(),
    image: latest.image || DEFAULT_IMAGE,
    type: latest.type || 'website',
    canonicalPath: latest.canonicalPath ?? window.location.pathname,
    noindex: latest.noindex === true,
  }
}

/** Writes the tags into <head>. Safe to call often: unchanged tags are left alone. */
export function applyPageMeta() {
  if (typeof document === 'undefined') return
  const meta = currentPageMeta()
  if (!meta.title && isDefaultTitle(document.title) && document.title !== siteTitle()) document.title = siteTitle()
  // The page's own <title> (React renders it) when no layer names one.
  const title = meta.title ?? (document.title || SITE_NAME)
  const url = absolute(meta.canonicalPath)

  named('description', meta.description)
  named('robots', meta.noindex ? 'noindex' : null)
  upsert('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', meta.noindex ? null : url)
  property('og:site_name', SITE_NAME)
  property('og:type', meta.type)
  property('og:title', title)
  property('og:description', meta.description)
  property('og:url', url)
  property('og:image', absolute(meta.image))
  named('twitter:card', meta.image === DEFAULT_IMAGE ? 'summary' : 'summary_large_image')
}
