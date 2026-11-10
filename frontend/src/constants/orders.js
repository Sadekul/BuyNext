import { LuBan, LuCircleCheck, LuClock, LuPackage, LuPackageCheck, LuTruck } from 'react-icons/lu'

/*
 * Order statuses as icon + words (never colour alone). Real orders
 * (docs/backend/PHASE2_CONTRACT.md): pending_payment → processing → shipped
 * → delivered, or cancelled. Demo orders are 'placed'.
 */
export const ORDER_STATUSES = {
  placed: { label: 'Placed', icon: LuPackage },
  pending_payment: { label: 'Awaiting payment', icon: LuClock },
  processing: { label: 'Processing', icon: LuPackage },
  shipped: { label: 'Shipped', icon: LuTruck },
  delivered: { label: 'Delivered', icon: LuPackageCheck },
  cancelled: { label: 'Cancelled', icon: LuBan },
}

export const PAYMENT_STATUSES = {
  unpaid: { label: 'Not paid yet', icon: LuClock },
  paid: { label: 'Paid', icon: LuCircleCheck },
}

export const orderStatus = (status) => ORDER_STATUSES[status] ?? { label: status, icon: LuPackage }
export const paymentStatus = (status) => PAYMENT_STATUSES[status] ?? { label: status, icon: LuClock }

/**
 * What happens about payment, honestly: no payment provider is connected yet,
 * so card and PayPal orders wait for payment (nothing was charged).
 */
export function paymentNote(order) {
  if (order.paymentStatus === 'paid') return 'Payment received. Thank you.'
  if (order.status === 'cancelled') return 'This order was cancelled, so nothing will be charged.'
  if (order.paymentMethod === 'cod') return 'Pay the courier when your order arrives.'
  return "Nothing has been charged. Card and PayPal payments happen on the provider's secure page, which BuyNest hasn't connected yet: we'll email you about paying, and your items stay reserved meanwhile."
}
