// Central route paths so links never hard-code URLs in many places.
export const ROUTES = {
  home: '/',
  products: '/products',
  productDetails: (productId) => `/products/${productId}`,
  category: (categorySlug) => `/categories/${categorySlug}`,
  deals: '/deals',
  cart: '/cart',
  checkout: '/checkout',
  orderConfirmation: (orderId) => `/order-confirmation/${orderId}`,
  trackOrder: '/track-order',
  wishlist: '/wishlist',
  account: '/account',
  orders: '/account/orders',
  orderDetails: (orderId) => `/account/orders/${orderId}`,
  invoice: (orderId, invoiceNumber) => `/account/orders/${orderId}/invoices/${invoiceNumber}`,
  addresses: '/account/addresses', // address book (REAL_SHOP)
  returns: '/account/returns', // returns (REAL_SHOP)
  returnDetails: (returnNumber) => `/account/returns/${returnNumber}`,
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  verifyEmail: '/verify-email',
  page: (slug) => `/pages/${slug}`, // CMS pages (REAL_SHOP)
  newsletterConfirm: '/newsletter/confirm', // links in newsletter emails (REAL_SHOP)
  newsletterUnsubscribe: '/newsletter/unsubscribe',
  componentLab: '/learn',
}
