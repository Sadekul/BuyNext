import { apiClient } from './apiClient'
import { normalizeHome, normalizePage, normalizeStoreSettings } from './adapters/contentAdapter'

/*
 * The admin's CMS content and store settings from BuyNest's Laravel API,
 * through the catalog service on this site's own address (/api/catalog →
 * /api/v1, frontend/server/catalogApi.js). REAL_SHOP only: the demo keeps
 * its static content (data/homeContent.js, constants/store.js).
 */

const CATALOG = { sameOrigin: true }

/** GET /api/catalog/home → { hero, banners, featuredProducts }. */
export async function getHomeContent({ signal } = {}) {
  return normalizeHome(await apiClient.get('/api/catalog/home', { ...CATALOG, signal }))
}

/** GET /api/catalog/pages/:slug → a published CMS page. ApiError 404 when unknown or unpublished. */
export async function getCmsPage(slug, { signal } = {}) {
  return normalizePage(await apiClient.get(`/api/catalog/pages/${encodeURIComponent(slug)}`, { ...CATALOG, signal }))
}

/** GET /api/catalog/store → the shipping, payment, country, and checkout rules the server applies. */
export async function getStoreSettings({ signal } = {}) {
  return normalizeStoreSettings(await apiClient.get('/api/catalog/store', { ...CATALOG, signal }))
}
