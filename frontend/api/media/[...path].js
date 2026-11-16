// Vercel function for /media/* (rewritten here by vercel.json): uploaded product photos, streamed from the API's storage (server/mediaApi.js).
import { handleMediaRequest } from '../../server/mediaApi.js'

export const GET = handleMediaRequest
export const HEAD = handleMediaRequest
