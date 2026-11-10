import { apiClient } from './apiClient'
import { REAL_ACCOUNTS } from '../constants/accounts'

/*
 * Orders — SIMULATED. DummyJSON has no orders API, so BuyNest:
 * 1. asks the server to price the cart (POST /carts/add looks up the real
 *    list price of every product ID and drops unknown products), and
 * 2. saves the order in this browser (OrdersProvider).
 * No payment is taken and nothing ships. With a real backend, step 2 becomes
 * POST /api/orders and the SERVER creates the order from its own prices,
 * stock, coupon rules, shipping rates, and taxes.
 */

/**
 * DummyJSON's cart check only accepts its own demo users (ids 1 to 208). With
 * BuyNest accounts, the price check (still DummyJSON until orders move to
 * Laravel in phase 2) runs as demo user 1; the order itself keeps the real
 * customer's id.
 */
const priceCheckUserId = (userId) => (REAL_ACCOUNTS ? 1 : userId)

/**
 * Server price check for the cart lines. Returns the server's cart plus a
 * list of problems (missing products, list prices or discounts that differ
 * from the cart).
 */
export async function verifyCartWithServer(items, userId, { signal } = {}) {
  const cart = await apiClient.post(
    '/carts/add',
    { userId: priceCheckUserId(userId), products: items.map((item) => ({ id: item.productId, quantity: item.quantity })) },
    { signal },
  )

  const serverById = new Map(cart.products.map((line) => [line.id, line]))
  const problems = []
  for (const item of items) {
    const serverLine = serverById.get(item.productId)
    if (!serverLine) problems.push(`"${item.title}" is no longer available.`)
    else if (serverLine.price !== item.price || (serverLine.discountPercentage ?? 0) !== (item.discountPercentage ?? 0)) {
      problems.push(`The price of "${item.title}" has changed.`)
    }
  }

  return {
    cartId: cart.id,
    // DummyJSON rounds discounted totals to whole dollars; we keep it for transparency.
    serverDiscountedTotal: cart.discountedTotal,
    problems,
  }
}

/** Builds the order record saved after a successful (simulated) checkout. */
export function createOrder({ userId, values, items, totals, couponCode, verification, placedAt = Date.now() }) {
  const { shipping, billingSameAsShipping, billing } = values
  return {
    id: `BN-${placedAt.toString(36).toUpperCase()}`,
    userId,
    placedAt,
    status: 'placed',
    isSimulated: true,
    contact: { email: values.email, phone: values.phone },
    shippingAddress: shipping,
    billingAddress: billingSameAsShipping ? shipping : billing,
    shippingMethod: { id: totals.shippingMethod.id, label: totals.shippingMethod.label, eta: totals.shippingMethod.eta },
    paymentMethod: values.paymentMethod,
    items: items.map((item) => ({
      productId: item.productId,
      title: item.title,
      thumbnail: item.thumbnail,
      quantity: item.quantity,
      price: item.price,
      discountPercentage: item.discountPercentage,
    })),
    totals: {
      itemCount: totals.itemCount,
      subtotal: totals.subtotal,
      couponCode: totals.coupon && !totals.couponError ? couponCode : null,
      discount: totals.discount,
      shipping: totals.shipping,
      total: totals.total,
    },
    verification,
  }
}
