import { LuArchive, LuBan, LuShieldAlert, LuCircleX, LuPackageOpen, LuStore, LuHeadset, LuCalendarClock, LuCircleCheck, LuCircleSlash, LuClock, LuLock, LuPackage, LuPackageCheck, LuPencilLine, LuTruck, LuUndo2 } from 'react-icons/lu'

/*
 * Order, payment, and product statuses for StatusBadge: icon + words, the
 * tone only adds colour. Rules from docs/backend/PHASE2_CONTRACT.md and
 * PHASE3_CONTRACT.md (closed, refunds, coupons).
 */
export const ORDER_STATUSES = {
  pending_payment: { label: 'Awaiting payment', tone: 'warning', icon: LuClock },
  processing: { label: 'Processing', tone: 'info', icon: LuPackage },
  shipped: { label: 'Shipped', tone: 'info', icon: LuTruck },
  delivered: { label: 'Delivered', tone: 'success', icon: LuPackageCheck },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: LuBan },
  closed: { label: 'Closed (refunded)', tone: 'neutral', icon: LuLock },
}

export const PAYMENT_STATUSES = {
  unpaid: { label: 'Unpaid', tone: 'warning', icon: LuClock },
  paid: { label: 'Paid', tone: 'success', icon: LuCircleCheck },
  partially_refunded: { label: 'Partly refunded', tone: 'warning', icon: LuUndo2 },
  refunded: { label: 'Refunded', tone: 'neutral', icon: LuUndo2 },
  // Phase 12 §3: SSLCommerz flagged the payment as risky (risk level 1): on hold until staff check it.
  review: { label: 'On hold (risk check)', tone: 'warning', icon: LuShieldAlert },
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

/**
 * What an admin may do with a real order (phase 3). Payment is recorded with
 * an invoice, shipping with a shipment, refunds with a credit memo; the plain
 * status change is left for "delivered" and "cancelled". The API refuses
 * anything else with a 422, whatever this shows.
 */
export function orderActions(order) {
  const invoiced = (order.invoices?.length ?? 0) > 0 || ['paid', 'partially_refunded', 'refunded'].includes(order.paymentStatus)
  const shipped = (order.shipments?.length ?? 0) > 0
  return {
    invoice: !invoiced && ['pending_payment', 'processing', 'shipped', 'delivered'].includes(order.status),
    // From processing only: a card/PayPal order is invoiced first; cash on delivery starts processing unpaid.
    ship: order.status === 'processing' && !shipped,
    deliver: order.status === 'shipped',
    refund: ['paid', 'partially_refunded'].includes(order.paymentStatus),
    // Once paid, money has to go back with a refund instead.
    cancel: ['pending_payment', 'processing'].includes(order.status) && !invoiced,
    // Phase 6: returns are for shipped or delivered orders with something left to return; staff may override the window.
    return: order.returnEligibility
      ? order.returnEligibility.eligible || order.returnEligibility.code === 'window_closed'
      : ['shipped', 'delivered'].includes(order.status) && shipped,
  }
}

/** Phase 8: paid by card through Stripe, so refunds go back to the card through Stripe. */
export const paidThroughStripe = (order) => order.payment?.provider === 'stripe' && Boolean(order.payment.reference || order.payment.paidAt)

/*
 * Phase 10 §3: PayPal works like Stripe (redirect approval, captured by the
 * server, refunds through PayPal first). The provider's name for messages.
 */
export const PAYMENT_PROVIDERS = { stripe: 'Stripe', paypal: 'PayPal', sslcommerz: 'SSLCommerz', gift_card: 'Gift card' }
export const providerName = (provider) => PAYMENT_PROVIDERS[provider] ?? provider ?? 'the payment provider'
/** Paid through PayPal (a capture exists), so refunds go back through PayPal. */
export const paidThroughPayPal = (order) => order.payment?.provider === 'paypal' && Boolean(order.payment.reference || order.payment.paidAt)
/** Phase 12 §3: paid through SSLCommerz (bKash, Nagad, cards), so refunds go back through SSLCommerz. */
export const paidThroughSslCommerz = (order) => order.payment?.provider === 'sslcommerz' && Boolean(order.payment.bankTranId || order.payment.reference || order.payment.paidAt)
/** The provider that took the money ('stripe' | 'paypal' | 'sslcommerz'), or null when staff record payments by hand. */
export const paidThroughProvider = (order) => (paidThroughStripe(order) ? 'stripe' : paidThroughPayPal(order) ? 'paypal' : paidThroughSslCommerz(order) ? 'sslcommerz' : null)

/*
 * Phase 12 §3: what the customer paid with on SSLCommerz's page, from its
 * card_type ("BKASH-BKash", "NAGAD-Nagad", "VISA-Dutch Bangla",
 * "DBBLMOBILEB-Dbbl Mobile Banking"). Known wallets by name, cards by brand.
 */
const SSLCOMMERZ_WALLETS = { BKASH: 'bKash', NAGAD: 'Nagad', ROCKET: 'Rocket', DBBLMOBILEB: 'Rocket', UPAY: 'Upay', TAP: 'Tap', OKWALLET: 'OK Wallet', MCASH: 'mCash', CELLFIN: 'CellFin' }
const CARD_BRANDS = { VISA: 'Visa card', MASTER: 'Mastercard', MASTERCARD: 'Mastercard', AMEX: 'American Express card', UNIONPAY: 'UnionPay card', DINERS: 'Diners Club card', JCB: 'JCB card' }
export function sslCommerzMethod(cardType, cardBrand) {
  const text = typeof cardType === 'string' ? cardType.trim() : ''
  const [prefix, ...rest] = text.split('-')
  const key = prefix.toUpperCase().replace(/[^A-Z]/g, '')
  if (SSLCOMMERZ_WALLETS[key]) return SSLCOMMERZ_WALLETS[key]
  const brand = typeof cardBrand === 'string' ? cardBrand.trim().toUpperCase() : ''
  if (CARD_BRANDS[key]) return rest.length > 0 && rest.join('-').trim() ? `${CARD_BRANDS[key]} (${rest.join('-').trim()})` : CARD_BRANDS[key]
  if (CARD_BRANDS[brand]) return CARD_BRANDS[brand]
  if (/IB$|BANK/.test(key)) return rest.join('-').trim() ? `Internet banking (${rest.join('-').trim()})` : 'Internet banking'
  return text || 'SSLCommerz'
}

/** Phase 12 §3: SSLCommerz's risk level: 0 = fine, 1 = risky (the order waits on hold). */
export const SSLCOMMERZ_RISK = { 0: { label: 'Low', tone: 'success' }, 1: { label: 'High: on hold', tone: 'warning' } }

/*
 * Phase 10 §5: what a gift card paid of the order and what can still go back
 * to it. A refund returns money to the card first, up to what it paid; the
 * rest goes back by the other payment method.
 */
export function giftCardSplit(order, totalCents, limits) {
  const card = order.giftCardPayment
  if (!card || !(card.amount > 0)) return null
  const left = limits?.giftCardRefundable ?? Math.max(card.amount - (card.refunded ?? 0), 0)
  const toCard = Math.min(Math.max(totalCents, 0), Math.round(left * 100))
  return { last4: card.last4 ?? null, toCardCents: toCard, otherCents: Math.max(totalCents - toCard, 0) }
}

export const CARRIERS = { dhl: 'DHL', fedex: 'FedEx', ups: 'UPS', usps: 'USPS', other: 'Other carrier' }

export const COUPON_TYPES = { percent: 'Percent off', fixed: 'Fixed amount off', free_shipping: 'Free shipping' }

export const COUPON_STATUSES = {
  active: { label: 'Active', tone: 'success', icon: LuCircleCheck },
  inactive: { label: 'Disabled', tone: 'neutral', icon: LuCircleSlash },
  scheduled: { label: 'Scheduled', tone: 'info', icon: LuCalendarClock },
  expired: { label: 'Expired', tone: 'warning', icon: LuClock },
  used_up: { label: 'Used up', tone: 'warning', icon: LuBan },
}
export const couponStatus = (status) => COUPON_STATUSES[status] ?? unknown(status)
export const COUPON_FILTERS = Object.fromEntries(Object.entries(COUPON_STATUSES).map(([status, { label }]) => [status, label]))

// Phase 10: gift_card = a gift card paid the whole order. Phase 11: reward_points = points (and maybe a gift card) did.
export const PAYMENT_METHODS = { card: 'Card', paypal: 'PayPal', sslcommerz: 'bKash, Nagad, cards (SSLCommerz)', cod: 'Cash on delivery', bank_transfer: 'Bank transfer', cash: 'Cash', gift_card: 'Gift card', reward_points: 'Reward points' }
/** Payment methods only admins may choose for an order they create (phase 6). */
export const ADMIN_ONLY_PAYMENT_METHODS = ['bank_transfer', 'cash']

/** Where an order came from (phase 6): the store's checkout, or an admin (phone order). */
export const ORDER_SOURCES = {
  storefront: { label: 'Storefront', tone: 'neutral', icon: LuStore },
  admin: { label: 'Admin', tone: 'info', icon: LuHeadset },
}
export const orderSource = (source) => ORDER_SOURCES[source] ?? ORDER_SOURCES.storefront

/*
 * Returns (RMA), docs/backend/PHASE6_CONTRACT.md §6:
 * requested → approved | rejected, approved → received, received → refunded | closed.
 * `refunded` is set by the credit memo ("Refund this return").
 */
export const RETURN_STATUSES = {
  requested: { label: 'Requested', tone: 'warning', icon: LuClock },
  approved: { label: 'Approved', tone: 'info', icon: LuCircleCheck },
  rejected: { label: 'Rejected', tone: 'neutral', icon: LuCircleX },
  received: { label: 'Received', tone: 'info', icon: LuPackageOpen },
  refunded: { label: 'Refunded', tone: 'success', icon: LuUndo2 },
  closed: { label: 'Closed', tone: 'neutral', icon: LuLock },
}
export const returnStatus = (status) => RETURN_STATUSES[status] ?? unknown(status)
/** The status moves a return allows (besides the refund, which is a credit memo). */
export const RETURN_MOVES = { requested: ['approved', 'rejected'], approved: ['received'], received: ['closed'] }
export const RETURN_CONDITIONS = { unopened: 'Unopened', opened: 'Opened', damaged: 'Damaged' }
export const RETURN_RESOLUTIONS = { refund: 'Refund', replace: 'Replacement' }
