// Vercel function for /api/admin/*: BuyNest's admin service, admins only (server/api.js).
import { handleApiRequest } from '../../server/api.js'

export const GET = handleApiRequest
export const POST = handleApiRequest
export const PUT = handleApiRequest
export const PATCH = handleApiRequest
export const DELETE = handleApiRequest
