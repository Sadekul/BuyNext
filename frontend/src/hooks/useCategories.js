import { useQuery } from '@tanstack/react-query'
import { categoriesQuery } from '../queries/productQueries'

/** All product categories (cached for an hour, shared by every component that asks). */
export function useCategories() {
  return useQuery(categoriesQuery())
}
