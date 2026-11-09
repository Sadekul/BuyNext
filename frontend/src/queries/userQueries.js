import { queryOptions } from '@tanstack/react-query'
import { getCurrentUser } from '../services/authService'

export const userKeys = {
  all: ['profile'],
  profile: (userId) => ['profile', userId],
}

/**
 * The signed-in customer's profile (GET /api/auth/me). `authorizedRequest`
 * comes from useAuth() and renews the session on 401.
 */
export const profileQuery = (userId, authorizedRequest) =>
  queryOptions({
    queryKey: userKeys.profile(userId),
    queryFn: ({ signal }) => authorizedRequest(() => getCurrentUser({ signal })),
    staleTime: 5 * 60_000,
  })
