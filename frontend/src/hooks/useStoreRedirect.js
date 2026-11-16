import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { HAS_SEO, findRedirect } from '../services/seoService'
import { followRedirect } from '../utils/safeRedirect'

/**
 * For "not found" screens (phase 7): asks whether the admin redirected this
 * address (GET /api/catalog/redirects?path=…) and, if so, goes there,
 * replacing the history entry so Back skips the dead address. A deleted
 * product, a renamed category or page keeps working for old links.
 *
 * `checking` is true while the answer is pending or the redirect is being
 * followed: show a loader then, so "not found" doesn't flash by. Off (and
 * always false) with the DummyJSON demo, or when `enabled` is false.
 */
export function useStoreRedirect(enabled = true) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const active = HAS_SEO && enabled
  const request = useQuery({
    queryKey: ['redirect', pathname],
    queryFn: ({ signal }) => findRedirect(pathname, { signal }),
    enabled: active,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const target = active ? (request.data?.to ?? null) : null

  useEffect(() => {
    if (target) followRedirect(target, navigate)
  }, [target, navigate])

  return { checking: active && (request.isPending || Boolean(target)) }
}
