import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../services/apiClient'

/**
 * Retry policy: network problems, timeouts (status 0) and server errors
 * (5xx), plus 408/429, are worth retrying. Other 4xx errors (400, 401, 403,
 * 404) won't fix themselves, so retrying would only waste time.
 */
export function shouldRetry(failureCount, error) {
  const status = error instanceof ApiError ? error.status : 0
  const isClientError = status >= 400 && status < 500 && status !== 408 && status !== 429
  return !isClientError && failureCount < 2
}

/*
 * One QueryClient = one cache for all SERVER state (products, categories,
 * profile). Client state (cart, wishlist, UI) stays in React state/context.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000, // data is "fresh" for 1 minute: no refetch on remount
        gcTime: 5 * 60_000, // unused cache entries are removed after 5 minutes
        retry: shouldRetry, // waits 1s, then 2s between attempts (exponential backoff)
        refetchOnWindowFocus: true, // stale data refreshes when you return to the tab
      },
      mutations: {
        retry: false, // never repeat writes automatically (e.g. placing an order twice)
      },
    },
  })
}
