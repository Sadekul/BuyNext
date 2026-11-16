import { apiClient } from './apiClient'
import { apiProvider } from './providers'
import { safeRedirectTarget } from '../utils/safeRedirect'

/*
 * SEO helpers from BuyNest's Laravel API (backend phase 7, §5), through the
 * catalog service on this site's own address (server/catalogApi.js). The
 * DummyJSON demo has no redirects or search-term rules.
 */

/** URL redirects and search-term redirects exist only with BuyNest's own catalog. */
export const HAS_SEO = apiProvider.name === 'laravel'

/**
 * GET /api/catalog/redirects?path=/old-page → where the admin sends that
 * address ({ to, statusCode }), or null when no redirect matches. Only
 * call it when HAS_SEO (hooks/useStoreRedirect.js does).
 */
export async function findRedirect(path, { signal } = {}) {
  try {
    const answer = await apiClient.get('/api/catalog/redirects', { sameOrigin: true, params: { path }, signal })
    const to = safeRedirectTarget(answer?.data?.to_path)
    return to && to !== path ? { to, statusCode: answer.data.status_code === 302 ? 302 : 301 } : null
  } catch (error) {
    if (error?.status === 404) return null
    throw error
  }
}
