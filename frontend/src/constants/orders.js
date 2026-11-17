import { formatDate } from '../utils/formatters'
import { LuBan, LuCircleCheck, LuCircleX, LuClock, LuLock, LuPackage, LuPackageCheck, LuPackageOpen, LuUndo2, LuTruck } from 'react-icons/lu'

/*
 * Order statuses as icon + words (never colour alone). Real orders
 * (docs/backend/PHASE2_CONTRACT.md): pending_payment → processing → shipped
 * → delivered, or cancelled; closed once fully refunded (phase 3). Demo orders are 'placed'.
 */
export const ORDER_STATUSES = {
  placed: { label: 'Placed', icon: LuPackage },
  pending_payment: { label: 'Awaiting payment', icon: LuClock },
  processing: { label: 'Processing', icon: LuPackage },
  shipped: { label: 'Shipped', icon: LuTruck },
  delivered: { label: 'Delivered', icon: LuPackageCheck },
  cancelled: { label: 'Cancelled', icon: LuBan },
  closed: { label: 'Closed (refunded)', icon: LuLock },
}

export const PAYMENT_STATUSES = {
  unpaid: { label: 'Not paid yet', icon: LuClock },
  paid: { label: 'Paid', icon: LuCircleCheck },
  partially_refunded: { label: 'Partly refunded', icon: LuUndo2 },
  refunded: { label: 'Refunded', icon: LuUndo2 },
}

/*
 * Return (RMA) statuses (docs/backend/PHASE6_CONTRACT.md §6):
 * requested → approved | rejected, approved → received, received → refunded | closed.
 * `help` says what happens next, in the customer's words.
 */
export const RETURN_STATUSES = {
  requested: { label: 'Requested', icon: LuClock, help: "We've received your request and will reply by email, usually within two business days." },
  approved: { label: 'Approved', icon: LuCircleCheck, help: 'Your return was approved. Send the items back as described in our email; we will let you know when they arrive.' },
  rejected: { label: 'Not approved', icon: LuCircleX, help: "We couldn't accept this return. Our email explains why; reply to it if you have questions." },
  received: { label: 'Items received', icon: LuPackageOpen, help: "The items arrived and we're checking them. Your refund or replacement follows." },
  refunded: { label: 'Refunded', icon: LuUndo2, help: 'Refunded by the method you paid with; your bank may take a few days to show it.' },
  closed: { label: 'Closed', icon: LuLock, help: 'This return is complete.' },
}

export const returnStatus = (status) => RETURN_STATUSES[status] ?? { label: status, icon: LuUndo2, help: '' }

export const orderStatus = (status) => ORDER_STATUSES[status] ?? { label: status, icon: LuPackage }
export const paymentStatus = (status) => PAYMENT_STATUSES[status] ?? { label: status, icon: LuClock }

/**
 * What happens about payment, honestly. With Stripe (phase 8) card orders are
 * paid on Stripe's secure page ("Pay now"); without it, card and PayPal
 * orders wait until the store records the payment (nothing was charged).
 * `stripe`: the store takes card payments through Stripe (store settings).
 */
export function paymentNote(order, { stripe = false } = {}) {
  const byStripe = order.paymentMethod === 'card' && (order.paymentProvider === 'stripe' || stripe)
  if (order.paymentStatus === 'refunded') return 'Your payment was refunded in full, by the same method you paid with.'
  if (order.paymentStatus === 'partially_refunded') return 'Part of your payment was refunded, by the same method you paid with. See the refunds below.'
  if (order.paymentStatus === 'paid' && order.paymentMethod === 'card' && order.paymentProvider === 'stripe') {
    return order.paidAt ? `Paid by card on ${formatDate(order.paidAt)}. Thank you.` : 'Paid by card. Thank you.'
  }
  if (order.paymentStatus === 'paid') return 'Payment received. Thank you.'
  if (order.status === 'cancelled') return 'This order was cancelled, so nothing will be charged.'
  if (order.paymentMethod === 'cod') return 'Pay the courier when your order arrives.'
  if (byStripe) return "Awaiting payment: nothing has been charged yet. Pay by card on Stripe's secure page; BuyNest never sees your card number. If the payment isn't completed in time, the order is cancelled and the items are released."
  return "Nothing has been charged. Card and PayPal payments happen on the provider's secure page, which BuyNest hasn't connected yet: we'll email you about paying, and your items stay reserved meanwhile."
}
