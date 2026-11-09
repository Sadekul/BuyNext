import { useCallback, useMemo } from 'react'
import { OrdersContext } from './ordersContext'
import {
  EMPTY_ORDERS,
  ORDER_ACTIONS,
  hasNoOrders,
  mergeOrders,
  ordersReducer,
  sanitizeOrders,
  takeOrdersOfCustomer,
} from '../reducers/ordersReducer'
import { usePersistentReducer } from '../hooks/usePersistentReducer'
import { useAuth } from '../hooks/useAuth'
import { STORAGE_KEYS } from '../constants/storageKeys'

const STORAGE_OPTIONS = {
  storageKey: STORAGE_KEYS.orders,
  emptyState: EMPTY_ORDERS,
  sanitize: sanitizeOrders,
  replaceActionType: ORDER_ACTIONS.REPLACED,
  // Guests can't place orders: the base key only holds the old shared list.
  mergeGuest: mergeOrders,
  takeGuest: takeOrdersOfCustomer,
  isEmpty: hasNoOrders,
}

/*
 * Demo order history, saved in this browser per account (and filtered by the
 * signed-in customer as a second check). A real store reads orders from the
 * backend (GET /api/orders), which only returns the customer's own orders.
 */
function OrdersProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [state, dispatch] = usePersistentReducer(ordersReducer, STORAGE_OPTIONS, userId)

  const placeOrder = useCallback((order) => dispatch({ type: ORDER_ACTIONS.PLACED, order }), [dispatch])

  // Only the current customer's orders are ever exposed.
  const orders = useMemo(() => state.orders.filter((order) => order.userId === userId), [state.orders, userId])
  const getOrder = useCallback((orderId) => orders.find((order) => order.id === orderId) ?? null, [orders])

  const value = useMemo(() => ({ orders, getOrder, placeOrder }), [orders, getOrder, placeOrder])
  return <OrdersContext value={value}>{children}</OrdersContext>
}

export default OrdersProvider
