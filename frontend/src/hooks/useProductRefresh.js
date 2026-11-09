import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { allProductsQuery } from '../queries/productQueries'

/**
 * Keeps saved products (cart, wishlist) in sync with the latest API data.
 * Uses the same cached "all products" query as the homepage, but always
 * refetches when the page opens (and again when you return to the tab), then
 * hands each fresh list to `onProducts`, which reconciles the saved items.
 */
export function useProductRefresh({ hasItems, onProducts }) {
  const query = useQuery({ ...allProductsQuery(), enabled: hasItems, refetchOnMount: 'always' })
  const { data } = query

  // Sync server data → the cart/wishlist store whenever a new list arrives.
  useEffect(() => {
    if (data) onProducts(data)
  }, [data, onProducts])

  return query
}
