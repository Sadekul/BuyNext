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
}

/** The per-account stores that "Remember me" decides about at sign-out. */
export const ACCOUNT_STORES = [STORAGE_KEYS.cart, STORAGE_KEYS.wishlist, STORAGE_KEYS.orders]

/** Older keys that may still hold data from previous versions (v1 sessions held tokens). */
export const LEGACY_KEYS = ['buynest.session.v1']
