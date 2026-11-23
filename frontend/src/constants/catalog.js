export const PRODUCTS_PER_PAGE = 12

// Only sort fields DummyJSON actually supports (it silently ignores unknown ones).
// `sortBy`/`order` are sent to the API as query parameters.
// Phase 13: `labelKey` (catalog namespace) is what's shown; `label` stays the English text.
export const SORT_OPTIONS = [
  { value: 'featured', labelKey: 'sort.featured', label: 'Featured' },
  { value: 'price-asc', labelKey: 'sort.priceAsc', label: 'Price: low to high', sortBy: 'price', order: 'asc' },
  { value: 'price-desc', labelKey: 'sort.priceDesc', label: 'Price: high to low', sortBy: 'price', order: 'desc' },
  { value: 'rating-desc', labelKey: 'sort.ratingDesc', label: 'Top rated', sortBy: 'rating', order: 'desc' },
  { value: 'discount-desc', labelKey: 'sort.discountDesc', label: 'Biggest discount', sortBy: 'discountPercentage', order: 'desc' },
  { value: 'title-asc', labelKey: 'sort.titleAsc', label: 'Name: A to Z', sortBy: 'title', order: 'asc' },
]

/** Returns the sort option for a URL value, falling back to `defaultValue` for unknown input. */
export function getSortOption(value, defaultValue = 'featured') {
  return (
    SORT_OPTIONS.find((option) => option.value === value) ??
    SORT_OPTIONS.find((option) => option.value === defaultValue)
  )
}
