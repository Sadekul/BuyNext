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

/** Only https addresses (Stripe's, PayPal's, or SSLCommerz's page) are followed (the shop service already drops anything else). */
export const isPaymentUrl = (url) => typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url)

/**
 * Whether "Pay now" can start a new payment: an unpaid card order that is
 * still waiting for its payment, in a store that takes card payments through
 * Stripe, or (phase 10) a PayPal order in a store connected to PayPal, or
 * (phase 12) an SSLCommerz order in a store connected to SSLCommerz. The
 * API's own `canPay` wins when it sends one; it refuses (422) anything else anyway.
 */
export function canPayOrder(order, cardPayments, paypalPayments = 'manual', sslcommerzPayments = 'manual') {
  if (!order || order.isSimulated) return false
  if (typeof order.canPay === 'boolean') return order.canPay
  if (order.paymentStatus !== 'unpaid' || order.status !== 'pending_payment') return false
  if (order.paymentMethod === 'card') return order.paymentProvider === 'stripe' || cardPayments === 'stripe'
  if (order.paymentMethod === 'paypal') return order.paymentProvider === 'paypal' || paypalPayments === 'paypal'
  if (order.paymentMethod === 'sslcommerz') return order.paymentProvider === 'sslcommerz' || sslcommerzPayments === 'sslcommerz'
  return false
}

/*
 * Phase 12: SSLCommerz says how an order was paid in `card_type`, as
 * "<CODE>-<bank or wallet>" ("BKASH-BKash", "NAGAD-Nagad", "VISA-Dutch Bangla").
 * The shopper sees a friendly name: "bKash", "Nagad", "Visa card"…
 */
const SSLCOMMERZ_METHOD_NAMES = {
  BKASH: 'bKash',
  NAGAD: 'Nagad',
  ROCKET: 'Rocket',
  DBBLMOBILEB: 'Rocket',
  UPAY: 'Upay',
  TAP: 'Tap',
  OKWALLET: 'OK Wallet',
  VISA: 'Visa card',
  MASTER: 'Mastercard',
  MASTERCARD: 'Mastercard',
  AMEX: 'American Express card',
  UNIONPAY: 'UnionPay card',
}

/** "BKASH-BKash" → "bKash"; an unknown code → "card or bank"; nothing → null. The API's own label wins. */
export function sslcommerzMethodName(payment) {
  if (typeof payment?.methodLabel === 'string' && payment.methodLabel.trim()) return payment.methodLabel.trim()
  const cardType = typeof payment?.cardType === 'string' ? payment.cardType.trim() : ''
  if (!cardType) return null
  const code = cardType.split('-')[0].replace(/[^A-Za-z]/g, '').toUpperCase()
  if (SSLCOMMERZ_METHOD_NAMES[code]) return SSLCOMMERZ_METHOD_NAMES[code]
  if (/BANK|IB$/i.test(code)) return 'internet banking'
  return 'card or bank'
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
