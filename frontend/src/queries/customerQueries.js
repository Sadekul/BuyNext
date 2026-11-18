import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { getAddresses, getReturn, getReturns } from '../services/customerService'
import { getStockAlerts } from '../services/accountService'
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
