import { ALL_PRODUCTS, getProducts } from '../services/productService'
import { useFetch } from './useFetch'

/**
 * Re-checks saved products (cart, wishlist) against the API once per mount
 * and passes the fresh list to `onProducts`. DummyJSON can't fetch a list of
 * IDs, so one request for all products (card fields only) is cheaper than
 * one request per item. Returns { isLoading, error, retry }.
 */
export function useProductRefresh(key, { hasItems, onProducts }) {
  return useFetch(`refresh:${key}`, async (signal) => {
    if (!hasItems) return null
    const { items: products } = await getProducts({ limit: ALL_PRODUCTS, signal })
    if (!signal.aborted) onProducts(products)
    return null
  })
}
