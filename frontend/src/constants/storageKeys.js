/*
 * Every key BuyNest uses in the browser's localStorage. The "v1/v2" suffix is
 * the data format version: bump it when the stored shape changes.
 * Cart, wishlist, and orders are per owner: the key below holds the guest
 * copy, and each account gets "<key>.user-<id>" (see usePersistentReducer).
 */
export const STORAGE_KEYS = {
  cart: 'buynest.cart.v1',
  wishlist: 'buynest.wishlist.v1',
  orders: 'buynest.orders.v1',
  // The signed-in customer's name and avatar for the header. No tokens: the
  // session itself lives in HttpOnly cookies (server/authBff.js).
  profile: 'buynest.session.v2',
  // Phase 7 (REAL_SHOP): the cart lines the server last saved for the account
  // ("<key>.user-<id>"), so signing in again doesn't add them twice (hooks/useSavedCartSync.js).
  cartSync: 'buynest.cartSync.v1',
}

/** The per-account stores that "Remember me" decides about at sign-out. */
export const ACCOUNT_STORES = [STORAGE_KEYS.cart, STORAGE_KEYS.wishlist, STORAGE_KEYS.orders, STORAGE_KEYS.cartSync]

/**
 * Older keys that may still hold data from previous versions (v1 sessions held
 * tokens; the sign-out signal was used while the admin shared this session).
 */
export const LEGACY_KEYS = ['buynest.session.v1', 'buynest.signal.signout']

/*
 * sessionStorage (this tab only, gone when it closes). Phase 8: the order a
 * guest is paying for on Stripe's page ({ number, email }), so the
 * confirmation page can find it again when Stripe sends them back.
 */
export const SESSION_KEYS = {
  pendingPayment: 'buynest.pendingPayment.v1',
}
