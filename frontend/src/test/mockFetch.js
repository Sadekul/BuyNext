import { vi } from 'vitest'

/**
 * API MOCKING: replaces the global fetch with a fake that answers from a
 * route table, so tests are fast, offline, and deterministic.
 *
 *   const fetchMock = mockFetch({
 *     'GET /products/1': { body: { id: 1, title: 'Phone' } },
 *     'GET /products/99': { status: 404, body: { message: 'Not found' } },
 *   })
 *
 * Keys are "METHOD /path" (query strings ignored). A handler can also be a
 * function (url, init) => response, or include `delay` in milliseconds.
 * Unknown routes fail loudly so a test never silently hits the network.
 */
export function mockFetch(routes) {
  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    const key = `${method} ${url.pathname}`
    const route = typeof routes[key] === 'function' ? routes[key](url, init) : routes[key]
    if (!route) throw new Error(`mockFetch: no route for ${key}`)
    if (route.delay) await new Promise((resolve) => setTimeout(resolve, route.delay))
    if (route.networkError) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
