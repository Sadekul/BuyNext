import { queryOptions } from '@tanstack/react-query'
import { getCurrentUser } from '../services/authService'

export const userKeys = {
  all: ['profile'],
  profile: (userId) => ['profile', userId],
}

/**
 * The signed-in customer's profile (GET /auth/me). `authorizedRequest`
 * comes from useAuth() and handles token refresh on 401.
 */
export const profileQuery = (userId, authorizedRequest) =>
  queryOptions({
    queryKey: userKeys.profile(userId),
    queryFn: ({ signal }) => authorizedRequest((token) => getCurrentUser(token, { signal })),
    staleTime: 5 * 60_000,
  })
