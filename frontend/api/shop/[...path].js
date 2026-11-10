// Vercel function for /api/shop/*: cart pricing and orders, for guests and customers (server/api.js).
import { handleApiRequest } from '../../server/api.js'

export const GET = handleApiRequest
export const POST = handleApiRequest
