import { ALL_PRODUCTS, getProducts } from '../services/productService'
import { useCart } from './useCart'
import { useFetch } from './useFetch'

/**
 * Re-checks every cart item against the API (current price, stock, minimum
 * order) and updates the cart. DummyJSON can't fetch a list of IDs, so one
 * request for all products (card fields only) is cheaper than one per item.
 * Returns { isLoading, error, retry } for the "checking prices" message.
 */
export function useCartRefresh() {
  const { items, refreshProducts } = useCart()

  // Constant key: check once each time the cart page mounts. (Keying on the
  // item IDs would re-download the list after every removal.)
  return useFetch('cart-refresh', async (signal) => {
    if (items.length === 0) return null
    const { items: products } = await getProducts({ limit: ALL_PRODUCTS, signal })
    if (!signal.aborted) refreshProducts(products)
    return null
  })
}
