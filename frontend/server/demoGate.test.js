import { describe, expect, it, vi } from 'vitest'
import { basicPassword, demoGateMiddleware, demoPasswordMatches } from './demoGate.js'

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`

function run(password, authorization) {
  const headers = {}
  const res = {
    statusCode: 200,
    setHeader: (name, value) => (headers[name.toLowerCase()] = value),
    end: vi.fn(),
  }
  const next = vi.fn()
  demoGateMiddleware(password)({ headers: authorization ? { authorization } : {} }, res, next)
  return { res, headers, next }
}

describe('online demo gate', () => {
  it('reads the password from a Basic header (user name ignored, colons in the password kept)', () => {
    expect(basicPassword(basic('anyone', 'pa:ss'))).toBe('pa:ss')
    expect(basicPassword('Bearer abc')).toBeNull()
    expect(basicPassword(undefined)).toBeNull()
  })

  it('matches only the exact password', () => {
    expect(demoPasswordMatches(basic('x', 'Nest-2026'), 'Nest-2026')).toBe(true)
    expect(demoPasswordMatches(basic('x', 'nest-2026'), 'Nest-2026')).toBe(false)
    expect(demoPasswordMatches(basic('x', ''), 'Nest-2026')).toBe(false)
  })

  it('changes nothing when no demo password is set', () => {
    const { next, res, headers } = run(undefined)
    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(headers['www-authenticate']).toBeUndefined()
  })

  it('asks for the password without one, and refuses a wrong one', () => {
    for (const authorization of [undefined, basic('x', 'wrong')]) {
      const { next, res, headers } = run('Nest-2026', authorization)
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(401)
      expect(headers['www-authenticate']).toMatch(/^Basic realm="BuyNest demo"/)
      expect(headers['x-robots-tag']).toBe('noindex, nofollow')
    }
  })

  it('lets the right password through and still asks search engines not to index', () => {
    const { next, headers } = run('Nest-2026', basic('demo', 'Nest-2026'))
    expect(next).toHaveBeenCalled()
    expect(headers['x-robots-tag']).toBe('noindex, nofollow')
  })
})
