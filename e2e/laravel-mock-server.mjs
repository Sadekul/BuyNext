/*
 * A stand-in for the future BuyNest Laravel API (docs/backend/API_CONTRACT.md),
 * answering in Laravel's format (`data` + `meta`, snake_case, decimal strings)
 * with 30 made-up products. Used by laravel.mjs to prove the storefront
 * switches backends with a settings change only.
 *   node laravel-mock-server.mjs [port]   (default 8765)
 */
import { createServer } from 'node:http'

const PORT = Number(process.argv[2] ?? 8765)
const CATEGORIES = [
  { slug: 'beauty', name: 'Beauty' },
  { slug: 'laptops', name: 'Laptops' },
  { slug: 'smartphones', name: 'Smartphones' },
]
const IMAGES = {
  beauty: 'https://cdn.dummyjson.com/product-images/beauty/essence-mascara-lash-princess/thumbnail.webp',
  laptops: 'https://cdn.dummyjson.com/product-images/laptops/apple-macbook-pro-14-inch-space-grey/thumbnail.webp',
  smartphones: 'https://cdn.dummyjson.com/product-images/smartphones/iphone-13-pro/thumbnail.webp',
}

const PRODUCTS = Array.from({ length: 30 }, (_, index) => {
  const id = index + 1
  const category = CATEGORIES[index % CATEGORIES.length]
  const stock = id % 7 === 0 ? 0 : (id * 13) % 60
  return {
    id,
    name: `Laravel ${category.name} Item ${id}`,
    description: `Served by the mock Laravel API (product ${id}).`,
    sku: `LRV-${String(id).padStart(4, '0')}`,
    category,
    brand: { name: id % 2 ? 'NestWorks' : 'Harbor' },
    price: (19.99 + id * 10).toFixed(2), // Laravel decimals arrive as strings
    discount_percent: (id % 4) * 5,
    rating_average: ((id % 5) + 0.5).toFixed(1),
    stock_quantity: stock,
    availability: stock === 0 ? 'out_of_stock' : stock < 10 ? 'low_stock' : 'in_stock',
    thumbnail_url: IMAGES[category.slug],
    images: [{ url: IMAGES[category.slug] }],
    min_order_quantity: 1,
    tags: [category.slug],
    reviews: [{ rating: 5, comment: 'Great.', created_at: '2026-01-01T00:00:00Z', author_name: 'Mock Reviewer' }],
  }
})

const SORT_FIELDS = { price: (product) => Number(product.price), rating: (product) => Number(product.rating_average), discount: (product) => product.discount_percent, name: (product) => product.name }

function send(response, request, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    // The storefront runs on another port: allow it, with cookies (Sanctum style).
    'Access-Control-Allow-Origin': request.headers.origin ?? '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Accept, Content-Type, X-XSRF-TOKEN',
    Vary: 'Origin',
  })
  response.end(body === undefined ? '' : JSON.stringify(body))
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') return send(response, request, 204)
  const url = new URL(request.url, `http://localhost:${PORT}`)

  if (url.pathname === '/api/v1/categories') return send(response, request, 200, { data: CATEGORIES })

  const detail = url.pathname.match(/^\/api\/v1\/products\/(\d+)$/)
  if (detail) {
    const product = PRODUCTS.find((item) => item.id === Number(detail[1]))
    return product ? send(response, request, 200, { data: product }) : send(response, request, 404, { message: 'Product not found.' })
  }

  if (url.pathname === '/api/v1/products') {
    const search = url.searchParams.get('search')?.toLowerCase()
    const category = url.searchParams.get('category')
    let items = PRODUCTS.filter(
      (product) => (!search || product.name.toLowerCase().includes(search)) && (!category || product.category.slug === category),
    )
    const sort = SORT_FIELDS[url.searchParams.get('sort')]
    if (sort) {
      const direction = url.searchParams.get('direction') === 'desc' ? -1 : 1
      items = [...items].sort((a, b) => (sort(a) > sort(b) ? 1 : sort(a) < sort(b) ? -1 : 0) * direction)
    }
    const perPage = Math.min(Number(url.searchParams.get('per_page')) || 15, 100)
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
    return send(response, request, 200, {
      data: items.slice((page - 1) * perPage, page * perPage),
      meta: { current_page: page, per_page: perPage, total: items.length, last_page: Math.max(1, Math.ceil(items.length / perPage)) },
    })
  }

  send(response, request, 404, { message: 'Not found.' })
})

server.listen(PORT, () => console.log(`Mock Laravel API on http://localhost:${PORT}`))
