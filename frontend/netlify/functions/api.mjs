// Netlify function for BuyNest's server-side services (server/api.js):
// the sign-in service, the admin service, the catalog, the shop, the payment webhooks and SSLCommerz's return trip (/api/payments/*, any depth), and browser error reports.
import { handleApiRequest } from '../../server/api.js'

export default handleApiRequest

export const config = { path: ['/api/auth/:action', '/api/admin/*', '/api/catalog/*', '/api/shop/*', '/api/payments/*', '/api/client-errors'] }
