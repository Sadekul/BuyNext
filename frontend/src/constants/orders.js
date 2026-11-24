import { formatDate, moneyFormatter } from '../utils/formatters'
import { sslcommerzMethodName } from '../utils/payment'
import { translate } from '../i18n'
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
  // Phase 12: SSLCommerz flagged the payment (risk level 1): the store checks it before confirming.
  review: { label: 'Being checked', icon: LuClock },
  // Phase 14: cash on delivery with the delivery charge paid in advance; the rest is collected on delivery.
  partially_paid: { label: 'Partly paid', icon: LuClock },
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

// Phase 13: the labels and help texts shown are the shopper's language (orders:status.*, payment.*, returnStatus.*);
// the English ones above stay as the reference.
export const returnStatus = (status) =>
  RETURN_STATUSES[status]
    ? { ...RETURN_STATUSES[status], label: translate(`orders:returnStatus.${status}.label`), help: translate(`orders:returnStatus.${status}.help`) }
    : { label: status, icon: LuUndo2, help: '' }

export const orderStatus = (status) => (ORDER_STATUSES[status] ? { ...ORDER_STATUSES[status], label: translate(`orders:status.${status}`) } : { label: status, icon: LuPackage })
export const paymentStatus = (status) => (PAYMENT_STATUSES[status] ? { ...PAYMENT_STATUSES[status], label: translate(`orders:payment.${status}`) } : { label: status, icon: LuClock })

/**
 * What happens about payment, honestly. With Stripe (phase 8) card orders are
 * paid on Stripe's secure page ("Pay now"); without it, card and PayPal
 * orders wait until the store records the payment (nothing was charged).
 * `stripe`: the store takes card payments through Stripe (store settings).
 */
/** Phase 13: a payment note in the shopper's language (orders:notes.*). */
const n = (key, values) => translate(`orders:notes.${key}`, values)

export function paymentNote(order, { stripe = false, paypal = false, sslcommerz = false } = {}) {
  const byStripe = order.paymentMethod === 'card' && (order.paymentProvider === 'stripe' || stripe)
  // Phase 10: PayPal orders approved on PayPal's site, and orders paid in full by a gift card.
  const byPaypal = order.paymentMethod === 'paypal' && (order.paymentProvider === 'paypal' || paypal)
  // Phase 12: bKash, Nagad, and cards on SSLCommerz's page.
  const bySslcommerz = order.paymentMethod === 'sslcommerz' && (order.paymentProvider === 'sslcommerz' || sslcommerz)
  if (order.paymentMethod === 'gift_card' && order.paymentStatus === 'paid') return n('giftCard')
  // Phase 11: reward points paid the whole order.
  if (order.paymentMethod === 'reward_points' && order.paymentStatus === 'paid') return n('rewardPoints')
  if (order.paymentStatus === 'refunded') return n('refunded')
  if (order.paymentStatus === 'partially_refunded') return n('partlyRefunded')
  if (order.paymentStatus === 'paid' && order.paymentMethod === 'card' && order.paymentProvider === 'stripe') {
    return order.paidAt ? n('cardOn', { date: formatDate(order.paidAt) }) : n('card')
  }
  if (order.paymentStatus === 'paid' && order.paymentMethod === 'paypal' && order.paymentProvider === 'paypal') {
    return order.paidAt ? n('paypalOn', { date: formatDate(order.paidAt) }) : n('paypal')
  }
  if (order.paymentStatus === 'paid' && order.paymentMethod === 'sslcommerz' && order.paymentProvider === 'sslcommerz') {
    // "Paid with bKash (SSLCommerz) on Nov 19, 2026."
    const method = sslcommerzMethodName(order.payment)
    if (method) return order.paidAt ? n('sslMethodOn', { method, date: formatDate(order.paidAt) }) : n('sslMethod', { method })
    return order.paidAt ? n('sslOn', { date: formatDate(order.paidAt) }) : n('ssl')
  }
  // Phase 12: held for a check (SSLCommerz flagged the payment as risky): nothing to do for the shopper.
  if (order.paymentStatus === 'review') return n('review')
  // Phase 14: cash on delivery with the delivery charge paid online first; the rest in cash.
  const money = moneyFormatter(order.currency)
  if (order.paymentStatus === 'partially_paid') {
    const due = order.codDue ?? Math.max(0, (order.totals?.total ?? 0) - (order.advancePaid ?? 0))
    return order.advancePaid > 0 ? n('codPartlyPaid', { advance: money(order.advancePaid), due: money(due) }) : n('codDue', { due: money(due) })
  }
  if (order.paymentStatus === 'paid') return n('paid')
  if (order.status === 'cancelled') return n('cancelled')
  if (order.paymentMethod === 'cod' && order.status === 'pending_payment' && order.paymentProvider === 'sslcommerz') return n('codAdvanceDue')
  if (order.paymentMethod === 'cod' && order.codDue > 0) return n('codDue', { due: money(order.codDue) })
  if (order.paymentMethod === 'cod') return n('cod')
  if (byPaypal) return n('awaitPaypal')
  if (bySslcommerz) return n('awaitSslcommerz')
  if (byStripe) return n('awaitStripe')
  return n('manual')
}
