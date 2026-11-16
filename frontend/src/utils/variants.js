import { effectiveDiscountPercent } from './pricing'

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

/** Preselects options that have only one value (nothing to choose). */
export function initialSelection(product) {
  if (!hasVariants(product)) return {}
  let selection = {}
  for (const option of product.options) {
    if (option.values.length === 1 && isValueAvailable(product, selection, option.id, option.values[0].id)) {
      selection = { ...selection, [option.id]: option.values[0].id }
    }
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
 */
export function isValueAvailable(product, selection, optionId, valueId) {
  const index = product.options.findIndex((option) => option.id === optionId)
  const others = product.options
    .slice(0, Math.max(index, 0))
    .filter((option) => selection[option.id] !== undefined)
    .map((option) => selection[option.id])
  return product.variants.some(
    (variant) => variant.inStock && variant.optionValueIds.includes(valueId) && others.every((other) => variant.optionValueIds.includes(other)),
  )
}

/** The selection after choosing a value: later choices that no longer fit are cleared. */
export function chooseValue(product, selection, optionId, valueId) {
  const next = { ...selection, [optionId]: valueId }
  for (const option of product.options) {
    if (next[option.id] !== undefined && !isValueAvailable(product, next, option.id, next[option.id])) delete next[option.id]
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

/** The lowest and highest variant list prices (for "From $x" before a choice). */
export function variantPriceRange(product) {
  const prices = product.variants.map((variant) => variant.price)
  return { min: Math.min(...prices), max: Math.max(...prices) }
}
