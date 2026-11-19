// Vercel function for /api/payments/*: the Stripe and PayPal webhooks and the SSLCommerz IPN, server to server, and
// (phase 12) SSLCommerz's return trip, a form POST from the shopper's browser answered with a 303 (server/api.js → server/paymentsApi.js).
// A Web-standard handler: Vercel hands over the request body unparsed, so the signed bytes reach the API unchanged.
import { handleApiRequest } from '../../server/api.js'

export const POST = handleApiRequest
