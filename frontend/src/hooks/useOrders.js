import { useContext } from 'react'
import { OrdersContext } from '../context/ordersContext'

/** The signed-in customer's orders. Throws outside <OrdersProvider>. */
export function useOrders() {
  const orders = useContext(OrdersContext)
  if (!orders) throw new Error('useOrders() must be used inside <OrdersProvider>.')
  return orders
}
