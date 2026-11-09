import { axiosClient } from './axiosClient'

/*
 * LEARNING EXAMPLES — the five HTTP methods against DummyJSON.
 * IMPORTANT: DummyJSON only *simulates* POST, PUT, PATCH, and DELETE.
 * It returns realistic responses, but nothing is saved on the server.
 */
export const HTTP_EXAMPLES = [
  {
    id: 'get',
    method: 'GET',
    path: '/products/1',
    description: 'Read one product.',
  },
  {
    id: 'get-missing',
    method: 'GET',
    path: '/products/99999',
    description: 'Read a product that does not exist → 404 Not Found.',
  },
  {
    id: 'post',
    method: 'POST',
    path: '/products/add',
    body: { title: 'BuyNest Bamboo Desk Lamp', price: 49.99, category: 'home-decoration' },
    description: 'Create a new product → 201 Created (simulated).',
  },
  {
    id: 'put',
    method: 'PUT',
    path: '/products/1',
    body: { title: 'Replaced title', price: 12.5 },
    description: 'Replace a product. True PUT replaces the whole resource; DummyJSON merges instead.',
  },
  {
    id: 'patch',
    method: 'PATCH',
    path: '/products/1',
    body: { price: 7.99 },
    description: 'Update only some fields of a product (simulated).',
  },
  {
    id: 'delete',
    method: 'DELETE',
    path: '/products/1',
    description: 'Delete a product → response includes isDeleted: true (simulated).',
  },
]

/** Runs `send(example)` and adds how long it took in milliseconds. */
export async function sendTimed(send, example) {
  const startedAt = performance.now()
  const result = await send(example)
  return { ...result, ms: Math.round(performance.now() - startedAt) }
}

/** Native fetch: we build the URL, set headers, stringify, parse, and check status ourselves. */
export async function sendWithFetch({ method, path, body }) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json()
  // A 404 does NOT throw with fetch — it's still a "successful" network round trip.
  return { status: response.status, data }
}

/** Axios: one call. A 404 THROWS, so we read the response from the error. */
export async function sendWithAxios({ method, path, body }) {
  try {
    const response = await axiosClient.request({ method, url: path, data: body })
    return { status: response.status, data: response.data }
  } catch (error) {
    if (error.response) return { status: error.response.status, data: error.response.data }
    throw error // no response at all: network failure or timeout
  }
}
