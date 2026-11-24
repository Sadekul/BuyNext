import { effectiveDiscountPercent, getProductPricing } from './pricing'

/*
 * Configurable products (phase 5): a product with options (Size, Color) sells
 * only through a variant, one per combination of option values. The shopper
 * picks one value per option; `selection` maps option id → value id.
 * Products without variants (and every DummyJSON product) skip all of this.
 */

/** True when the product must be bought through a variant. */
export function hasVariants(product) {
  return (product?.variants?.length ?? 0) > 0 && (product.options?.length ?? 0) > 0
}

/**
 * The selection a product page opens with. Magento-style (phase 16): nothing
 * is chosen while there is a real choice to make. A product with exactly one
 * buyable combination (one variant, or one in stock) opens with it chosen;
 * otherwise only options with a single value (nothing to choose) are set.
 */
export function initialSelection(product) {
  if (!hasVariants(product)) return {}
  const buyable = product.variants.filter((variant) => variant.inStock)
  const only = product.variants.length === 1 ? product.variants[0] : buyable.length === 1 ? buyable[0] : null
  if (only) {
    const selection = selectionOfVariant(product, only)
    if (selection) return selection
  }
  let selection = {}
  for (const option of product.options) {
    if (option.values.length === 1 && isValueAvailable(product, selection, option.id, option.values[0].id)) {
      selection = { ...selection, [option.id]: option.values[0].id }
    }
  }
  return selection
}

/** option id → value id for one variant (null when the variant misses an option). */
function selectionOfVariant(product, variant) {
  const selection = {}
  for (const option of product.options) {
    const value = option.values.find((candidate) => variant.optionValueIds.includes(candidate.id))
    if (!value) return null
    selection[option.id] = value.id
  }
  return selection
}

/** The variant that matches every selected value, or null while the selection is incomplete. */
export function findVariant(product, selection) {
  if (!hasVariants(product)) return null
  const chosen = product.options.map((option) => selection[option.id])
  if (chosen.some((valueId) => valueId === undefined)) return null
  return product.variants.find((variant) => chosen.every((valueId) => variant.optionValueIds.includes(valueId))) ?? null
}

/**
 * Whether `valueId` of `optionId` can be picked: some variant in stock has
 * that value and the values chosen for the options BEFORE it. Only earlier
 * options count, so the shopper can never get stuck: the first option is
 * always open, and changing it clears later choices that no longer fit
 * (see chooseValue).
 * `{ soldOut: true }` (phase 9) also counts variants that are sold out, so a
 * shopper can pick one and ask to be emailed when it's back.
 */
export function isValueAvailable(product, selection, optionId, valueId, { soldOut = false } = {}) {
  const index = product.options.findIndex((option) => option.id === optionId)
  const others = product.options
    .slice(0, Math.max(index, 0))
    .filter((option) => selection[option.id] !== undefined)
    .map((option) => selection[option.id])
  return product.variants.some(
    (variant) => (soldOut || variant.inStock) && variant.optionValueIds.includes(valueId) && others.every((other) => variant.optionValueIds.includes(other)),
  )
}

/**
 * The selection after choosing a value: later choices that no longer fit are
 * cleared. `{ soldOut: true }`: sold-out variants count as fitting (phase 9).
 */
export function chooseValue(product, selection, optionId, valueId, { soldOut = false } = {}) {
  const next = { ...selection, [optionId]: valueId }
  for (const option of product.options) {
    if (next[option.id] !== undefined && !isValueAvailable(product, next, option.id, next[option.id], { soldOut })) delete next[option.id]
  }
  return next
}

/** "Size: M / Color: Red", the label orders and the cart show. */
export function variantLabel(product, variant) {
  return product.options
    .map((option) => {
      const value = option.values.find((candidate) => variant.optionValueIds.includes(candidate.id))
      return value ? `${option.name}: ${value.value}` : null
    })
    .filter(Boolean)
    .join(' / ')
}

/**
 * The product as the cart sees it once a variant is chosen: the variant's
 * price (the product's discount still applies), stock, and sku, plus its id
 * and label.
 */
export function withVariant(product, variant) {
  // The server's final price wins when a catalog price rule makes it lower (phase 7).
  const discountPercentage = effectiveDiscountPercent(variant.price, product.discountPercentage ?? 0, variant.finalPrice ?? null)
  let availabilityStatus = 'In Stock'
  if (!variant.inStock || variant.stock === 0) availabilityStatus = 'Out of Stock'
  else if (variant.stock !== null && variant.stock <= 5) availabilityStatus = 'Low Stock'
  return {
    ...product,
    price: variant.price,
    discountPercentage,
    stock: variant.stock,
    sku: variant.sku ?? product.sku,
    availabilityStatus,
    variantId: variant.id,
    variantLabel: variantLabel(product, variant),
  }
}

/**
 * The lowest and highest price a shopper pays for the variants (their final
 * prices: the product's discount or a catalog price rule applied), for
 * "From ৳x" before a choice.
 */
export function variantPriceRange(product) {
  const prices = product.variants.map((variant) => getProductPricing(withVariant(product, variant)).salePrice)
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

/**
 * Phase 16: "From ৳x" for a card or quick view: the list item's `priceRange`
 * (API) or the detail's variants. Null for simple products and when every
 * variant costs the same (then the usual price is shown).
 */
export function fromPrice(product) {
  const range = product?.priceRange ?? (hasVariants(product) ? variantPriceRange(product) : null)
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min === range.max) return null
  return range.min
}

/**
 * Phase 16: a value or option name as it appears in the URL ("Sky Blue" →
 * "sky-blue", "128 GB" → "128-gb"). Letters of any script stay (Bangla names
 * give Bangla slugs).
 */
export function optionSlug(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Phase 16: the URL key of an option and value: the API's language-independent
 * `code` (the English name's slug, the same on English and Bangla pages), or —
 * for answers without one — the slug of the shown name.
 */
const optionKey = (option) => option.code || optionSlug(option.name)
const valueKey = (value) => value.code || optionSlug(value.value)

/**
 * Phase 16: `?color=blue&size=m` → a selection. Unknown options or values, and
 * combinations that can't be chosen, are ignored (that option stays open).
 */
export function selectionFromSearch(product, search, { soldOut = false } = {}) {
  if (!hasVariants(product)) return null
  const params = new URLSearchParams(search)
  let selection = {}
  let found = false
  for (const option of product.options) {
    // The code first; a link written from the shown name (older answers) is still understood.
    const wanted = params.get(optionKey(option)) ?? params.get(optionSlug(option.name))
    if (!wanted) continue
    const slug = optionSlug(wanted)
    const value =
      option.values.find((candidate) => valueKey(candidate) === wanted || valueKey(candidate) === slug) ??
      option.values.find((candidate) => optionSlug(candidate.value) === slug)
    if (!value || value.id === null) continue
    const next = chooseValue(product, selection, option.id, value.id, { soldOut })
    if (next[option.id] === value.id) {
      selection = next
      found = true
    }
  }
  return found ? selection : null
}

/**
 * Phase 16: the page's query string for a selection: the option parameters
 * set for a full choice, removed otherwise; other parameters are kept.
 */
export function searchForSelection(product, selection, search) {
  const params = new URLSearchParams(search)
  const complete = findVariant(product, selection) !== null
  for (const option of product.options) {
    const key = optionKey(option)
    const value = option.values.find((candidate) => candidate.id === selection[option.id])
    if (complete && value) params.set(key, valueKey(value))
    else params.delete(key)
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * Phase 16: the gallery for a selection. Images tied to a chosen value come
 * first (then the shared ones; other values' images are left out); with no
 * such images, every image in the admin's order. Returns the indexes into
 * `product.images`, plus the value whose images lead (null = none).
 */
export function galleryOrder(product, selection) {
  const tags = product.imageOptionValueIds ?? []
  const all = product.images.map((_, index) => index)
  const chosen = new Set(Object.values(selection ?? {}))
  const own = all.filter((index) => tags[index] != null && chosen.has(tags[index]))
  if (own.length === 0) return { indexes: all, valueId: null }
  const shared = all.filter((index) => tags[index] == null)
  return { indexes: [...own, ...shared], valueId: tags[own[0]] }
}
