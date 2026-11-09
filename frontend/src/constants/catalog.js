export const PRODUCTS_PER_PAGE = 12

// Only sort fields DummyJSON actually supports (it silently ignores unknown ones).
// `sortBy`/`order` are sent to the API as query parameters.
export const SORT_OPTIONS = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: low to high', sortBy: 'price', order: 'asc' },
  { value: 'price-desc', label: 'Price: high to low', sortBy: 'price', order: 'desc' },
  { value: 'rating-desc', label: 'Top rated', sortBy: 'rating', order: 'desc' },
  { value: 'discount-desc', label: 'Biggest discount', sortBy: 'discountPercentage', order: 'desc' },
  { value: 'title-asc', label: 'Name: A to Z', sortBy: 'title', order: 'asc' },
]

/** Returns the sort option for a URL value, falling back to `defaultValue` for unknown input. */
export function getSortOption(value, defaultValue = 'featured') {
  return (
    SORT_OPTIONS.find((option) => option.value === value) ??
    SORT_OPTIONS.find((option) => option.value === defaultValue)
  )
}
