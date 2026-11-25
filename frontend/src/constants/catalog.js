import { CAN_SORT_BY_BEST_SELLING, CAN_SORT_BY_NEWEST } from '../services/productService'

export const PRODUCTS_PER_PAGE = 12

// Only sort fields DummyJSON actually supports (it silently ignores unknown ones).
// `sortBy`/`order` are sent to the API as query parameters.
// Phase 13: `labelKey` (catalog namespace) is what's shown; `label` stays the English text.
// Phase 17: "Best selling" and "Newest" need data only BuyNest's API has (units sold, dates):
// `serverSort` asks the API for that order (the catalog keeps it, utils/catalog.js has no
// comparator), and `requires` names the API capability (productService CAN_SORT_BY_*), so
// the demo doesn't offer them and `?sort=best-selling` falls back to the default there.
export const SORT_OPTIONS = [
  { value: 'featured', labelKey: 'sort.featured', label: 'Featured' },
  { value: 'price-asc', labelKey: 'sort.priceAsc', label: 'Price: low to high', sortBy: 'price', order: 'asc' },
  { value: 'price-desc', labelKey: 'sort.priceDesc', label: 'Price: high to low', sortBy: 'price', order: 'desc' },
  { value: 'rating-desc', labelKey: 'sort.ratingDesc', label: 'Top rated', sortBy: 'rating', order: 'desc' },
  { value: 'discount-desc', labelKey: 'sort.discountDesc', label: 'Biggest discount', sortBy: 'discountPercentage', order: 'desc' },
  { value: 'title-asc', labelKey: 'sort.titleAsc', label: 'Name: A to Z', sortBy: 'title', order: 'asc' },
  // Phase 17, last so the existing options keep their positions.
  { value: 'best-selling', labelKey: 'sort.bestSelling', label: 'Best selling', serverSort: 'bestSelling', requires: 'bestSelling' },
  { value: 'newest', labelKey: 'sort.newest', label: 'Newest', serverSort: 'createdAt', requires: 'newest' },
]

const API_CAPABILITIES = { bestSelling: CAN_SORT_BY_BEST_SELLING, newest: CAN_SORT_BY_NEWEST }

/** The sort options this catalog can really give (`capabilities` defaults to the current API's). */
export function availableSortOptions(capabilities = API_CAPABILITIES) {
  return SORT_OPTIONS.filter((option) => !option.requires || capabilities[option.requires] === true)
}

/** Returns the sort option for a URL value, falling back to `defaultValue` for unknown (or unavailable) input. */
export function getSortOption(value, defaultValue = 'featured', capabilities = API_CAPABILITIES) {
  const options = availableSortOptions(capabilities)
  return options.find((option) => option.value === value) ?? options.find((option) => option.value === defaultValue) ?? options[0]
}
