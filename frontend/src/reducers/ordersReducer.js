/* Orders placed in this browser (simulated checkout). Newest first. */

export const ORDER_ACTIONS = {
  PLACED: 'orders/placed',
  REPLACED: 'orders/replaced',
}

export const EMPTY_ORDERS = { orders: [] }

export function ordersReducer(state, action) {
  switch (action.type) {
    case ORDER_ACTIONS.PLACED:
      if (state.orders.some((order) => order.id === action.order.id)) return state
      return { ...state, orders: [action.order, ...state.orders] }
    case ORDER_ACTIONS.REPLACED:
      return action.state
    default:
      return state
  }
}

export function sanitizeOrders(value) {
  if (!value || !Array.isArray(value.orders)) return EMPTY_ORDERS
  const orders = value.orders.filter(
    (order) =>
      order &&
      typeof order.id === 'string' &&
      Number.isInteger(order.userId) &&
      Array.isArray(order.items) &&
      typeof order.totals?.total === 'number',
  )
  return { orders }
}
