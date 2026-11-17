import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ADMIN, mockFetch, withSession } from '../test/mockFetch'
import { renderApp } from '../test/renderApp'

// Phase 8: card payments through Stripe on the admin's order page (BuyNest's API).
vi.mock('../api/mode', () => ({ LIVE_DATA: true }))

const ADDRESS = { firstName: 'Ava', lastName: 'Guest', line1: '12 Market Street', line2: '', city: 'Springfield', state: 'Oregon', postalCode: '29112', country: 'United States' }
const LINK = 'https://checkout.stripe.com/c/pay/cs_test_b2#fid'
const NO_PAYMENT = { provider: null, reference: null, dashboardUrl: null, mode: null, paidAt: null, url: null, expiresAt: null, canPay: false }
const ORDER = {
  id: 'BN-100001', number: 'BN-100001', status: 'pending_payment', paymentStatus: 'unpaid', paymentMethod: 'card',
  shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' }, email: 'ava@example.com', phone: '+15550100100',
  shippingAddress: ADDRESS, billingAddress: ADDRESS, couponCode: null,
  customer: { id: null, guest: true, firstName: 'Ava', lastName: 'Guest', email: 'ava@example.com' },
  lines: [{ id: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 8.94, quantity: 2, discountedTotal: 17.88 }],
  totals: { itemCount: 2, subtotal: 17.88, discount: 0, shipping: 4.99, tax: 0, total: 22.87 }, items: 2, placedAt: '2026-11-16T10:00:00Z',
  history: [{ status: 'pending_payment', paymentStatus: 'unpaid', note: 'Order placed.', adminName: null, customerNotified: false, createdAt: '2026-11-16T10:00:00Z' }],
  payment: { ...NO_PAYMENT, provider: 'stripe', canPay: true },
  live: true,
}
const PAID = {
  ...ORDER, status: 'processing', paymentStatus: 'paid',
  invoices: [{ number: 'INV-100001', amount: 22.87, createdAt: '2026-11-16T10:05:00Z', adminName: null, note: 'Paid by card through Stripe.' }],
  payment: { ...NO_PAYMENT, provider: 'stripe', reference: 'pi_3Test', dashboardUrl: 'https://dashboard.stripe.com/test/payments/pi_3Test', mode: 'test', paidAt: '2026-11-16T10:05:00Z' },
  history: [...ORDER.history, { status: 'processing', paymentStatus: 'paid', note: 'Invoice INV-100001 created; payment of $22.87 recorded. Paid by card through Stripe.', adminName: null, customerNotified: true, createdAt: '2026-11-16T10:05:00Z' }],
}
const sentTo = (fetchMock, method, path) => fetchMock.mock.calls.find(([url, init]) => init?.method === method && new URL(url).pathname === path)

describe('Stripe payments on the order page', () => {
  it('a paid order shows the provider, the reference linked to Stripe’s test dashboard, and when it was paid', async () => {
    withSession()
    mockFetch({ 'GET /api/admin/me': { body: ADMIN }, 'GET /api/admin/orders/BN-100001': { body: PAID } })
    renderApp('/orders/BN-100001')
    const panel = (await screen.findByRole('heading', { name: 'Delivery and payment' })).closest('section')
    expect(within(panel).getByText('Stripe')).toBeInTheDocument()
    expect(within(panel).getByText('Test mode')).toBeInTheDocument()
    const reference = within(panel).getByRole('link', { name: /pi_3Test/ })
    expect(reference).toHaveAttribute('href', 'https://dashboard.stripe.com/test/payments/pi_3Test')
    expect(reference).toHaveAttribute('target', '_blank')
    expect(reference).toHaveAccessibleName(/opens the payment in Stripe's test dashboard, in a new tab/)
    expect(within(panel).getByText('Paid at')).toBeInTheDocument()
    expect(within(panel).queryByText('Payment link')).not.toBeInTheDocument()
    // Made by the webhook, not an admin.
    expect(screen.getByRole('link', { name: 'INV-100001' }).closest('li')).toHaveTextContent('by Stripe')
    expect(screen.getByText(/Paid by card through Stripe\.$/).closest('li')).toHaveTextContent('by Stripe')
  })

  it('an unpaid card order offers a payment link to create and copy', async () => {
    withSession()
    const withLink = { ...ORDER, payment: { ...ORDER.payment, url: LINK, expiresAt: '2026-11-17T10:00:00Z' } }
    const fetchMock = mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': { body: ORDER },
      'POST /api/admin/orders/BN-100001/payment-link': { body: { payment: withLink.payment, order: withLink, live: true } },
    })
    const user = userEvent.setup()
    // After setup(): user-event puts its own clipboard in place.
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderApp('/orders/BN-100001')
    expect(await screen.findByText('No payment page is open for this order.')).toBeInTheDocument()
    expect(screen.getByText(/the order moves to Processing by itself once Stripe confirms the payment/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create payment link' }))
    const field = await screen.findByLabelText('Payment link for order BN-100001')
    expect(field).toHaveValue(LINK)
    expect(sentTo(fetchMock, 'POST', '/api/admin/orders/BN-100001/payment-link')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Get a new link' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(LINK)
    await waitFor(() => expect(screen.getByText('Payment link copied.')).toHaveAttribute('role', 'status'))
  })

  it('shows why a payment link can’t be made (422)', async () => {
    withSession()
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': { body: ORDER },
      'POST /api/admin/orders/BN-100001/payment-link': { status: 422, body: { message: 'This order has already been paid.', errors: { order: ['This order has already been paid.'] } } },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    await user.click(await screen.findByRole('button', { name: 'Create payment link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This order has already been paid.')
  })

  it('a Stripe-paid order is refunded to the card through Stripe, and Stripe’s refusal is shown', async () => {
    withSession()
    const limits = { items: [{ orderItemId: 11, name: 'Mascara', sku: 'BEA-1', ordered: 2, refunded: 0, refundable: 2, unitRefund: 8.94 }], shippingRefundable: 4.99, maxTotal: 22.87 }
    mockFetch({
      'GET /api/admin/me': { body: ADMIN },
      'GET /api/admin/orders/BN-100001': { body: PAID },
      'GET /api/admin/orders/BN-100001/refundable': { body: limits },
      'POST /api/admin/orders/BN-100001/credit-memos': {
        status: 422,
        body: { message: 'Stripe refused the refund: Charge ch_1 has already been refunded.', errors: { refund: ['Stripe refused the refund: Charge ch_1 has already been refunded.'] } },
      },
    })
    const user = userEvent.setup()
    renderApp('/orders/BN-100001')
    await user.click(await screen.findByRole('button', { name: 'Refund' }))
    const dialog = screen.getByRole('dialog', { name: 'Refund order BN-100001' })
    expect(dialog).toHaveTextContent("The refund goes back to the customer's card through Stripe")
    await user.type(await within(dialog).findByLabelText('Quantity of Mascara to refund (up to 2)'), '1')
    await user.click(within(dialog).getByRole('button', { name: 'Refund $8.94' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stripe refused the refund: Charge ch_1 has already been refunded.')
  })
})
