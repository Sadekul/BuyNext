/*
 * Adapter for BuyNest's Laravel API (contract: docs/backend/API_CONTRACT.md
 * and PHASE2_CONTRACT.md), whose catalog reaches the browser through
 * /api/catalog unchanged. Laravel API Resources use snake_case, wrap
 * payloads in `data`, and paginate with `meta`. This file converts them into
 * the same BuyNest shapes the DummyJSON adapter produces, so no component
 * changes when the backend switches.
 */

import { effectiveDiscountPercent } from '../../utils/pricing'
import { safeRedirectTarget } from '../../utils/safeRedirect'
import { normalizeImageVariants } from '../../utils/images'

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
    // A catalog price rule's sale (phase 7: `sale_price` is the rule's price when it
    // wins, `price_rule` names it) is shown as a discount, like the product's own.
    discountPercentage: effectiveDiscountPercent(Number(raw.price), Number(raw.discount_percent ?? 0), raw.price_rule ? toNumberOrNull(raw.sale_price) : null),
    ...(raw.price_rule && typeof raw.price_rule.name === 'string' && { priceRule: { id: raw.price_rule.id, name: raw.price_rule.name } }),
    rating: toNumberOrNull(raw.rating_average),
    stock: toNumberOrNull(raw.stock_quantity),
    availabilityStatus: AVAILABILITY[raw.availability] ?? null,
    thumbnail: raw.thumbnail_url ?? raw.images?.[0]?.url ?? null,
    images: (raw.images ?? []).map((image) => image.url),
    // Phase 9: the resized copies of each image ({ 320: url, 960: url }, or null), in the same order,
    // and of the thumbnail (its own `thumbnail_variants`, or those of the image it is).
    imageVariants: (raw.images ?? []).map((image) => normalizeImageVariants(image.variants)),
    thumbnailVariants: thumbnailVariants(raw),
    // The admin's alt text per image (phase 5), in the same order; null when none was written.
    imageAlts: (raw.images ?? []).map((image) => (typeof image.alt === 'string' && image.alt.trim() ? image.alt.trim() : null)),
    sku: raw.sku ?? null,
    tags: raw.tags ?? [],
    minimumOrderQuantity: raw.min_order_quantity ?? 1,
    warrantyInformation: raw.warranty ?? null,
    shippingInformation: raw.shipping_info ?? null,
    returnPolicy: raw.return_policy ?? null,
    // Phase 7 SEO: the admin's search-result title and description (null = use the name and description).
    metaTitle: typeof raw.meta_title === 'string' && raw.meta_title.trim() ? raw.meta_title.trim() : null,
    metaDescription: typeof raw.meta_description === 'string' && raw.meta_description.trim() ? raw.meta_description.trim() : null,
    reviews: (raw.reviews ?? []).map(normalizeReview),
    // Phase 5 configurable products. Listing items only say whether there are
    // variants (`has_variants`); the product page gets the options and variants.
    hasVariants: raw.has_variants === true || (raw.variants?.length ?? 0) > 0,
    ...(raw.options !== undefined && { options: normalizeOptions(raw.options) }),
    ...(raw.variants !== undefined && { variants: (raw.variants ?? []).map((variant) => normalizeVariant(variant, raw)) }),
  }
}

function thumbnailVariants(raw) {
  const own = normalizeImageVariants(raw.thumbnail_variants)
  if (own) return own
  const thumbnail = raw.thumbnail_url ?? raw.images?.[0]?.url
  const image = (raw.images ?? []).find((candidate) => candidate.url === thumbnail)
  return normalizeImageVariants(image?.variants)
}

/** ReviewResource → a review. Only approved reviews reach the storefront. */
export function normalizeReview(review) {
  return {
    ...(review.id !== undefined && { id: review.id }),
    rating: review.rating,
    title: review.title ?? null,
    comment: review.comment,
    date: review.created_at,
    reviewerName: review.author_name,
    verifiedPurchase: review.verified_purchase === true,
  }
}

/** `options: [{ id, name, values: [{ id, value }] }]`, in the API's order. */
function normalizeOptions(raw) {
  return (raw ?? []).map((option) => ({
    id: option.id,
    name: option.name,
    values: (option.values ?? []).map((value) => ({ id: value.id, value: value.value })),
  }))
}

/**
 * A variant: `price` is its list price (null in the API = the product's), so
 * the storefront's pricing helper applies the product's discount to it, like
 * the server does.
 */
function normalizeVariant(variant, product) {
  const stock = toNumberOrNull(variant.stock_quantity)
  return {
    id: variant.id,
    sku: variant.sku ?? null,
    optionValueIds: (variant.option_value_ids ?? []).map(Number),
    price: Number(variant.price ?? product.price),
    finalPrice: toNumberOrNull(variant.final_price),
    stock,
    inStock: variant.in_stock ?? (stock ?? 0) > 0,
  }
}

/** Paginated collection `{ data, meta }` → `{ items, total, skip, limit }`. */
export function normalizeProductPage(raw) {
  const { current_page: page, per_page: perPage, total } = raw.meta
  // Phase 7: the admin can send an exact search term straight to a page (`meta.redirect_url`).
  const redirectUrl = safeRedirectTarget(raw.meta.redirect_url)
  return { items: raw.data.map(normalizeProduct), total, skip: (page - 1) * perPage, limit: perPage, ...(redirectUrl && { redirectUrl }) }
}

/** Single resource `{ data: {...} }` → BuyNest product. */
export function normalizeProductDetail(raw) {
  return normalizeProduct(raw.data)
}

/**
 * The category tree `{ data: [{ slug, name, children: [...] }] }` (phase 5)
 * → a flat list in tree order: `[{ slug, name, parentSlug, depth }]`. Flat,
 * so every page can look a category up by slug; utils/categories.js rebuilds
 * the levels for the navigation. A flat answer (before phase 5) gives
 * top-level categories only.
 */
export function normalizeCategories(raw) {
  const flat = []
  const visit = (categories, parentSlug, depth) => {
    for (const category of categories ?? []) {
      flat.push({
        slug: category.slug,
        name: category.name,
        parentSlug,
        depth,
        // For the category page's search and link-preview tags (phase 5 fields), when set.
        ...(category.description && { description: category.description }),
        ...(category.meta_title && { metaTitle: category.meta_title }),
        ...(category.meta_description && { metaDescription: category.meta_description }),
        ...(category.image_url && { image: category.image_url }),
      })
      if (depth < 5) visit(category.children, category.slug, depth + 1)
    }
  }
  visit(raw.data, null, 0)
  return flat
}
