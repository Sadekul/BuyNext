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
    // Detail-only fields (absent from list responses that use `select`):
    sku: raw.sku ?? null,
    tags: raw.tags ?? [],
    minimumOrderQuantity: raw.minimumOrderQuantity ?? 1,
    warrantyInformation: raw.warrantyInformation ?? null,
    shippingInformation: raw.shippingInformation ?? null,
    returnPolicy: raw.returnPolicy ?? null,
    reviews: (raw.reviews ?? []).map(normalizeReview),
    // Not mapped on purpose: `weight` and `dimensions` (the API gives no units),
    // and `meta` (barcode/QR data the storefront doesn't use).
  }
}

/** Reviewer emails are dropped: the storefront never needs to display them. */
function normalizeReview(raw) {
  return {
    rating: raw.rating,
    comment: raw.comment,
    date: raw.date,
    reviewerName: raw.reviewerName,
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

/**
 * Raw DummyJSON user → BuyNest customer. ALLOW-LIST on purpose: /auth/me also
 * returns the password, bank card, SSN, IP address, and more. Copying only
 * the fields the storefront needs keeps sensitive data out of React state,
 * DevTools, and browser storage.
 */
export function normalizeUser(raw) {
  const address = raw.address
    ? {
        line1: raw.address.address ?? '',
        city: raw.address.city ?? '',
        state: raw.address.state ?? '',
        postalCode: raw.address.postalCode ?? '',
        country: raw.address.country ?? '',
      }
    : null

  return {
    id: raw.id,
    username: raw.username,
    firstName: raw.firstName ?? '',
    lastName: raw.lastName ?? '',
    email: raw.email ?? '',
    image: raw.image ?? null,
    role: raw.role ?? 'user', // "admin" accounts can open the shop dashboard (/admin)
    phone: raw.phone ?? null, // only in /auth/me
    address, // only in /auth/me
  }
}
