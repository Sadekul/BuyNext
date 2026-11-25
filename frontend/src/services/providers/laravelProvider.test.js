import { describe, expect, it, vi } from 'vitest'
import { getCategories } from '../categoryService'
import { getProductById, getProducts } from '../productService'
import { mockFetch } from '../../test/mockFetch'

// The storefront with VITE_API_PROVIDER=laravel: the catalog comes through /api/catalog on this site.
vi.mock('./index', async () => ({ apiProvider: (await import('./laravelProvider')).laravelProvider }))

const RESOURCE = { id: 1, name: 'Mascara', price: '9.99', discount_percent: 10.48, sale_price: '8.94', stock_quantity: 99, availability: 'in_stock', category: { slug: 'beauty' } }

describe('Laravel catalog through /api/catalog', () => {
  it('asks this site (not an API address), sends no cookies, and maps the answers', async () => {
    const fetchMock = mockFetch({
      'GET /api/catalog/products': { body: { data: [RESOURCE], meta: { current_page: 1, per_page: 12, total: 1 } } },
      'GET /api/catalog/products/1': { body: { data: RESOURCE } },
      'GET /api/catalog/categories': { body: { data: [{ slug: 'beauty', name: 'Beauty', image_url: null }] } },
    })
    const page = await getProducts({ limit: 12, sortBy: 'price', order: 'desc' })
    expect(page.items[0]).toMatchObject({ id: 1, title: 'Mascara', price: 9.99, category: 'beauty' })
    expect(await getProductById(1)).toMatchObject({ title: 'Mascara' })
    expect(await getCategories()).toEqual([{ slug: 'beauty', name: 'Beauty', parentSlug: null, depth: 0 }])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url.origin).toBe(window.location.origin)
    expect(Object.fromEntries(url.searchParams)).toEqual({ per_page: '12', page: '1', sort: 'price', direction: 'desc' })
    expect(init.credentials).toBe('omit')
    expect(init.headers['X-XSRF-TOKEN']).toBeUndefined()
  })

  it('asks for the best sellers with sort=best_selling (phase 17)', async () => {
    const fetchMock = mockFetch({ 'GET /api/catalog/products': { body: { data: [RESOURCE], meta: { current_page: 1, per_page: 12, total: 1 } } } })
    await getProducts({ limit: 12, sortBy: 'bestSelling', order: 'desc' })
    expect(Object.fromEntries(fetchMock.mock.calls[0][0].searchParams)).toEqual({ per_page: '12', page: '1', sort: 'best_selling', direction: 'desc' })
  })
})
