import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { getInvoice, getOrder, getOrders, lookupOrder, validateCart } from '../services/shopService'

/*
 * The signed-in customer's orders from BuyNest's API (REAL_SHOP). The user id
 * is part of every key, so one customer's cached orders are never shown to
 * the next person who signs in on this device.
 */
export const orderKeys = {
  all: ['orders'],
  list: (userId, page) => ['orders', userId, 'list', page],
  detail: (userId, number) => ['orders', userId, 'detail', number],
  invoice: (userId, number, invoice) => ['orders', userId, 'invoice', number, invoice],
  // A guest's order, found with its number and email (the key holds no email).
  guest: (number) => ['orders', 'guest', number],
}

/** One page of orders, newest first. `authorizedRequest` (useAuth) renews the session on 401. */
export const ordersQuery = (userId, authorizedRequest, page = 1) =>
  queryOptions({
    queryKey: orderKeys.list(userId, page),
    queryFn: ({ signal }) => authorizedRequest(() => getOrders({ page, signal })),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

export const orderQuery = (userId, number, authorizedRequest) =>
  queryOptions({
    queryKey: orderKeys.detail(userId, number),
    queryFn: ({ signal }) => authorizedRequest(() => getOrder(number, { signal })),
    staleTime: 30_000,
  })

/** A guest's order by number and email (POST /api/shop/orders/lookup): back from Stripe's payment page. */
export const guestOrderQuery = (number, email) =>
  queryOptions({
    queryKey: orderKeys.guest(number),
    queryFn: ({ signal }) => lookupOrder({ number, email }, { signal }),
    staleTime: 30_000,
    retry: false,
  })

export const invoiceQuery = (userId, number, invoice, authorizedRequest) =>
  queryOptions({
    queryKey: orderKeys.invoice(userId, number, invoice),
    queryFn: ({ signal }) => authorizedRequest(() => getInvoice(number, invoice, { signal })),
    staleTime: 5 * 60_000, // an invoice never changes
  })

/**
 * The server's price for the cart (POST /api/shop/cart/validate). A query,
 * not a mutation: it changes nothing, and the checkout re-asks whenever the
 * lines, coupon, or delivery method change. The key holds only ids and
 * quantities, so a refreshed product snapshot doesn't trigger a new request.
 */
export const cartPricingKey = ({ items, couponCode, shippingMethod, email, country, giftCardCode, rewardPoints, place, paymentMethod }) => [
  'cart-pricing',
  // A gift card line (phase 10) is "<product>g<line id>x<quantity>": its amount and recipient are part of the id.
  items
    .filter((item) => !item.isUnavailable)
    .map((item) => `${item.productId}${item.giftCard ? `g${item.giftCard.id}` : item.variantId ? `v${item.variantId}` : ''}x${item.quantity}`),
  couponCode ?? null,
  shippingMethod ?? null, // null: a cart of gift cards only (no delivery)
  email ?? null, // a guest's email can change whether a code applies (one use per customer)
  country ?? null, // the tax depends on the shipping country
  giftCardCode ?? null, // phase 10: the gift card that pays (part of) the total
  // Phase 11: reward points to spend. Left out when none, so earlier keys (and the cart page's entry) stay the same.
  ...(rewardPoints > 0 ? [rewardPoints] : []),
  // Phase 14: the Bangladesh area (its zone prices delivery) and the payment method (cash on delivery's
  // fee and limits), only when sent, so every other key stays the same.
  ...(place?.areaId ? [`area:${place.areaId}`] : []),
  ...(paymentMethod ? [`pay:${paymentMethod}`] : []),
]

export const cartPricingQuery = (input) =>
  queryOptions({
    queryKey: cartPricingKey(input),
    queryFn: ({ signal }) => validateCart(input, { signal }),
    placeholderData: keepPreviousData, // keep the last total on screen while the next one loads
    staleTime: 30_000,
  })
