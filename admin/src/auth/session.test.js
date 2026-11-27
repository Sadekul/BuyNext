import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Phase 20 (SQA S1): after sign-in the admin loads the role's permissions from /me. When that
// fails, the app must fail closed (an empty list) instead of keeping the sign-in answer, whose
// missing list would show every screen and button.
const get = vi.fn()
const post = vi.fn()
vi.mock('../api/client', () => ({ api: { get: (...args) => get(...args), post: (...args) => post(...args) } }))
vi.mock('./accounts', () => ({ REAL_ACCOUNTS: true }))

const { startSession } = await import('./session')

const SIGN_IN_ANSWER = { id: 7, name: 'Viewer', email: 'viewer@example.com', role: 'admin' }

describe('startSession: loading the permissions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    get.mockReset()
    post.mockReset().mockResolvedValue(SIGN_IN_ANSWER)
  })
  afterEach(() => vi.useRealTimers())

  it('uses /me when it answers', async () => {
    get.mockResolvedValue({ ...SIGN_IN_ANSWER, permissions: ['orders.view'] })
    await expect(startSession({ email: 'viewer@example.com', password: 'x' })).resolves.toMatchObject({ permissions: ['orders.view'] })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('tries /me again after a slow or failed answer', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('timeout'), { status: 504 })).mockResolvedValue({ ...SIGN_IN_ANSWER, permissions: ['orders.view'] })
    const result = startSession({ email: 'viewer@example.com', password: 'x' })
    await vi.runAllTimersAsync()
    await expect(result).resolves.toMatchObject({ permissions: ['orders.view'] })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('fails closed after three failed tries: an empty permission list, not the sign-in answer', async () => {
    get.mockRejectedValue(Object.assign(new Error('busy'), { status: 503 }))
    const result = startSession({ email: 'viewer@example.com', password: 'x' })
    await vi.runAllTimersAsync()
    const user = await result
    expect(get).toHaveBeenCalledTimes(3)
    expect(user.permissions).toEqual([])
    expect(user.permissionsUnavailable).toBe(true)
  })

  it('does not retry when the server refuses the session', async () => {
    get.mockRejectedValue(Object.assign(new Error('disabled'), { status: 403 }))
    await expect(startSession({ email: 'viewer@example.com', password: 'x' })).rejects.toMatchObject({ status: 403 })
    expect(get).toHaveBeenCalledTimes(1)
  })
})
