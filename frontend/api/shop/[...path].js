// Vercel function for /api/shop/*: cart pricing and orders, for guests and customers (server/api.js).
// PATCH and DELETE: the address book (phase 6) and stock alerts (phase 9).
import { handleApiRequest } from '../../server/api.js'

export const GET = handleApiRequest
export const POST = handleApiRequest
export const PATCH = handleApiRequest
export const DELETE = handleApiRequest
