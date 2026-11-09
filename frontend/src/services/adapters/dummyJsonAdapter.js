/*
 * Adapter (normalization layer) for DummyJSON responses.
 *
 * Components never see raw API data — only the BuyNest shapes produced here.
 * When we switch to Laravel (or Shopify/Magento), we write a new adapter with
 * the same output shapes and the components don't change.
 *
 * Missing optional fields become `null` instead of invented values.
 */

/** Raw DummyJSON product → BuyNest product. */
export function normalizeProduct(raw) {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? null,
    category: raw.category ?? null,
    brand: raw.brand ?? null, // e.g. sports accessories have no brand
    price: raw.price,
    discountPercentage: raw.discountPercentage ?? 0,
    rating: raw.rating ?? null,
    stock: raw.stock ?? null,
    availabilityStatus: raw.availabilityStatus ?? null,
    thumbnail: raw.thumbnail ?? null,
    images: raw.images ?? [],
  }
}

/** Raw `{ products, total, skip, limit }` → `{ items, total, skip, limit }`. */
export function normalizeProductPage(raw) {
  return {
    items: raw.products.map(normalizeProduct),
    total: raw.total,
    skip: raw.skip,
    limit: raw.limit,
  }
}

/** Raw `{ slug, name, url }` → `{ slug, name }`. */
export function normalizeCategory(raw) {
  return { slug: raw.slug, name: raw.name }
}
