// Vercel function for /api/payments/*: the Stripe webhook, server to server (server/api.js → server/paymentsApi.js).
// A Web-standard handler: Vercel hands over the request body unparsed, so the signed bytes reach the API unchanged.
import { handleApiRequest } from '../../server/api.js'

export const POST = handleApiRequest
