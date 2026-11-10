import { dummyJsonAccounts } from './dummyjson.js'
import { laravelAccounts } from './laravel.js'

/*
 * Where accounts live, chosen with VITE_ACCOUNTS_BACKEND (read on every call,
 * so the dev server, tests, and hosts can set it at any time):
 *   laravel    BuyNest's own API (backend/): real sign-up with an email code,
 *              password reset, separate admin accounts
 *   dummyjson  DummyJSON's public demo users (default; nothing is saved)
 *
 * Both connectors answer in the same shape, so the routes in authBff.js and
 * adminApi.js don't care which one is in use:
 *   success → { ok: true, profile?, tokens?: { accessToken, refreshToken }, data? }
 *   failure → { ok: false, status, body }   (body is safe to send to the browser)
 */
export function accounts() {
  return process.env.VITE_ACCOUNTS_BACKEND === 'laravel' ? laravelAccounts : dummyJsonAccounts
}
