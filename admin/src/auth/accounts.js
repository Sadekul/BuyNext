/*
 * Where admin accounts live (VITE_ACCOUNTS_BACKEND, shared with the storefront):
 *   laravel   BuyNest's API: shop staff accounts, separate from customers.
 *             Created with `php artisan buynest:create-admin`; they sign in with an email.
 *   dummyjson DummyJSON's demo users whose role is "admin"; they sign in with a username.
 */
export const REAL_ACCOUNTS = import.meta.env.VITE_ACCOUNTS_BACKEND === 'laravel'

export const ID_FIELD = REAL_ACCOUNTS
  ? { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }
  : { name: 'username', label: 'Username', type: 'text', autoComplete: 'username' }

/**
 * Demo admin credentials to offer, or null. Laravel: the account
 * `php artisan db:seed` creates, offered only by the dev server (production
 * builds never contain it).
 */
export const DEMO_ADMIN = REAL_ACCOUNTS
  ? import.meta.env.DEV
    ? { email: 'admin@buynest.test', password: 'AdminPass2026' }
    : null
  : { username: 'emilys', password: 'emilyspass' }
