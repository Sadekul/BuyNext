import { vi } from 'vitest'

/**
 * Replaces fetch with a route table: { 'GET /api/admin/me': { status, body } }.
 * A value can also be a function (url, init) => route. Unknown routes fail loudly.
 */
export function mockFetch(routes) {
  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = new URL(input instanceof URL ? input.href : input)
    const key = `${init.method ?? 'GET'} ${url.pathname}`
    const route = typeof routes[key] === 'function' ? routes[key](url, init) : routes[key]
    if (!route) throw new Error(`mockFetch: no route for ${key}`)
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const ADMIN = { id: 1, username: 'emilys', name: 'Emily Johnson', firstName: 'Emily', lastName: 'Johnson', role: 'admin' }

/** The readable "an admin session exists" cookie the admin service sets. */
export const withSession = () => {
  document.cookie = 'buynest_admin_session=session; Path=/'
}
