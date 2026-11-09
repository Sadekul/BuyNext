import { describe, expect, it } from 'vitest'
import { verifyCartWithServer } from './orderService'
import { mockFetch } from '../test/mockFetch'

const cartLine = { productId: 1, title: 'Phone', quantity: 1, price: 100, discountPercentage: 10 }
const serverCart = (line) => ({ 'POST /carts/add': { status: 201, body: { id: 51, discountedTotal: 90, products: [line] } } })

describe('verifyCartWithServer', () => {
  it('accepts a cart whose prices and discounts match the server', async () => {
    mockFetch(serverCart({ id: 1, price: 100, discountPercentage: 10 }))
    expect((await verifyCartWithServer([cartLine], 1)).problems).toEqual([])
  })

  // A stored cart can be edited in DevTools: a bigger discount must not pass as "verified".
  it('flags a discount that differs from the server', async () => {
    mockFetch(serverCart({ id: 1, price: 100, discountPercentage: 10 }))
    const { problems } = await verifyCartWithServer([{ ...cartLine, discountPercentage: 99 }], 1)
    expect(problems).toEqual(['The price of "Phone" has changed.'])
  })

  it('flags products the server no longer has', async () => {
    mockFetch({ 'POST /carts/add': { status: 201, body: { id: 51, discountedTotal: 0, products: [] } } })
    expect((await verifyCartWithServer([cartLine], 1)).problems).toEqual(['"Phone" is no longer available.'])
  })
})
