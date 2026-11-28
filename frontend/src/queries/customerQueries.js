import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query'
import { getAddresses, getReturn, getReturns } from '../services/customerService'
import { getMyReviews, getStockAlerts } from '../services/accountService'
import { getRewards } from '../services/rewardsService'

/*
 * The signed-in customer's address book and returns (REAL_SHOP). Like
 * orderKeys, the user id is part of every key, so one customer's cached data
 * is never shown to the next person who signs in on this device.
 */
export const customerKeys = {
  addresses: (userId) => ['account', userId, 'addresses'],
  returns: (userId) => ['account', userId, 'returns'],
  returnList: (userId, page) => ['account', userId, 'returns', 'list', page],
  returnDetail: (userId, number) => ['account', userId, 'returns', 'detail', number],
  stockAlerts: (userId) => ['account', userId, 'stock-alerts'],
  rewards: (userId, page) => ['account', userId, 'rewards', page],
  // Phase 23: everything about my reviews (the list, and "have I reviewed this product?") is under one key.
  reviews: (userId) => ['account', userId, 'reviews'],
  reviewList: (userId) => ['account', userId, 'reviews', 'list'],
  reviewOf: (userId, productId) => ['account', userId, 'reviews', 'product', String(productId)],
}

/** The address book; `authorizedRequest` (useAuth) renews the session on 401. */
export const addressesQuery = (userId, authorizedRequest) =>
  queryOptions({
    queryKey: customerKeys.addresses(userId),
    queryFn: async ({ signal }) => (await authorizedRequest(() => getAddresses({ signal }))).addresses,
    staleTime: 60_000,
  })

export const returnsQuery = (userId, authorizedRequest, page = 1) =>
  queryOptions({
    queryKey: customerKeys.returnList(userId, page),
    queryFn: ({ signal }) => authorizedRequest(() => getReturns({ page, signal })),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

export const returnQuery = (userId, number, authorizedRequest) =>
  queryOptions({
    queryKey: customerKeys.returnDetail(userId, number),
    queryFn: ({ signal }) => authorizedRequest(() => getReturn(number, { signal })),
    staleTime: 30_000,
  })

/** Phase 9: the customer's "email me when it's back" alerts. */
export const stockAlertsQuery = (userId, authorizedRequest) =>
  queryOptions({
    queryKey: customerKeys.stockAlerts(userId),
    queryFn: async ({ signal }) => (await authorizedRequest(() => getStockAlerts({ signal }))).alerts,
    staleTime: 30_000,
  })

/** Phase 11: the reward points balance and one page of its history (newest first). */
export const rewardsQuery = (userId, authorizedRequest, page = 1) =>
  queryOptions({
    queryKey: customerKeys.rewards(userId, page),
    queryFn: ({ signal }) => authorizedRequest(() => getRewards({ page, signal })),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

/** Phase 23: my reviews, newest first; "Show more reviews" appends the next page (10 a page). */
export const myReviewsQuery = (userId, authorizedRequest) =>
  infiniteQueryOptions({
    queryKey: customerKeys.reviewList(userId),
    queryFn: ({ pageParam, signal }) => authorizedRequest(() => getMyReviews({ page: pageParam, signal })),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
    staleTime: 30_000,
  })

/** Phase 23: my review of one product (the product page's "You've already reviewed this product"), or null. */
export const myReviewOfQuery = (userId, productId, authorizedRequest) =>
  queryOptions({
    queryKey: customerKeys.reviewOf(userId, productId),
    queryFn: async ({ signal }) => (await authorizedRequest(() => getMyReviews({ productId, signal }))).reviews?.[0] ?? null,
    staleTime: 30_000,
    retry: false,
  })
