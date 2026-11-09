import { getCategories } from '../services/categoryService'
import { useFetch } from './useFetch'

const fetchCategories = (signal) => getCategories({ signal })

/** All product categories from the API: `{ data: [{ slug, name }], isLoading, error, retry }`. */
export function useCategories() {
  return useFetch('categories', fetchCategories)
}
