import { apiClient } from './apiClient'
import { apiProvider } from './providers'

/** Every category as `{ slug, name }`, whatever the backend. */
export async function getCategories({ signal } = {}) {
  const { path, params } = apiProvider.catalog.categories()
  return apiProvider.adapter.categories(await apiClient.get(path, { params, signal }))
}
