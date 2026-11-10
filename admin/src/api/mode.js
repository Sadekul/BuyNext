/*
 * Where products and orders come from (the storefront's settings, read at build time):
 *   live  BuyNest's Laravel API: real products (with a status) and real orders
 *         that admins move along (VITE_API_PROVIDER=laravel with Laravel accounts).
 *   demo  DummyJSON's demo data: changes are checked but not saved.
 * Customers are real with Laravel accounts either way (CustomersPage).
 */
export const LIVE_DATA = import.meta.env.VITE_API_PROVIDER === 'laravel' && import.meta.env.VITE_ACCOUNTS_BACKEND === 'laravel'
