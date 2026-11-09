import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiClient, isAbortError } from './apiClient'
import { mockFetch } from '../test/mockFetch'

describe('apiClient', () => {
  it('builds the URL from the base URL and skips empty params', async () => {
    const fetchMock = mockFetch({ 'GET /products': { body: { ok: true } } })
    await expect(apiClient.get('/products', { params: { q: 'phone', page: 2, empty: '', none: undefined } })).resolves.toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0].toString()).toBe('https://api.test/products?q=phone&page=2')
  })

  it('sends JSON bodies with the right headers', async () => {
    const fetchMock = mockFetch({ 'POST /carts/add': { status: 201, body: { id: 1 } } })
    await apiClient.post('/carts/add', { userId: 1 })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"userId":1}')
  })

  it('turns 4xx/5xx responses into ApiError with the server message', async () => {
    mockFetch({ 'GET /products/9': { status: 404, body: { message: "Product with id '9' not found" } } })
    const error = await apiClient.get('/products/9').catch((caught) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, message: "Product with id '9' not found" })
  })

  it('uses a friendly fallback message when the server sends none', async () => {
    mockFetch({ 'GET /x': { status: 503, body: {} } })
    await expect(apiClient.get('/x')).rejects.toMatchObject({ message: 'The server had a problem. Please try again later.' })
  })

  it('reports network failures with status 0', async () => {
    mockFetch({ 'GET /x': { networkError: true } })
    await expect(apiClient.get('/x')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Network error/) })
  })

  it('exposes Laravel-style 422 field errors', async () => {
    mockFetch({ 'POST /api/v1/orders': { status: 422, body: { message: 'Invalid', errors: { 'shipping_address.city': ['Required.'] } } } })
    const error = await apiClient.post('/api/v1/orders', {}).catch((caught) => caught)
    expect(error.fieldErrors).toEqual({ 'shipping_address.city': ['Required.'] })
  })

  it('passes cancellations through as AbortError (not a failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('Aborted', 'AbortError'))))
    const error = await apiClient.get('/x', { signal: new AbortController().signal }).catch((caught) => caught)
    expect(isAbortError(error)).toBe(true)
  })
})
