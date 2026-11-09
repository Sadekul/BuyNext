// Central route paths so links never hard-code URLs in many places.
export const ROUTES = {
  home: '/',
  products: '/products',
  productDetails: (productId) => `/products/${productId}`,
  category: (categorySlug) => `/categories/${categorySlug}`,
  deals: '/deals',
  cart: '/cart',
  checkout: '/checkout',
  wishlist: '/wishlist',
  account: '/account',
  componentLab: '/learn',
}
