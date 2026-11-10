// Vercel function for /api/catalog/*: BuyNest's public, read-only product catalog (server/api.js).
import { handleApiRequest } from '../../server/api.js'

export const GET = handleApiRequest
