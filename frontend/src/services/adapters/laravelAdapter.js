/*
 * Adapter for the FUTURE BuyNest Laravel API (contract:
 * docs/backend/API_CONTRACT.md). Laravel API Resources use snake_case, wrap
 * payloads in `data`, and paginate with `meta`. This file converts them into
 * the same BuyNest shapes the DummyJSON adapter produces, so no component
 * changes when the backend switches.
 *
 * Written against the documented contract and checked with fixtures and a
 * local mock server — there is no live Laravel API yet.
 */

const AVAILABILITY = { in_stock: 'In Stock', low_stock: 'Low Stock', out_of_stock: 'Out of Stock' }

/** Laravel decimals arrive as strings ("1099.99"); missing values stay null. */
const toNumberOrNull = (value) => (value === null || value === undefined ? null : Number(value))

/** ProductResource → BuyNest product. */
export function normalizeProduct(raw) {
  return {
    id: raw.id,
    title: raw.name,
    description: raw.description ?? null,
    category: raw.category?.slug ?? null,
    brand: raw.brand?.name ?? null,
    price: Number(raw.price),
    discountPercentage: Number(raw.discount_percent ?? 0),
    rating: toNumberOrNull(raw.rating_average),
    stock: toNumberOrNull(raw.stock_quantity),
    availabilityStatus: AVAILABILITY[raw.availability] ?? null,
    thumbnail: raw.thumbnail_url ?? raw.images?.[0]?.url ?? null,
    images: (raw.images ?? []).map((image) => image.url),
    sku: raw.sku ?? null,
    tags: raw.tags ?? [],
    minimumOrderQuantity: raw.min_order_quantity ?? 1,
    warrantyInformation: raw.warranty ?? null,
    shippingInformation: raw.shipping_info ?? null,
    returnPolicy: raw.return_policy ?? null,
    reviews: (raw.reviews ?? []).map((review) => ({
      rating: review.rating,
      comment: review.comment,
      date: review.created_at,
      reviewerName: review.author_name,
    })),
  }
}

/** Paginated collection `{ data, meta }` → `{ items, total, skip, limit }`. */
export function normalizeProductPage(raw) {
  const { current_page: page, per_page: perPage, total } = raw.meta
  return { items: raw.data.map(normalizeProduct), total, skip: (page - 1) * perPage, limit: perPage }
}

/** Single resource `{ data: {...} }` → BuyNest product. */
export function normalizeProductDetail(raw) {
  return normalizeProduct(raw.data)
}

/** `{ data: [{ slug, name }] }` → `[{ slug, name }]`. */
export function normalizeCategories(raw) {
  return raw.data.map((category) => ({ slug: category.slug, name: category.name }))
}
