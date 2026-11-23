import { ROUTES } from './routes'
import { REAL_SHOP } from './shop'
import { translate } from '../i18n'

// The /learn component lab is a teaching tool: on in development, off in
// production builds unless VITE_SHOW_LEARNING_LAB=true.
export const SHOW_LEARNING_LAB = import.meta.env.DEV || import.meta.env.VITE_SHOW_LEARNING_LAB === 'true'

export const SITE = {
  name: 'BuyNest',
  tagline: 'Your Modern Shopping Destination',
  // Placeholder contact details (example.com / 555-01xx are reserved for examples).
  supportEmail: 'support@buynest.example.com',
  supportPhone: '+1 (555) 010-2030',
}

// Sample store-policy copy for the learning build; confirm with the business before launch.
// Phase 13: translated when shown (common:announcements.*); this English list is kept for reference.
export const ANNOUNCEMENTS = ['30-day hassle-free returns', 'Members get early access to seasonal sales']
const announcements = () => [translate('common:announcements.returns'), translate('common:announcements.earlyAccess')]

/**
 * The announcement strip: the free-shipping line follows the store's own threshold and currency
 * (phase 12: "৳5,000" in a taka store, not a hard-coded "$50"); no threshold, no line.
 * `format` writes an amount in the store currency (formatBasePrice); whole amounts drop ".00".
 */
/** The free-shipping threshold written for a sentence ("$50", "৳৫,০০০"), or null when the store has none. */
export function freeShippingAmount(freeShippingThreshold, format) {
  const threshold = Number(freeShippingThreshold)
  if (!(freeShippingThreshold != null && Number.isFinite(threshold) && threshold > 0)) return null
  return format(threshold).replace(/\.00$/, '').replace(/\.০০$/, '')
}

export function storeAnnouncements(freeShippingThreshold, format) {
  const amount = freeShippingAmount(freeShippingThreshold, format)
  if (amount === null) return announcements()
  return [translate('common:announcements.freeShipping', { amount }), ...announcements()]
}

// Phase 13: `labelKey`/`titleKey` are keys in the `common` namespace; `label`/`title` stay as the English text.
export const MAIN_NAV_LINKS = [
  { label: 'Home', labelKey: 'nav.home', to: ROUTES.home },
  { label: 'Shop all', labelKey: 'nav.shopAll', to: ROUTES.products },
  { label: 'Smartphones', labelKey: 'nav.smartphones', to: ROUTES.category('smartphones') },
  { label: 'Laptops', labelKey: 'nav.laptops', to: ROUTES.category('laptops') },
  { label: 'Fashion', labelKey: 'nav.fashion', to: ROUTES.category('womens-bags') },
  { label: 'Fragrances', labelKey: 'nav.fragrances', to: ROUTES.category('fragrances') },
  { label: 'Home & living', labelKey: 'nav.homeLiving', to: ROUTES.category('furniture') },
  { label: 'Deals', labelKey: 'nav.deals', to: ROUTES.deals, highlight: true },
]

export const FOOTER_LINK_GROUPS = [
  {
    title: 'Shop',
    titleKey: 'footer.groups.shop',
    links: [
      { label: 'All products', labelKey: 'footer.links.allProducts', to: ROUTES.products },
      { label: 'Smartphones', labelKey: 'nav.smartphones', to: ROUTES.category('smartphones') },
      { label: 'Laptops', labelKey: 'nav.laptops', to: ROUTES.category('laptops') },
      { label: 'Deals', labelKey: 'nav.deals', to: ROUTES.deals },
    ],
  },
  {
    title: 'My account',
    titleKey: 'footer.groups.account',
    links: [
      { label: 'Account', labelKey: 'footer.links.account', to: ROUTES.account },
      { label: 'Wishlist', labelKey: 'nav.wishlist', to: ROUTES.wishlist },
      { label: 'Cart', labelKey: 'nav.cart', to: ROUTES.cart },
      // Guests look up an order with its number and email (real orders only).
      ...(REAL_SHOP
        ? [
            { label: 'Track your order', labelKey: 'footer.links.trackOrder', to: ROUTES.trackOrder },
            // Phase 10: gift cards (real orders only).
            { label: 'Check gift card balance', labelKey: 'footer.links.giftCardBalance', to: ROUTES.giftCardBalance },
          ]
        : []),
    ],
  },
  // The admin's CMS pages (REAL_SHOP; seeded by the API, editable in the admin).
  ...(REAL_SHOP
    ? [
        {
          title: 'Help & info',
          titleKey: 'footer.groups.help',
          links: [
            { label: 'About us', labelKey: 'footer.links.about', to: ROUTES.page('about') },
            { label: 'Shipping & returns', labelKey: 'footer.links.shippingReturns', to: ROUTES.page('shipping-and-returns') },
            { label: 'Privacy policy', labelKey: 'footer.links.privacy', to: ROUTES.page('privacy') },
            { label: 'Terms of service', labelKey: 'footer.links.terms', to: ROUTES.page('terms') },
            { label: 'Contact us', labelKey: 'footer.links.contact', to: ROUTES.page('contact') },
          ],
        },
      ]
    : []),
  ...(SHOW_LEARNING_LAB ? [{ title: 'Learning', titleKey: 'footer.groups.learning', links: [{ label: 'Component lab', labelKey: 'footer.links.componentLab', to: ROUTES.componentLab }] }] : []),
]

// Replace with BuyNest's real profile URLs once they exist.
export const SOCIAL_LINKS = [
  { label: 'Facebook', href: 'https://www.facebook.com/', icon: 'facebook' },
  { label: 'Instagram', href: 'https://www.instagram.com/', icon: 'instagram' },
  { label: 'X', href: 'https://x.com/', icon: 'x' },
  { label: 'YouTube', href: 'https://www.youtube.com/', icon: 'youtube' },
]
