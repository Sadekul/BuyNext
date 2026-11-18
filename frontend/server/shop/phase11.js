import { laravel } from '../http.js'
import { failed } from './laravel.js'
import { productCard } from './productCard.js'

/*
 * Phase 11 storefront services with BuyNest's Laravel API
 * (docs/backend/PHASE11_CONTRACT.md, "Implementation notes — backend"):
 *   /api/v1/me/wishlist[/{id}|/merge|/share]   the signed-in customer's wishlist, saved on the server
 *   /api/v1/wishlists/{token}                  a shared wishlist (no sign-in: the token is the key)
 *   /api/v1/me/rewards                         reward points balance and history
 *
 * Same rules as shop/laravel.js: only listed fields go either way, and every
 * function resolves to { ok: true, status, data } or { ok: false, status, body }.
 *
 * PRODUCT CARDS (wishlist items, shared wishlists, cart cross-sells) keep the
 * API's catalog shape (snake_case), allow-listed by productCard(): the
 * storefront turns them into BuyNest products with the same adapter as the
 * catalog (src/services/adapters/laravelAdapter.js), so a card looks the same everywhere.
 */

const str = (value) => (typeof value === 'string' ? value : undefined)
const toId = (value) => {
  const id = Number.isInteger(value) ? value : typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN
  return Number.isInteger(id) && id > 0 ? id : undefined
}
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result))

const fromVariant = (raw) => (raw && typeof raw === 'object' && Number.isInteger(raw.id) ? { id: raw.id, label: str(raw.label) ?? null } : null)

/** A wishlist item: { id, product (card), variant, note, addedAt }. */
export const fromWishlistItem = (raw = {}) => ({
  id: raw.id,
  product: productCard(raw.product),
  variant: fromVariant(raw.variant),
  note: str(raw.note) || null,
  addedAt: str(raw.added_at) ?? null,
})

const fromWishlistItems = (raw) => (Array.isArray(raw) ? raw.map(fromWishlistItem).filter((item) => item.product) : [])

/** { items, shared, skipped? } from a list answer ({ data: [item…], meta }). */
const fromWishlist = (data = {}) => ({
  items: fromWishlistItems(data.data),
  shared: data.meta?.shared === true,
  ...(Array.isArray(data.meta?.skipped) && {
    skipped: data.meta.skipped.map((entry) => ({ productId: entry?.product_id ?? null, reason: str(entry?.reason) ?? 'unavailable' })),
  }),
})

// Up to 255 characters; an empty note clears it.
const toNote = (value) => {
  const note = str(value)?.trim().slice(0, 255)
  return note ? note : null
}

/** A share link token: 32 URL-safe characters (any length the API may use later, within reason). */
export const isShareToken = (value) => /^[A-Za-z0-9_-]{16,128}$/.test(value ?? '')

/** A reward points transaction, as the customer sees it (no staff names). */
const fromRewardTransaction = (raw = {}) => ({
  id: raw.id,
  points: Number.isInteger(raw.points) ? raw.points : Number.parseInt(raw.points, 10) || 0,
  balanceAfter: Number.isInteger(raw.balance_after) ? raw.balance_after : Number.parseInt(raw.balance_after, 10) || 0,
  type: str(raw.type) ?? 'adjust',
  orderNumber: typeof raw.order_number === 'string' && /^BN-\d{1,12}$/.test(raw.order_number) ? raw.order_number : null,
  note: str(raw.note) || null,
  createdAt: str(raw.created_at) ?? null,
})

const toMoney = (value) => (value === null || value === undefined || Number.isNaN(Number(value)) ? 0 : Number(value))

export const laravelWishlist = {
  /** → { items, shared } (products no longer for sale are left out by the API). */
  async list(token, request) {
    return answer(await laravel('/api/v1/me/wishlist', { token, request }), [200], fromWishlist)
  },

  /** { productId, variantId?, note? } → the item (201 new, 200 when it was already there). 422 code wishlist_full at 100. */
  async add(token, body, request) {
    const variantId = toId(body.variantId)
    const note = toNote(body.note)
    const result = await laravel('/api/v1/me/wishlist', {
      method: 'POST',
      token,
      request,
      body: { product_id: toId(body.productId) ?? null, ...(variantId && { variant_id: variantId }), ...(note && { note }) },
    })
    return answer(result, [200, 201], (data) => fromWishlistItem(data.data))
  },

  /** { note } → the item (an empty note clears it). */
  async update(token, id, body, request) {
    const result = await laravel(`/api/v1/me/wishlist/${id}`, { method: 'PATCH', token, request, body: { note: toNote(body.note) } })
    return answer(result, [200], (data) => fromWishlistItem(data.data))
  },

  async remove(token, id, request) {
    return answer(await laravel(`/api/v1/me/wishlist/${id}`, { method: 'DELETE', token, request }), [200, 204], () => ({ ok: true }))
  },

  /** { items: [{ productId, variantId? }] } (the guest's list, once after signing in) → the whole list, with `skipped`. */
  async merge(token, body, request) {
    const items = (Array.isArray(body.items) ? body.items.slice(0, 100) : [])
      .map((item) => ({ product_id: toId(item?.productId), variant_id: toId(item?.variantId) }))
      .filter((item) => item.product_id)
      .map((item) => ({ product_id: item.product_id, ...(item.variant_id && { variant_id: item.variant_id }) }))
    const result = await laravel('/api/v1/me/wishlist/merge', { method: 'POST', token, request, body: { items } })
    return answer(result, [200], fromWishlist)
  },

  /**
   * { regenerate? } → { shared: true, token, sharedAt }. `token` is null when the
   * list was already shared and no new link was asked for: the API keeps only
   * its hash, so the old link can't be shown again.
   */
  async share(token, body, request) {
    const result = await laravel('/api/v1/me/wishlist/share', { method: 'POST', token, request, body: { regenerate: body.regenerate === true } })
    return answer(result, [200, 201], (data) => ({
      shared: data.data?.shared !== false,
      token: isShareToken(data.data?.token) ? data.data.token : null,
      sharedAt: str(data.data?.shared_at) ?? null,
    }))
  },

  async stopSharing(token, request) {
    return answer(await laravel('/api/v1/me/wishlist/share', { method: 'DELETE', token, request }), [200, 204], () => ({ ok: true }))
  },

  /** A shared wishlist (no sign-in) → { ownerFirstName, items: [{ product, variantLabel, note }] }. 404 for unknown or stopped links. */
  async shared(shareToken, request) {
    const result = await laravel(`/api/v1/wishlists/${encodeURIComponent(shareToken)}`, { request })
    return answer(result, [200], (data) => ({
      ownerFirstName: str(data.data?.owner_first_name)?.slice(0, 100) || null,
      items: (Array.isArray(data.data?.items) ? data.data.items : [])
        .map((item) => ({ product: productCard(item?.product), variantLabel: str(item?.variant?.label) ?? null, note: str(item?.note) || null }))
        .filter((item) => item.product),
    }))
  },
}

export const laravelRewards = {
  /** → { enabled, balance, value, pointValue, transactions, total, page, perPage, lastPage } (newest first). */
  async get(token, page, request) {
    const result = await laravel(`/api/v1/me/rewards?page=${page}`, { token, request })
    return answer(result, [200], (data) => {
      const rewards = data.data ?? {}
      const transactions = Array.isArray(rewards.transactions) ? rewards.transactions.map(fromRewardTransaction) : []
      return {
        enabled: rewards.enabled === true,
        balance: Number.isInteger(rewards.balance) ? rewards.balance : 0,
        value: toMoney(rewards.value),
        pointValue: toMoney(rewards.point_value),
        transactions,
        total: data.meta?.total ?? transactions.length,
        page: data.meta?.current_page ?? page,
        perPage: data.meta?.per_page ?? transactions.length,
        lastPage: data.meta?.last_page ?? 1,
      }
    })
  },
}
