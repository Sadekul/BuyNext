// Laravel mode: the storefront on the mock Laravel API, with only settings changed (no code changes).
// Starts its own servers: the mock API (:8765) and a Laravel-mode storefront dev server (:5174).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { launch, reporter, visible, watchErrors } from './lib.mjs'

const BASE = 'http://localhost:5174'
const API = 'http://localhost:8765'
const FRONTEND = fileURLToPath(new URL('../frontend/', import.meta.url))
const report = reporter('Laravel mode')
const { log } = report

const children = [
  spawn(process.execPath, [fileURLToPath(new URL('./laravel-mock-server.mjs', import.meta.url)), '8765'], { stdio: 'ignore' }),
  spawn(process.execPath, [`${FRONTEND}node_modules/vite/bin/vite.js`, '--port', '5174', '--strictPort'], {
    cwd: FRONTEND,
    env: { ...process.env, VITE_API_PROVIDER: 'laravel', VITE_API_BASE_URL: API },
    stdio: 'ignore',
  }),
]
const stop = () => children.forEach((child) => child.kill())
process.on('exit', stop)

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await fetch(url).then(() => true, () => false)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url} did not start`)
}
await waitFor(`${API}/api/v1/categories`)
await waitFor(BASE)

const browser = await launch()
const errors = []
const page = watchErrors(await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(), errors)
const apiHosts = new Set()
page.on('request', (request) => {
  const { hostname, port, pathname } = new URL(request.url())
  if (!/\.(webp|png|jpe?g|svg|woff2?)$/.test(pathname) && hostname !== 'localhost') apiHosts.add(hostname)
  if (port === '8765') apiHosts.add('mock-laravel')
})
const resultCount = async () => Number((await page.getByText(/of \d+ products?$/).first().textContent()).match(/of (\d+)/)[1])

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
log(await visible(page.getByText(/Laravel .* Item/).first()), 'home: products come from the Laravel API')
await page.goto(`${BASE}/products`, { waitUntil: 'networkidle' })
await page.locator('.product-card').first().waitFor()
log((await resultCount()) === 30, `catalog: all 30 mock products (${await resultCount()})`)
log((await page.locator('.product-card').count()) === 12, 'catalog: 12 per page')
await page.goto(`${BASE}/categories/laptops`, { waitUntil: 'networkidle' })
log((await resultCount()) === 10, `category page: laptops = 10 (${await resultCount()})`)
await page.goto(`${BASE}/products?q=item%201`, { waitUntil: 'networkidle' })
log((await resultCount()) > 0, `search works (${await resultCount()} results for "item 1")`)
await page.goto(`${BASE}/products/7`, { waitUntil: 'networkidle' })
log(await visible(page.getByRole('heading', { name: 'Laravel Beauty Item 7', level: 1 })), 'product page: details from the Laravel API')
log(await visible(page.getByText('Served by the mock Laravel API (product 7).')), 'product page: description mapped from snake_case')
log(await visible(page.getByText(/out of stock/i)), 'product page: availability mapped ("out_of_stock")')
await page.goto(`${BASE}/products/999`, { waitUntil: 'networkidle' })
log(await visible(page.getByText(/not found/i)), 'unknown product: Laravel 404 → "not found"')
log(apiHosts.has('mock-laravel') && !apiHosts.has('dummyjson.com'), `catalog data only from the Laravel API (hosts: ${[...apiHosts].join(', ')})`)

log(errors.length === 0, `no page errors ${JSON.stringify(errors)}`)
report.done()
await browser.close()
stop()
