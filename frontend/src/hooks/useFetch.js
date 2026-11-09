import { useEffect, useEffectEvent, useState } from 'react'
import { isAbortError } from '../services/apiClient'

/**
 * Runs `fetcher(signal)` whenever `key` changes and reports its progress.
 *
 *   const { data, error, isLoading, retry } = useFetch('categories', getCategoriesFn)
 *
 * - key: a string that identifies the request. A new key = a new request.
 * - fetcher: async (signal) => data. `signal` lets us cancel the request.
 *
 * Phase 11 replaces this hand-made hook with TanStack Query, which adds caching.
 */
export function useFetch(key, fetcher) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState({ requestId: null, data: undefined, error: null })

  // Changing the key or retrying produces a new request id.
  const requestId = `${key}#${attempt}`

  // useEffectEvent reads the latest `fetcher` without making it an effect
  // dependency, so callers don't have to memoize the function they pass.
  const runFetcher = useEffectEvent((signal) => fetcher(signal))

  useEffect(() => {
    const controller = new AbortController()

    runFetcher(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ requestId, data, error: null })
      })
      .catch((error) => {
        if (!isAbortError(error)) setResult({ requestId, data: undefined, error })
      })

    // Cleanup: cancel the request if the key changes or the component unmounts,
    // so a slow old response can never overwrite newer data.
    return () => controller.abort()
  }, [requestId])

  // A result only counts if it belongs to the current request.
  const isCurrent = result.requestId === requestId

  return {
    data: isCurrent ? result.data : undefined,
    error: isCurrent ? result.error : null,
    isLoading: !isCurrent,
    retry: () => setAttempt((count) => count + 1),
  }
}
