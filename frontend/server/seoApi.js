import { laravelFile } from './http.js'

/*
 * Files for search engines (backend phase 7, §5), on the storefront's own address:
 *   GET /sitemap.xml  every product, category, and published page, from
 *                     BuyNest's API (GET /api/v1/sitemap.xml). The DummyJSON
 *                     demo has no API of its own, so it lists the main pages only.
 *   GET /robots.txt   what crawlers may visit, written here, pointing at the
 *                     sitemap on this same address.
 * Served the same way everywhere: `npm run dev` / `npm run preview`
 * (vite.config.js), Vercel (api/seo/[file].js, via vercel.json rewrites), and
 * Netlify (netlify/functions/seo.mjs). HEAD works too; other methods get 405.
 */

// Areas crawlers should skip: the shop owner's dashboard, the customer's own pages, and the services.
const DISALLOWED = ['/admin/', '/account', '/checkout', '/api/']
const XML = 'application/xml; charset=utf-8'
const SITEMAP_CACHE = 'public, max-age=900' // the API's own: 15 minutes
const ROBOTS_CACHE = 'public, max-age=3600'

const usesLaravel = () => process.env.VITE_API_PROVIDER === 'laravel'

/**
 * The site's public origin, from the address the request came to (the host
 * sets it; forwarded headers are ignored, so a crafted header can't put
 * another site's address into a cached robots.txt).
 */
const originOf = (request) => new URL(request.url).origin

function text(body, status, contentType, cache, request) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: { 'Content-Type': contentType, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' },
  })
}

export function robotsTxt(origin) {
  return ['User-agent: *', ...DISALLOWED.map((path) => `Disallow: ${path}`), '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n')
}

const escapeXml = (value) => value.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char])

/** The demo's sitemap: the pages that exist without BuyNest's API. */
export function demoSitemap(origin) {
  const urls = ['/', '/products', '/deals'].map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

async function sitemap(request) {
  if (!usesLaravel()) return text(demoSitemap(originOf(request)), 200, XML, SITEMAP_CACHE, request)
  const result = await laravelFile('/api/v1/sitemap.xml', { request })
  // Only an XML sitemap is passed on; anything else (an error page, JSON) is not.
  if (result.status !== 200 || typeof result.text !== 'string' || !/^\s*<\?xml[\s\S]*<urlset[\s>]/.test(result.text.slice(0, 500))) {
    return text('The sitemap is not available right now.\n', result.status >= 400 && result.status !== 404 ? 502 : 503, 'text/plain; charset=utf-8', 'no-store', request)
  }
  return text(result.text, 200, XML, SITEMAP_CACHE, request)
}

/** /sitemap.xml and /robots.txt, also reachable as /api/seo/<file> (the Vercel function's address). */
export async function handleSeoRequest(request) {
  const { pathname } = new URL(request.url)
  const file = pathname.replace(/^\/api\/seo\//, '/')
  if (file !== '/sitemap.xml' && file !== '/robots.txt') return text('Not found.\n', 404, 'text/plain; charset=utf-8', 'no-store', request)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const response = text('Method not allowed.\n', 405, 'text/plain; charset=utf-8', 'no-store', request)
    response.headers.set('Allow', 'GET, HEAD')
    return response
  }
  if (file === '/robots.txt') return text(robotsTxt(originOf(request)), 200, 'text/plain; charset=utf-8', ROBOTS_CACHE, request)
  return sitemap(request)
}
