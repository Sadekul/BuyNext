/*
 * Where orders live (read at build time):
 *   real  BuyNest's Laravel API prices carts and stores orders. Needs the
 *         Laravel catalog (VITE_API_PROVIDER=laravel) AND Laravel accounts
 *         (VITE_ACCOUNTS_BACKEND=laravel). Guests can check out; customers
 *         and guests get a confirmation email; order history comes from the API.
 *   demo  (anything else) DummyJSON checks the prices and the order is only
 *         saved in this browser; checking out needs a (demo) sign-in.
 */
export const REAL_SHOP = import.meta.env.VITE_API_PROVIDER === 'laravel' && import.meta.env.VITE_ACCOUNTS_BACKEND === 'laravel'
