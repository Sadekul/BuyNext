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
  stockAlerts: '/account/stock-alerts', // "email me when it's back" (REAL_SHOP)
  privacy: '/account/privacy', // download my data, delete my account (REAL_SHOP)
  accountDeleted: '/goodbye', // after deleting the account (REAL_SHOP)
  stockAlertsUnsubscribe: '/stock-alerts/unsubscribe', // the link in back-in-stock emails (REAL_SHOP)
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  verifyEmail: '/verify-email',
  page: (slug) => `/pages/${slug}`, // CMS pages (REAL_SHOP)
  newsletterConfirm: '/newsletter/confirm', // links in newsletter emails (REAL_SHOP)
  newsletterUnsubscribe: '/newsletter/unsubscribe',
  componentLab: '/learn',
}
