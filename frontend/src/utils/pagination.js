/**
 * Page numbers to show: always first, last, and current ±1, with "…" gaps.
 * getPageItems(5, 10) → [1, 'gap-4', 4, 5, 6, 'gap-10', 10]  ('gap-…' items render as "…")
 */
export function getPageItems(currentPage, pageCount) {
  const pages = new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1])
  const sorted = [...pages].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b)

  const items = []
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) items.push(`gap-${page}`)
    items.push(page)
  })
  return items
}
