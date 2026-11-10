export const LOW_STOCK = 10

/** Stock level → status for badges. Status colors always come with an icon and a label. */
export function stockStatus(stock) {
  if (stock <= 0) return { tone: 'danger', label: 'Out of stock' }
  if (stock < LOW_STOCK) return { tone: 'warning', label: 'Low stock' }
  return { tone: 'success', label: 'In stock' }
}
