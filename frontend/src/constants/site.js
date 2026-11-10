import { ROUTES } from './routes'
import { REAL_SHOP } from './shop'

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
export const ANNOUNCEMENTS = [
  'Free standard shipping on orders over $50',
  '30-day hassle-free returns',
  'Members get early access to seasonal sales',
]

export const MAIN_NAV_LINKS = [
  { label: 'Home', to: ROUTES.home },
  { label: 'Shop all', to: ROUTES.products },
  { label: 'Smartphones', to: ROUTES.category('smartphones') },
  { label: 'Laptops', to: ROUTES.category('laptops') },
  { label: 'Fashion', to: ROUTES.category('womens-bags') },
  { label: 'Fragrances', to: ROUTES.category('fragrances') },
  { label: 'Home & living', to: ROUTES.category('furniture') },
  { label: 'Deals', to: ROUTES.deals, highlight: true },
]

export const FOOTER_LINK_GROUPS = [
  {
    title: 'Shop',
    links: [
      { label: 'All products', to: ROUTES.products },
      { label: 'Smartphones', to: ROUTES.category('smartphones') },
      { label: 'Laptops', to: ROUTES.category('laptops') },
      { label: 'Deals', to: ROUTES.deals },
    ],
  },
  {
    title: 'My account',
    links: [
      { label: 'Account', to: ROUTES.account },
      { label: 'Wishlist', to: ROUTES.wishlist },
      { label: 'Cart', to: ROUTES.cart },
      // Guests look up an order with its number and email (real orders only).
      ...(REAL_SHOP ? [{ label: 'Track your order', to: ROUTES.trackOrder }] : []),
    ],
  },
  // The admin's CMS pages (REAL_SHOP; seeded by the API, editable in the admin).
  ...(REAL_SHOP
    ? [
        {
          title: 'Help & info',
          links: [
            { label: 'About us', to: ROUTES.page('about') },
            { label: 'Shipping & returns', to: ROUTES.page('shipping-and-returns') },
            { label: 'Privacy policy', to: ROUTES.page('privacy') },
            { label: 'Terms of service', to: ROUTES.page('terms') },
            { label: 'Contact us', to: ROUTES.page('contact') },
          ],
        },
      ]
    : []),
  ...(SHOW_LEARNING_LAB ? [{ title: 'Learning', links: [{ label: 'Component lab', to: ROUTES.componentLab }] }] : []),
]

// Replace with BuyNest's real profile URLs once they exist.
export const SOCIAL_LINKS = [
  { label: 'Facebook', href: 'https://www.facebook.com/', icon: 'facebook' },
  { label: 'Instagram', href: 'https://www.instagram.com/', icon: 'instagram' },
  { label: 'X', href: 'https://x.com/', icon: 'x' },
  { label: 'YouTube', href: 'https://www.youtube.com/', icon: 'youtube' },
]
