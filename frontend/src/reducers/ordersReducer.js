import { isTextRecord, storedInteger, storedNumber, storedTimestamp } from '../utils/storedValues'

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

const ADDRESS_KEYS = ['firstName', 'lastName', 'line1', 'city', 'state', 'postalCode', 'country']

const isMoney = (value) => storedNumber(value, 0) !== null

function isValidOrderItem(item) {
  return (
    Boolean(item) &&
    storedInteger(item.productId) !== null &&
    storedInteger(item.quantity, 1) !== null &&
    isMoney(item.price) &&
    typeof item.title === 'string' &&
    (item.thumbnail == null || typeof item.thumbnail === 'string') &&
    (item.discountPercentage == null || storedNumber(item.discountPercentage, 0, 100) !== null)
  )
}

/**
 * Validates stored orders field by field (every value the order pages
 * render). An order that doesn't match the expected shape is dropped rather
 * than crashing the orders pages on every visit.
 */
function isValidOrder(order) {
  const totals = order?.totals
  return (
    Boolean(order) &&
    typeof order.id === 'string' &&
    Number.isInteger(order.userId) &&
    storedTimestamp(order.placedAt) !== null &&
    typeof order.status === 'string' &&
    typeof order.paymentMethod === 'string' &&
    isTextRecord(order.contact, ['email', 'phone']) &&
    isTextRecord(order.shippingAddress, ADDRESS_KEYS, ['line2']) &&
    isTextRecord(order.billingAddress, ADDRESS_KEYS, ['line2']) &&
    isTextRecord(order.shippingMethod, ['id', 'label', 'eta']) &&
    Array.isArray(order.items) &&
    order.items.length > 0 &&
    order.items.every(isValidOrderItem) &&
    Boolean(totals) &&
    storedInteger(totals.itemCount, 0) !== null &&
    ['subtotal', 'discount', 'shipping', 'total'].every((key) => isMoney(totals[key])) &&
    (totals.couponCode == null || typeof totals.couponCode === 'string') &&
    (order.verification == null ||
      (['number', 'string'].includes(typeof order.verification.cartId) &&
        isMoney(order.verification.serverDiscountedTotal)))
  )
}

export function sanitizeOrders(value) {
  if (!value || !Array.isArray(value.orders)) return EMPTY_ORDERS
  return { orders: value.orders.filter(isValidOrder) }
}
