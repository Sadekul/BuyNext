import { formatNumber, formatSlug } from './formatters'
import { translate } from '../i18n'
import { availabilityLabel } from './catalogText'

/*
 * Phase 11 §2: the rows of the compare table, built from normalized
 * products. Each row is { key, label, values: [text per product] }; a
 * missing value is MISSING ("—"). The fixed rows come first, then the union
 * of the products' specification labels in the order they are first seen
 * (labels match case-insensitively, as the API keeps them unique that way).
 */

export const MISSING = '—'

const stockText = (product) => {
  if (product.type === 'gift_card') return translate('catalog:compare.stock.available')
  if (product.stock === 0 || product.availabilityStatus === 'Out of Stock') return translate('catalog:compare.stock.out')
  if (product.availabilityStatus === 'Low Stock') return product.stock ? translate('catalog:compare.stock.lowLeft', { count: product.stock }) : translate('catalog:compare.stock.low')
  if (product.stock === null || product.stock === undefined) return product.availabilityStatus ? availabilityLabel(product.availabilityStatus) : MISSING
  return translate('catalog:compare.stock.in')
}

const optionsText = (product) =>
  (product.options ?? [])
    .filter((option) => option.values?.length > 0)
    .map((option) => `${option.name}: ${option.values.map((value) => value.value).join(', ')}`)
    .join('; ') || MISSING

/** Weight in grams (the API's unit): "250 g", or "1.2 kg" from 1,000 g. */
const weightText = (weight) => {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return MISSING
  return weight >= 1000
    ? translate('catalog:compare.kg', { value: formatNumber(Number((weight / 1000).toFixed(2))) })
    : translate('catalog:compare.g', { value: formatNumber(Math.round(weight)) })
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
    { key: 'stock', label: translate('catalog:compare.rows.stock'), values: products.map(stockText) },
    { key: 'brand', label: translate('catalog:compare.rows.brand'), values: products.map((product) => product.brand ?? MISSING) },
    { key: 'category', label: translate('catalog:compare.rows.category'), values: products.map((product) => product.categoryName ?? (product.category ? formatSlug(product.category) : MISSING)) },
    { key: 'weight', label: translate('catalog:compare.rows.weight'), values: products.map((product) => weightText(product.weight)) },
    { key: 'options', label: translate('catalog:compare.rows.options'), values: products.map(optionsText) },
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
