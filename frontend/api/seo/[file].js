// Vercel function for /sitemap.xml and /robots.txt (rewritten here by vercel.json): files for search engines (server/seoApi.js).
import { handleSeoRequest } from '../../server/seoApi.js'

export const GET = handleSeoRequest
export const HEAD = handleSeoRequest
