import { formatSlug } from './formatters'

/*
 * Phase 11 §2: the rows of the compare table, built from normalized
 * products. Each row is { key, label, values: [text per product] }; a
 * missing value is MISSING ("—"). The fixed rows come first, then the union
 * of the products' specification labels in the order they are first seen
 * (labels match case-insensitively, as the API keeps them unique that way).
 */

export const MISSING = '—'

const stockText = (product) => {
  if (product.type === 'gift_card') return 'Available'
  if (product.stock === 0 || product.availabilityStatus === 'Out of Stock') return 'Out of stock'
  if (product.availabilityStatus === 'Low Stock') return product.stock ? `Low stock (${product.stock} left)` : 'Low stock'
  if (product.stock === null || product.stock === undefined) return product.availabilityStatus ?? MISSING
  return 'In stock'
}

const optionsText = (product) =>
  (product.options ?? [])
    .filter((option) => option.values?.length > 0)
    .map((option) => `${option.name}: ${option.values.map((value) => value.value).join(', ')}`)
    .join('; ') || MISSING

/** Weight in grams (the API's unit): "250 g", or "1.2 kg" from 1,000 g. */
const weightText = (weight) => {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return MISSING
  return weight >= 1000 ? `${Number((weight / 1000).toFixed(2))} kg` : `${Math.round(weight)} g`
}

export function specificationLabels(products) {
  const labels = []
  const seen = new Set()
  for (const product of products) {
    for (const row of product.specifications ?? []) {
      const key = row.label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      labels.push(row.label)
    }
  }
  return labels
}

/** The text rows (everything but the image, price, rating, and actions, which are rendered specially). */
export function compareRows(products) {
  const fixed = [
    { key: 'stock', label: 'Stock', values: products.map(stockText) },
    { key: 'brand', label: 'Brand', values: products.map((product) => product.brand ?? MISSING) },
    { key: 'category', label: 'Category', values: products.map((product) => product.categoryName ?? (product.category ? formatSlug(product.category) : MISSING)) },
    { key: 'weight', label: 'Weight', values: products.map((product) => weightText(product.weight)) },
    { key: 'options', label: 'Options', values: products.map(optionsText) },
  ]
  const specs = specificationLabels(products).map((label) => ({
    key: `spec:${label.toLowerCase()}`,
    label,
    values: products.map((product) => product.specifications?.find((row) => row.label.toLowerCase() === label.toLowerCase())?.value || MISSING),
  }))
  return [...fixed, ...specs]
}

/** True when the products don't all have the same value. */
export const valuesDiffer = (values) => new Set(values.map((value) => String(value).trim().toLowerCase())).size > 1
