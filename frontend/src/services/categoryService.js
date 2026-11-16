import { apiClient } from './apiClient'
import { apiProvider } from './providers'

/**
 * True when categories form a tree (BuyNest's API, phase 5: subcategories,
 * a navigation built from the store's categories). DummyJSON's are a flat list.
 */
export const HAS_CATEGORY_TREE = apiProvider.name === 'laravel'

/** Every category as `{ slug, name }`, whatever the backend. */
export async function getCategories({ signal } = {}) {
  const { path, params } = apiProvider.catalog.categories()
  return apiProvider.adapter.categories(await apiClient.get(path, { params, signal }))
}
