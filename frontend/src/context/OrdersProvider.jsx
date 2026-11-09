import { useCallback, useMemo } from 'react'
import { OrdersContext } from './ordersContext'
import { EMPTY_ORDERS, ORDER_ACTIONS, ordersReducer, sanitizeOrders } from '../reducers/ordersReducer'
import { usePersistentReducer } from '../hooks/usePersistentReducer'
import { useAuth } from '../hooks/useAuth'

const STORAGE_OPTIONS = {
  storageKey: 'buynest.orders.v1',
  emptyState: EMPTY_ORDERS,
  sanitize: sanitizeOrders,
  replaceActionType: ORDER_ACTIONS.REPLACED,
}

/*
 * Demo order history, saved in this browser and filtered by the signed-in
 * customer. A real store reads orders from the backend (GET /api/orders),
 * which only returns the authenticated customer's own orders.
 */
function OrdersProvider({ children }) {
  const [state, dispatch] = usePersistentReducer(ordersReducer, STORAGE_OPTIONS)
  const { user } = useAuth()
  const userId = user?.id ?? null

  const placeOrder = useCallback((order) => dispatch({ type: ORDER_ACTIONS.PLACED, order }), [dispatch])

  // Only the current customer's orders are ever exposed.
  const orders = useMemo(() => state.orders.filter((order) => order.userId === userId), [state.orders, userId])
  const getOrder = useCallback((orderId) => orders.find((order) => order.id === orderId) ?? null, [orders])

  const value = useMemo(() => ({ orders, getOrder, placeOrder }), [orders, getOrder, placeOrder])
  return <OrdersContext value={value}>{children}</OrdersContext>
}

export default OrdersProvider
