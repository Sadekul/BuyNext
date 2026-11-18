import { SESSION_KEYS } from '../constants/storageKeys'
import { isTextRecord } from './storedValues'

/*
 * Card payments on Stripe's hosted page (docs/backend/PHASE8_CONTRACT.md §1).
 * BuyNest never sees card details: the shopper leaves for Stripe Checkout (a
 * top-level navigation) and comes back to /order-confirmation/:number with
 * ?payment=success or ?payment=cancelled. The order is only marked paid when
 * Stripe's signed webhook reaches the API.
 */

/** Leaving for the payment page. An object, so tests can replace `open` (jsdom can't navigate). */
export const paymentPage = {
  open(url) {
    window.location.assign(url)
  },
}

/** Only https addresses (Stripe's or PayPal's page) are followed (the shop service already drops anything else). */
export const isPaymentUrl = (url) => typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url)

/**
 * Whether "Pay now" can start a new payment: an unpaid card order that is
 * still waiting for its payment, in a store that takes card payments through
 * Stripe, or (phase 10) a PayPal order in a store connected to PayPal. The
 * API's own `canPay` wins when it sends one; it refuses (422) anything else anyway.
 */
export function canPayOrder(order, cardPayments, paypalPayments = 'manual') {
  if (!order || order.isSimulated) return false
  if (typeof order.canPay === 'boolean') return order.canPay
  if (order.paymentStatus !== 'unpaid' || order.status !== 'pending_payment') return false
  if (order.paymentMethod === 'card') return order.paymentProvider === 'stripe' || cardPayments === 'stripe'
  if (order.paymentMethod === 'paypal') return order.paymentProvider === 'paypal' || paypalPayments === 'paypal'
  return false
}

// sessionStorage can be missing or throw (private windows, blocked storage): every access is guarded.
function readPending() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(SESSION_KEYS.pendingPayment))
    return isTextRecord(value, ['number', 'email']) ? value : null
  } catch {
    return null
  }
}

/** A guest is leaving to pay: keep the order's number and email for the way back (this tab only). */
export function rememberGuestPayment(number, email) {
  try {
    window.sessionStorage.setItem(SESSION_KEYS.pendingPayment, JSON.stringify({ number, email }))
  } catch {
    // Without storage the guest can still find the order with "Track your order".
  }
}

/** The email a guest paid this order with, in this tab, or null. */
export function guestPaymentEmail(number) {
  const pending = readPending()
  return pending?.number === number ? pending.email : null
}
