import { apiClient } from './apiClient'
import { normalizeProduct } from './adapters/laravelAdapter'

/*
 * Phase 11 §1: the signed-in customer's wishlist saved on BuyNest's API
 * (REAL_SHOP), and shared wishlists, through the shop service on this
 * site's own address (server/shopApi.js → server/shop/phase11.js).
 * The account comes from the session cookie: wrap calls in
 * useAuth().authorizedRequest so an expired session is renewed.
 *
 * Each entry's `product` arrives as the API's product card (the same shape
 * as the catalog's) and becomes a BuyNest product here, with the catalog's adapter.
 */

const SHOP = { sameOrigin: true }

const toVariant = (raw) => (raw && Number.isInteger(raw.id) ? { id: raw.id, label: typeof raw.label === 'string' ? raw.label : null } : null)

/** { id, product, variant, note, addedAt } (a BuyNest product). */
export const toWishlistEntry = (raw) => ({
  id: raw.id,
  product: normalizeProduct(raw.product),
  variant: toVariant(raw.variant),
  note: typeof raw.note === 'string' && raw.note ? raw.note : null,
  addedAt: raw.addedAt ?? null,
})

const toWishlist = (data) => ({
  items: (Array.isArray(data?.items) ? data.items : []).filter((entry) => entry?.product?.id).map(toWishlistEntry),
  shared: data?.shared === true,
  skipped: Array.isArray(data?.skipped) ? data.skipped : [],
})

/** GET /api/shop/me/wishlist → { items, shared } (hidden products are left out by the API). */
export async function getWishlist({ signal } = {}) {
  return toWishlist(await apiClient.get('/api/shop/me/wishlist', { ...SHOP, signal }))
}

/** POST /api/shop/me/wishlist { productId, note? } → the entry (an existing one is answered as is). 422 code wishlist_full at 100. */
export async function addWishlistItem(productId, { note } = {}) {
  return toWishlistEntry(await apiClient.post('/api/shop/me/wishlist', { productId, ...(note && { note }) }, SHOP))
}

/** PATCH /api/shop/me/wishlist/:id { note } → the entry. An empty note removes it. */
export async function updateWishlistNote(id, note) {
  return toWishlistEntry(await apiClient.patch(`/api/shop/me/wishlist/${encodeURIComponent(id)}`, { note: note || null }, SHOP))
}

/** DELETE /api/shop/me/wishlist/:id */
export function removeWishlistItem(id) {
  return apiClient.delete(`/api/shop/me/wishlist/${encodeURIComponent(id)}`, SHOP)
}

/**
 * POST /api/shop/me/wishlist/merge { items: [{ productId }] } → the whole list
 * after adding these (once, after signing in: the guest's items). Unknown or
 * hidden products are skipped (`skipped`).
 */
export async function mergeWishlist(items) {
  return toWishlist(await apiClient.post('/api/shop/me/wishlist/merge', { items: items.map((item) => ({ productId: item.productId })) }, SHOP))
}

/**
 * POST /api/shop/me/wishlist/share { regenerate? } → { token, shared }. The
 * token is only answered when the link is made (or made again): the API keeps
 * only its hash, so an existing link can't be shown again.
 */
export function shareWishlist({ regenerate = false } = {}) {
  return apiClient.post('/api/shop/me/wishlist/share', regenerate ? { regenerate: true } : {}, SHOP)
}

/** DELETE /api/shop/me/wishlist/share: the shared link stops working. */
export function stopSharingWishlist() {
  return apiClient.delete('/api/shop/me/wishlist/share', SHOP)
}

/** GET /api/shop/wishlists/:token (no sign-in) → { ownerFirstName, items: [{ product, variantLabel, note }] }. 404 for unknown or stopped links. */
export async function getSharedWishlist(token, { signal } = {}) {
  const data = await apiClient.get(`/api/shop/wishlists/${encodeURIComponent(token)}`, { ...SHOP, signal })
  return {
    ownerFirstName: typeof data?.ownerFirstName === 'string' && data.ownerFirstName ? data.ownerFirstName : null,
    items: (Array.isArray(data?.items) ? data.items : [])
      .filter((item) => item?.product?.id)
      .map((item) => ({ product: normalizeProduct(item.product), variantLabel: item.variantLabel ?? null, note: item.note ?? null })),
  }
}
