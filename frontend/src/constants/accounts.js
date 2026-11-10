/*
 * Where customer accounts live (VITE_ACCOUNTS_BACKEND, read at build time):
 *   'laravel'   BuyNest's own API: real sign-up with an emailed 6-digit code,
 *               password reset by code, profile changes that are saved
 *   'dummyjson' DummyJSON's demo users (default): sign in with a demo account;
 *               sign-up and password reset are only simulated
 * The sign-in service (server/accounts) reads the same setting.
 */
export const ACCOUNTS_BACKEND = import.meta.env.VITE_ACCOUNTS_BACKEND === 'laravel' ? 'laravel' : 'dummyjson'

/** True when accounts are real (saved, verified by email). */
export const REAL_ACCOUNTS = ACCOUNTS_BACKEND === 'laravel'

/**
 * A demo account to offer on the sign-in page, or null.
 * DummyJSON: a public demo user. Laravel: the account `php artisan db:seed`
 * creates, offered only by the dev server (import.meta.env.DEV is false in
 * production builds, so they never contain it).
 */
export const DEMO_ACCOUNT = REAL_ACCOUNTS
  ? import.meta.env.DEV
    ? { email: 'customer@buynest.test', password: 'CustomerPass2026' }
    : null
  : (import.meta.env.VITE_API_PROVIDER || 'dummyjson') === 'dummyjson'
    ? { username: 'emilys', password: 'emilyspass' }
    : null
