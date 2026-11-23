import { translate } from '../i18n'

/*
 * Phase 13: catalog words that come as English codes from the data
 * (DummyJSON's / the API's `availabilityStatus`), shown in the shopper's language.
 */
const AVAILABILITY_KEYS = { 'In Stock': 'inStock', 'Low Stock': 'lowStock', 'Out of Stock': 'outOfStock' }

/** "In Stock" → "স্টকে আছে" in Bangla; an unknown status is shown as given. */
export function availabilityLabel(status) {
  const key = AVAILABILITY_KEYS[status]
  return key ? translate(`catalog:availability.${key}`) : status
}
