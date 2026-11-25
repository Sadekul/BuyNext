import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PaymentBadges from './PaymentBadges'
import { paymentBadgeIds } from '../../utils/payment'
import { switchToBangla } from '../../test/i18n'

// Phase 17 §3.5: payment badges from the store's payment methods (own text badges, no brand logos).
describe('payment badges', () => {
  it('SSLCommerz stands for bKash, Nagad and cards; each badge once; unknown ids are left out', () => {
    expect(paymentBadgeIds(['sslcommerz', 'cod'])).toEqual(['bkash', 'nagad', 'card', 'cod'])
    expect(paymentBadgeIds([{ id: 'card' }, { id: 'paypal' }, { id: 'cod' }])).toEqual(['card', 'paypal', 'cod'])
    expect(paymentBadgeIds(['sslcommerz', 'card'])).toEqual(['bkash', 'nagad', 'card'])
    expect(paymentBadgeIds(['crypto'])).toEqual([])
    expect(paymentBadgeIds()).toEqual([])
  })

  it('"We accept" with one text badge per way to pay, and no image', () => {
    const { container } = render(<PaymentBadges paymentMethods={[{ id: 'sslcommerz' }, { id: 'cod' }]} />)
    const list = screen.getByRole('list', { name: 'We accept' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['bKash', 'Nagad', 'Cards', 'Cash on delivery'])
    expect(container.querySelector('img')).toBeNull()
  })

  it('nothing when the store offers no known method; Bangla names in Bangla', async () => {
    const { container, unmount } = render(<PaymentBadges paymentMethods={[]} />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    await switchToBangla()
    render(<PaymentBadges paymentMethods={['sslcommerz', 'cod']} />)
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['বিকাশ', 'নগদ', 'কার্ড', 'ক্যাশ অন ডেলিভারি'])
  })
})
