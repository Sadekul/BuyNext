import { laravel } from '../http.js'
import { serverMessage } from '../i18n.js'
import { failed, fromCart } from './laravel.js'

/*
 * A signed-in customer's saved cart (docs/backend/PHASE7_CONTRACT.md §6), so
 * the cart follows them to another device:
 *   GET  /api/v1/me/cart        → { data: { items: [{ product_id, variant_id, quantity }], item_count, updated_at } }
 *   POST /api/v1/me/cart/merge  { items } → the same, after ADDING the browser's lines (capped by stock)
 *
 * The API answers with ids and quantities only. The browser's cart needs the
 * name, photo, price, and stock of each line too, so the saved lines are
 * priced once more as a GUEST (cart/validate without the customer's token:
 * that call saves nothing and its prices are the catalog's, the customer's
 * group discount is added later by the cart page, as for every line).
 *
 * Resolves to { ok: true, status, data: { items, itemCount, updatedAt } } or
 * { ok: false, status, body }. `items` are cart lines in the storefront's
 * shape: { productId, variantId?, variantLabel?, title, thumbnail, price,
 * salePrice, discountPercentage, stock, minimumOrderQuantity, quantity, sku }.
 */

const MAX_LINES = 50
const toInt = (value) => (Number.isInteger(value) ? value : Number.parseInt(value, 10))
const positive = (value) => Number.isInteger(value) && value > 0

const toLines = (items) =>
  (Array.isArray(items) ? items : [])
    .slice(0, MAX_LINES)
    .map((item) => ({ productId: toInt(item?.productId), variantId: toInt(item?.variantId), quantity: toInt(item?.quantity) }))
    .filter((item) => positive(item.productId) && positive(item.quantity))
    .map((item) => ({ product_id: item.productId, ...(positive(item.variantId) && { variant_id: item.variantId }), quantity: Math.min(item.quantity, 999) }))

/** The API's saved lines → priced storefront lines (or the saved ones only, if pricing fails). */
async function withDetails(saved, request) {
  const items = (Array.isArray(saved?.items) ? saved.items : [])
    .map((item) => ({ product_id: toInt(item.product_id), ...(positive(toInt(item.variant_id)) && { variant_id: toInt(item.variant_id) }), quantity: toInt(item.quantity) }))
    .filter((item) => positive(item.product_id) && positive(item.quantity))
    .slice(0, MAX_LINES)
  const base = { itemCount: Number.isInteger(saved?.item_count) ? saved.item_count : items.reduce((sum, item) => sum + item.quantity, 0), updatedAt: saved?.updated_at ?? null }
  if (items.length === 0) return { ok: true, status: 200, data: { ...base, items: [] } }

  const priced = await laravel('/api/v1/cart/validate', { method: 'POST', request, body: { items, coupon_code: null, shipping_method: 'standard' } })
  if (priced.status !== 200) return { ok: false, status: priced.status === 422 ? 502 : priced.status, body: { message: serverMessage(request, 'savedCartFailed') } }
  const cart = fromCart(priced.data?.data)
  const lines = cart.lines
    .filter((line) => line.available && positive(line.productId))
    .map((line) => ({
      productId: line.productId,
      ...(positive(line.variantId) && { variantId: line.variantId, variantLabel: line.variantLabel ?? null }),
      title: line.title,
      thumbnail: line.thumbnail,
      sku: line.sku,
      price: line.price,
      salePrice: line.salePrice,
      discountPercentage: line.discountPercentage,
      stock: line.stock,
      minimumOrderQuantity: line.minimumOrderQuantity,
      // The saved quantity (already capped by stock); the priced line may have been adjusted.
      quantity: items.find((item) => item.product_id === line.productId && (item.variant_id ?? null) === (positive(line.variantId) ? line.variantId : null))?.quantity ?? line.quantity,
    }))
  return { ok: true, status: 200, data: { ...base, items: lines } }
}

export const laravelCart = {
  async get(token, request) {
    const result = await laravel('/api/v1/me/cart', { token, request })
    if (result.status !== 200) return failed(result)
    return withDetails(result.data?.data, request)
  },

  /** Adds the browser's lines to the saved cart (call once, right after signing in). */
  async merge(token, body, request) {
    const result = await laravel('/api/v1/me/cart/merge', { method: 'POST', token, request, body: { items: toLines(body.items) } })
    if (result.status !== 200 && result.status !== 201) return failed(result)
    return withDetails(result.data?.data, request)
  },
}
