// Vercel function for /api/auth/<action>: the BuyNest sign-in service (server/authBff.js).
import { handleAuthRequest } from '../../server/authBff.js'

export const GET = handleAuthRequest
export const POST = handleAuthRequest
export const PUT = handleAuthRequest
