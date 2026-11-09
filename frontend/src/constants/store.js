// Store-wide display settings. Values that affect money (shipping, discounts)
// are display-only on the frontend; the backend stays the source of truth.
export const STORE_SETTINGS = {
  locale: 'en-US',
  currency: 'USD',
  // A product shows a "sale" badge when its discount is at least this percentage.
  saleBadgeMinDiscount: 10,
}
