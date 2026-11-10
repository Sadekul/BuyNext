import { LuArchive, LuBan, LuCircleCheck, LuClock, LuPackage, LuPackageCheck, LuPencilLine, LuTruck } from 'react-icons/lu'

/*
 * Order, payment, and product statuses for StatusBadge: icon + words, the
 * tone only adds colour. Rules from docs/backend/PHASE2_CONTRACT.md.
 */
export const ORDER_STATUSES = {
  pending_payment: { label: 'Awaiting payment', tone: 'warning', icon: LuClock },
  processing: { label: 'Processing', tone: 'info', icon: LuPackage },
  shipped: { label: 'Shipped', tone: 'info', icon: LuTruck },
  delivered: { label: 'Delivered', tone: 'success', icon: LuPackageCheck },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: LuBan },
}

export const PAYMENT_STATUSES = {
  unpaid: { label: 'Unpaid', tone: 'warning', icon: LuClock },
  paid: { label: 'Paid', tone: 'success', icon: LuCircleCheck },
}

export const PRODUCT_STATUSES = {
  active: { label: 'Active', tone: 'success', icon: LuCircleCheck },
  draft: { label: 'Draft', tone: 'neutral', icon: LuPencilLine },
  archived: { label: 'Archived', tone: 'neutral', icon: LuArchive },
}

const unknown = (status) => ({ label: status ?? 'Unknown', tone: 'neutral', icon: LuClock })
export const orderStatus = (status) => ORDER_STATUSES[status] ?? unknown(status)
export const paymentStatus = (status) => PAYMENT_STATUSES[status] ?? unknown(status)
export const productStatus = (status) => PRODUCT_STATUSES[status] ?? unknown(status)

/** The status changes an admin may make (the API refuses anything else with a 422). */
export const NEXT_STATUSES = {
  pending_payment: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}

/** Button labels for each target status. */
export const STATUS_ACTIONS = {
  processing: 'Start processing',
  shipped: 'Mark as shipped',
  delivered: 'Mark as delivered',
  cancelled: 'Cancel order',
}

export const PAYMENT_METHODS = { card: 'Card', paypal: 'PayPal', cod: 'Cash on delivery' }
