import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { isAbortError } from '../services/apiClient'
import { getProducts, getProductsByCategory, searchProducts } from '../services/productService'
import { PRODUCTS_PER_PAGE } from '../constants/catalog'

/** Picks the right endpoint: search beats category; otherwise all products. */
function fetchProductPage({ searchQuery, categorySlug, sortOption, skip, signal }) {
  const options = { limit: PRODUCTS_PER_PAGE, skip, sortBy: sortOption.sortBy, order: sortOption.order, signal }
  if (searchQuery) return searchProducts(searchQuery, options)
  if (categorySlug) return getProductsByCategory(categorySlug, options)
  return getProducts(options)
}

/**
 * Paginated product list with "load more".
 * The first page loads whenever search/category/sort changes; later pages
 * load on demand and are appended to the list.
 */
export function useProductList({ searchQuery, categorySlug, sortOption }) {
  const [attempt, setAttempt] = useState(0)
  const [list, setList] = useState({ requestId: null, products: [], total: 0, error: null })
  const [loadMore, setLoadMore] = useState({ requestId: null, isLoading: false, error: null })
  const loadMoreControllerRef = useRef(null)

  const requestId = JSON.stringify([searchQuery, categorySlug, sortOption.value, attempt])
  const fetchFirstPage = useEffectEvent((signal) =>
    fetchProductPage({ searchQuery, categorySlug, sortOption, skip: 0, signal }),
  )

  useEffect(() => {
    const controller = new AbortController()

    fetchFirstPage(controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setList({ requestId, products: page.items, total: page.total, error: null })
        }
      })
      .catch((error) => {
        if (!isAbortError(error)) setList({ requestId, products: [], total: 0, error })
      })

    return () => {
      controller.abort()
      loadMoreControllerRef.current?.abort() // a pending "load more" belongs to the old list
    }
  }, [requestId])

  // Event handler, not an effect: it runs because the user clicked a button.
  async function loadNextPage() {
    const controller = new AbortController()
    loadMoreControllerRef.current = controller
    setLoadMore({ requestId, isLoading: true, error: null })

    try {
      const page = await fetchProductPage({
        searchQuery,
        categorySlug,
        sortOption,
        skip: list.products.length,
        signal: controller.signal,
      })
      // Updater function: build on the latest state, never mutate it.
      setList((current) => ({ ...current, products: [...current.products, ...page.items], total: page.total }))
      setLoadMore({ requestId, isLoading: false, error: null })
    } catch (error) {
      if (!isAbortError(error)) setLoadMore({ requestId, isLoading: false, error })
    }
  }

  const isCurrent = list.requestId === requestId
  const isLoadMoreCurrent = loadMore.requestId === requestId
  const products = isCurrent ? list.products : []
  const total = isCurrent ? list.total : 0

  return {
    products,
    total,
    isLoading: !isCurrent,
    error: isCurrent ? list.error : null,
    retry: () => setAttempt((count) => count + 1),
    hasMore: isCurrent && products.length < total,
    loadNextPage,
    isLoadingMore: isLoadMoreCurrent && loadMore.isLoading,
    loadMoreError: isLoadMoreCurrent ? loadMore.error : null,
  }
}
