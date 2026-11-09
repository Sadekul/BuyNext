import { describe, expect, it } from 'vitest'
import { mergeWishlists } from './wishlistReducer'

const item = (productId, addedAt) => ({ productId, title: `P${productId}`, price: 10, addedAt })

describe('mergeWishlists (guest list → account on sign-in)', () => {
  it('keeps every product once, newest first', () => {
    const account = { items: [item(1, 300), item(2, 100)] }
    const guest = { items: [item(2, 400), item(3, 200)] }
    expect(mergeWishlists(account, guest).items.map((saved) => saved.productId)).toEqual([1, 3, 2])
  })
})
