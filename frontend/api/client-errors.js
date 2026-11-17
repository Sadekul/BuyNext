// Vercel function for /api/client-errors: browser error reports from the store and the admin (server/api.js).
import { handleApiRequest } from '../server/api.js'

export const POST = handleApiRequest
