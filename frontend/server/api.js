import { json, readCookies } from './http.js'
import { AUTH_ROUTES } from './authBff.js'
import { handleAdminRequest } from './adminApi.js'
import { handleCatalogRequest } from './catalogApi.js'
import { handleShopRequest } from './shopApi.js'
import { handlePaymentsRequest } from './paymentsApi.js'
import { handleClientErrorRequest } from './clientErrorsApi.js'

/*
 * Entry point for BuyNest's server-side services, on the storefront's own
 * address. The same function runs in `npm run dev` / `npm run preview`
 * (vite.config.js), as Vercel functions (api/), and as a Netlify function
 * (netlify/functions/api.mjs):
 *   /api/auth/*     sign-in service (authBff.js)
 *   /api/admin/*    admin service, admins only (adminApi.js)
 *   /api/catalog/*  public product catalog, read-only (catalogApi.js)
 *   /api/shop/*     cart pricing and orders, guests too (shopApi.js)
 *   /api/payments/* payment provider webhooks (Stripe, PayPal), server to server (paymentsApi.js)
 *   /api/client-errors  browser error reports from the store and the admin (clientErrorsApi.js)
 */
export async function handleApiRequest(request) {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean) // ["api", "auth", "login"]

  // Stripe and PayPal call their webhooks from their own servers: no browser, no cookies, no
  // Fetch Metadata. Their signatures (checked by the API) are the protection.
  if (segments[0] === 'api' && segments[1] === 'payments') return handlePaymentsRequest(request, segments.slice(2))

  // Only BuyNest's own pages may call these services. Browsers label requests
  // that start on another website "cross-site" (Fetch Metadata), on top of
  // the SameSite=Strict cookies.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ message: 'Forbidden.' }, 403)

  const cookies = readCookies(request)

  if (segments[0] === 'api' && segments[1] === 'auth' && segments.length === 3) {
    const route = AUTH_ROUTES[`${request.method} ${segments[2]}`]
    return route ? route(request, cookies) : json({ message: 'Not found.' }, 404)
  }
  if (segments[0] === 'api' && segments[1] === 'admin') {
    return handleAdminRequest(request, segments.slice(2), cookies)
  }
  if (segments[0] === 'api' && segments[1] === 'catalog') return handleCatalogRequest(request, segments.slice(2))
  if (segments[0] === 'api' && segments[1] === 'shop') return handleShopRequest(request, segments.slice(2), cookies)
  if (segments[0] === 'api' && segments[1] === 'client-errors' && segments.length === 2) return handleClientErrorRequest(request)
  return json({ message: 'Not found.' }, 404)
}
