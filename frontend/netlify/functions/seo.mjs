// Netlify function for /sitemap.xml and /robots.txt: files for search engines (server/seoApi.js).
import { handleSeoRequest } from '../../server/seoApi.js'

export default handleSeoRequest

export const config = { path: ['/sitemap.xml', '/robots.txt'] }
