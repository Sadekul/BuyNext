import { ALL_PRODUCTS, getProducts, getProductsByCategory, searchProducts } from '../services/productService'
import { useFetch } from './useFetch'

/**
 * Every product in the current scope — all products, one category, or one
 * search — so client-side filters see the complete set (see utils/catalog.js).
 * Search and category are still filtered on the SERVER; the rest on the client.
 */
export function useCatalogProducts({ searchQuery, categorySlug }) {
  const key = `catalog:${searchQuery ? `q=${searchQuery}` : `category=${categorySlug ?? 'all'}`}`

  return useFetch(key, async (signal) => {
    const options = { limit: ALL_PRODUCTS, signal }
    if (searchQuery) return (await searchProducts(searchQuery, options)).items
    if (categorySlug) return (await getProductsByCategory(categorySlug, options)).items
    return (await getProducts(options)).items
  })
}
