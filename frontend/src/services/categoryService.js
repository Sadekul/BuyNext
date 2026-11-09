import { apiClient } from './apiClient'
import { normalizeCategory } from './adapters/dummyJsonAdapter'

/** GET /products/categories — every category as `{ slug, name }`. */
export async function getCategories({ signal } = {}) {
  const data = await apiClient.get('/products/categories', { signal })
  return data.map(normalizeCategory)
}
