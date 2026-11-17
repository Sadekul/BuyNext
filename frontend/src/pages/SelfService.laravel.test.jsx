import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route } from 'react-router'
import ProfilePage from './ProfilePage'
import PrivacyPage from './PrivacyPage'
import AccountDeletedPage from './AccountDeletedPage'
import StockAlertsPage from './StockAlertsPage'
import StockAlertUnsubscribePage from './StockAlertUnsubscribePage'
import OrderDetailsPage from './OrderDetailsPage'
import TrackOrderPage from './TrackOrderPage'
import ProductDetailsPage from './ProductDetailsPage'
import ProductCard from '../components/product/ProductCard'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'

// Phase 9 self-service with BuyNest's API: change email, privacy, cancel order, stock alerts, responsive photos.
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const signIn = ({ remember = false } = {}) => {
  document.cookie = `buynest_session=${remember ? 'remember' : 'session'}; Path=/`
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember }))
}
const NADIA = { id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: '+8801712345678', role: 'customer', emailVerified: true }
const ME = { 'GET /api/auth/me': { body: NADIA }, 'GET /api/shop/me/cart': { body: { items: [], itemCount: 0, updatedAt: null } } }
const sent = (fetchMock, method, path) => {
  const call = fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === path && (init?.method ?? 'GET') === method).at(-1)
  return call && JSON.parse(call[1].body)
}

describe('change email (Account → Profile)', () => {
  it('sends a code to the new address with the password, then switches with the code', async () => {
    signIn()
    const fetchMock = mockFetch({
      ...ME,
      'POST /api/shop/me/email': (url, init) => {
        const body = JSON.parse(init.body)
        if (body.password !== 'Secret123') return { status: 422, body: { message: 'Your password is incorrect.', errors: { password: ['Your password is incorrect.'] } } }
        return { body: { email: 'new@example.com', expiresIn: 600, resendIn: 60, message: 'We emailed a 6-digit code to new@example.com. Your email stays the same until you enter it.' } }
      },
      'POST /api/shop/me/email/confirm': { body: { ...NADIA, email: 'new@example.com' } },
    })
    const user = userEvent.setup()
    renderWithProviders(<ProfilePage />, { route: '/account', path: '/account' })
    await user.click(await screen.findByRole('button', { name: 'Change email' }))

    const form = screen.getByRole('form', { name: 'Change your email' })
    await user.click(within(form).getByRole('button', { name: 'Send code' }))
    expect(within(form).getByLabelText('New email')).toHaveAccessibleDescription('Enter your email address.')
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).pathname === '/api/shop/me/email')).toBe(false)

    await user.type(within(form).getByLabelText('New email'), 'nadia@example.com')
    await user.type(within(form).getByLabelText('Current password'), 'wrong')
    await user.click(within(form).getByRole('button', { name: 'Send code' }))
    expect(within(form).getByLabelText('New email')).toHaveAccessibleDescription('This is already your email address.')

    await user.clear(within(form).getByLabelText('New email'))
    await user.type(within(form).getByLabelText('New email'), 'new@example.com')
    await user.click(within(form).getByRole('button', { name: 'Send code' }))
    expect(await within(form).findByText('Your password is incorrect.')).toBeInTheDocument()

    await user.clear(within(form).getByLabelText('Current password'))
    await user.type(within(form).getByLabelText('Current password'), 'Secret123')
    await user.click(within(form).getByRole('button', { name: 'Send code' }))

    const confirm = await screen.findByRole('form', { name: 'Confirm your new email' })
    expect(within(confirm).getByText('new@example.com')).toBeInTheDocument()
    expect(within(confirm).getByLabelText('Code')).toHaveFocus()
    await user.type(within(confirm).getByLabelText('Code'), '123456')
    await user.click(within(confirm).getByRole('button', { name: 'Confirm new email' }))

    expect(await screen.findByText("Your email is now new@example.com. We've let your old address know.")).toBeInTheDocument()
    expect(sent(fetchMock, 'POST', '/api/shop/me/email/confirm')).toEqual({ code: '123456' })
    expect(sent(fetchMock, 'POST', '/api/shop/me/email')).toEqual({ email: 'new@example.com', password: 'Secret123' })
  })

  it('opens the code step when a change is already waiting for its code', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/auth/me': { body: { ...NADIA, pendingEmail: 'waiting@example.com' } } })
    renderWithProviders(<ProfilePage />, { route: '/account', path: '/account' })
    const confirm = await screen.findByRole('form', { name: 'Confirm your new email' })
    expect(within(confirm).getByText('waiting@example.com')).toBeInTheDocument()
  })
})

describe('privacy (Account → Privacy)', () => {
  const renderPrivacy = () =>
    renderWithProviders(<PrivacyPage />, {
      route: '/account/privacy',
      path: '/account/privacy',
      extraRoutes: (
        <>
          <Route path="/goodbye" element={<AccountDeletedPage />} />
          <Route path="/" element={<p>Home page</p>} />
        </>
      ),
    })

  it('deletes the account only with the password and DELETE typed, then signs out and says goodbye', async () => {
    signIn({ remember: true })
    window.localStorage.setItem('buynest.wishlist.v1.user-5', JSON.stringify({ items: [{ id: 1 }] }))
    const fetchMock = mockFetch({ ...ME, 'POST /api/shop/me/delete': { body: { message: 'Your account was deleted.' } }, 'POST /api/auth/logout': { body: { ok: true } } })
    const user = userEvent.setup()
    renderPrivacy()

    const form = screen.getByRole('form', { name: 'Delete my account' })
    await user.type(within(form).getByLabelText('Your password'), 'Secret123')
    await user.type(within(form).getByLabelText('Type DELETE to confirm'), 'delete')
    await user.click(within(form).getByRole('button', { name: 'Delete my account' }))
    expect(within(form).getByLabelText('Type DELETE to confirm')).toHaveAccessibleDescription('Type DELETE to confirm.')
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).pathname === '/api/shop/me/delete')).toBe(false)

    await user.clear(within(form).getByLabelText('Type DELETE to confirm'))
    await user.type(within(form).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(form).getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByRole('heading', { name: 'Your account was deleted' })).toHaveFocus()
    expect(sent(fetchMock, 'POST', '/api/shop/me/delete')).toEqual({ password: 'Secret123', confirm: 'DELETE' })
    expect(document.cookie).not.toContain('buynest_session=')
    // Remembered or not, a deleted account leaves nothing on this device.
    await waitFor(() => expect(window.localStorage.getItem('buynest.wishlist.v1.user-5')).toBeNull())
    expect(window.localStorage.getItem('buynest.session.v2')).toBeNull()
  })

  it("shows the API's reason when the account can't be deleted yet", async () => {
    signIn()
    const message = "You have 1 open order (pending payment, processing, or shipped). You can delete your account once it's delivered or cancelled."
    mockFetch({ ...ME, 'POST /api/shop/me/delete': { status: 422, body: { message, errors: { account: [message] } } } })
    const user = userEvent.setup()
    renderPrivacy()
    const form = screen.getByRole('form', { name: 'Delete my account' })
    await user.type(within(form).getByLabelText('Your password'), 'Secret123')
    await user.type(within(form).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(form).getByRole('button', { name: 'Delete my account' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(message)
    expect(document.cookie).toContain('buynest_session=')
  })

  it('downloads the file the API sends, with its name', async () => {
    signIn()
    const file = '{"profile":{"email":"nadia@example.com"}}'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const { pathname } = new URL(input, window.location.origin)
        if (pathname === '/api/shop/me/export') {
          return new Response(file, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="buynest-my-data-2026-11-17.json"' } })
        }
        return new Response(JSON.stringify(pathname === '/api/auth/me' ? NADIA : {}), { headers: { 'Content-Type': 'application/json' } })
      }),
    )
    URL.createObjectURL = vi.fn(() => 'blob:buynest')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordClick() {
      expect(this.download).toBe('buynest-my-data-2026-11-17.json')
      expect(this.href).toBe('blob:buynest')
    })
    const user = userEvent.setup()
    renderPrivacy()
    await user.click(screen.getByRole('button', { name: 'Download my data' }))
    expect(await screen.findByText('Your file buynest-my-data-2026-11-17.json was downloaded.')).toBeInTheDocument()
    expect(click).toHaveBeenCalledTimes(1)
    expect(await URL.createObjectURL.mock.calls[0][0].text()).toBe(file)
  })

  it('shows the export limit message', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/me/export': { status: 429, body: { message: 'Too Many Attempts.' } } })
    const user = userEvent.setup()
    renderPrivacy()
    await user.click(screen.getByRole('button', { name: 'Download my data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too Many Attempts.')
  })
})

const ORDER = {
  number: 'BN-100045', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod', shippingMethod: { id: 'standard', label: 'Standard', eta: '3–5 business days' },
  email: 'guest@example.com', phone: '+1 555 0100', couponCode: null, items: [], totals: { itemCount: 0, subtotal: 10, discount: 0, shipping: 0, tax: 0, total: 10 },
  shippingAddress: { firstName: 'G', lastName: 'U', line1: '1 Road', line2: '', city: 'Town', state: 'ST', postalCode: '1', country: 'US' },
  billingAddress: { firstName: 'G', lastName: 'U', line1: '1 Road', line2: '', city: 'Town', state: 'ST', postalCode: '1', country: 'US' },
  placedAt: '2026-11-17T09:00:00Z', history: [], shipments: [], invoices: [], creditMemos: [], canCancel: true,
}
const CANCELLED = { ...ORDER, status: 'cancelled', canCancel: false }

describe('cancel my order', () => {
  it('asks in a dialog, then cancels the customer’s order with the reason', async () => {
    signIn()
    const fetchMock = mockFetch({ ...ME, 'GET /api/shop/orders/BN-100045': { body: ORDER }, 'POST /api/shop/orders/BN-100045/cancel': { body: CANCELLED } })
    const user = userEvent.setup()
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100045', path: '/account/orders/:orderId' })
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }))

    const dialog = screen.getByRole('dialog', { name: 'Cancel order BN-100045?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep my order' }))
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/cancel'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Cancel order' }))
    await user.type(within(dialog).getByLabelText(/Why are you cancelling/), 'Ordered twice')
    await user.click(within(dialog).getByRole('button', { name: 'Yes, cancel it' }))

    expect(await screen.findByText("Order BN-100045 was cancelled. We've emailed you a confirmation.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
    expect(sent(fetchMock, 'POST', '/api/shop/orders/BN-100045/cancel')).toEqual({ reason: 'Ordered twice' })
  })

  it("shows the API's text when the order was paid or shipped meanwhile", async () => {
    signIn()
    const message = "This order has been paid or shipped, so it can't be cancelled online. Contact us to cancel it: support@buynest.test"
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100045': { body: ORDER }, 'POST /api/shop/orders/BN-100045/cancel': { status: 422, body: { message, errors: { order: [message] } } } })
    const user = userEvent.setup()
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100045', path: '/account/orders/:orderId' })
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }))
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('has no cancel button when the API says the order can’t be cancelled', async () => {
    signIn()
    mockFetch({ ...ME, 'GET /api/shop/orders/BN-100045': { body: { ...ORDER, canCancel: false } } })
    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100045', path: '/account/orders/:orderId' })
    expect(await screen.findByRole('heading', { name: 'Order BN-100045' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument()
  })

  it('a guest cancels from order tracking with the email that found the order', async () => {
    const fetchMock = mockFetch({ 'POST /api/shop/orders/lookup': { body: ORDER }, 'POST /api/shop/orders/BN-100045/cancel': { body: CANCELLED } })
    const user = userEvent.setup()
    renderWithProviders(<TrackOrderPage />)
    await user.type(screen.getByLabelText('Order number'), 'BN-100045')
    await user.type(screen.getByLabelText('Email'), 'Guest@Example.com')
    await user.click(screen.getByRole('button', { name: 'Find my order' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }))
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
    expect(await screen.findByText("Order BN-100045 was cancelled. We've emailed you a confirmation.")).toBeInTheDocument()
    expect(sent(fetchMock, 'POST', '/api/shop/orders/BN-100045/cancel')).toEqual({ email: 'Guest@Example.com' })
  })
})

describe('"Email me when it\'s back"', () => {
  const LAMP = { id: 12, name: 'Desk Lamp', price: '30.00', stock_quantity: 0, availability: 'out_of_stock', images: [], thumbnail_url: 'https://cdn.dummyjson.com/l.png', reviews: [] }
  const MESSAGE = "We'll email you when it's back in stock."
  const catalog = (product) => ({ 'GET /api/catalog/products/12': { body: { data: product } }, 'GET /api/catalog/categories': { body: { data: [] } } })
  const renderLamp = () => renderWithProviders(<ProductDetailsPage />, { route: '/products/12', path: '/products/:productId' })

  it('guests give an email; the answer is the same message every time', async () => {
    const fetchMock = mockFetch({ ...catalog(LAMP), 'POST /api/shop/products/12/stock-alerts': { status: 202, body: { message: 'Thanks!' } } })
    const user = userEvent.setup()
    renderLamp()
    const section = await screen.findByRole('region', { name: 'Sold out for now' })
    await user.click(within(section).getByRole('button', { name: "Email me when it's back" }))
    expect(within(section).getByLabelText('Your email')).toHaveAccessibleDescription(/Enter your email address/)
    await user.type(within(section).getByLabelText('Your email'), 'guest@example.com')
    await user.click(within(section).getByRole('button', { name: "Email me when it's back" }))
    expect(await within(section).findByRole('status')).toHaveTextContent(MESSAGE)
    expect(sent(fetchMock, 'POST', '/api/shop/products/12/stock-alerts')).toEqual({ email: 'guest@example.com' })
  })

  it('signed-in customers get one button (no email field)', async () => {
    signIn()
    const fetchMock = mockFetch({ ...ME, ...catalog(LAMP), 'POST /api/shop/products/12/stock-alerts': { status: 202, body: { message: 'Thanks!' } } })
    const user = userEvent.setup()
    renderLamp()
    const section = await screen.findByRole('region', { name: 'Sold out for now' })
    expect(within(section).queryByLabelText('Your email')).not.toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: "Email me when it's back" }))
    expect(await within(section).findByRole('status')).toHaveTextContent(MESSAGE)
    expect(sent(fetchMock, 'POST', '/api/shop/products/12/stock-alerts')).toEqual({})
  })

  it('works per variant: a sold-out variant can be chosen and is sent with the alert', async () => {
    const TEE = {
      ...LAMP, id: 12, name: 'Tee', stock_quantity: 3, availability: 'in_stock', has_variants: true,
      options: [{ id: 1, name: 'Size', values: [{ id: 11, value: 'S' }, { id: 12, value: 'M' }] }],
      variants: [
        { id: 51, option_value_ids: [11], price: '20.00', stock_quantity: 3, in_stock: true },
        { id: 52, option_value_ids: [12], price: '20.00', stock_quantity: 0, in_stock: false },
      ],
    }
    const fetchMock = mockFetch({ ...catalog(TEE), 'POST /api/shop/products/12/stock-alerts': { status: 202, body: {} } })
    const user = userEvent.setup()
    renderLamp()
    await user.click(await screen.findByRole('radio', { name: 'S' }))
    expect(screen.queryByRole('button', { name: "Email me when it's back" })).not.toBeInTheDocument() // in stock
    await user.click(screen.getByRole('radio', { name: /M.*sold out/ }))
    const section = screen.getByRole('region', { name: 'Size: M is sold out' })
    await user.type(within(section).getByLabelText('Your email'), 'guest@example.com')
    await user.click(within(section).getByRole('button', { name: "Email me when it's back" }))
    expect(await within(section).findByRole('status')).toHaveTextContent(MESSAGE)
    expect(sent(fetchMock, 'POST', '/api/shop/products/12/stock-alerts')).toEqual({ email: 'guest@example.com', variantId: 52 })
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled()
  })

  it('Account → Stock alerts lists the alerts and removes one', async () => {
    signIn()
    const alert = { id: 3, productId: 12, title: 'Desk Lamp', thumbnail: null, variantId: null, variantLabel: null, createdAt: '2026-11-17T10:00:00Z' }
    const fetchMock = mockFetch({ ...ME, 'GET /api/shop/me/stock-alerts': { body: { alerts: [alert] } }, 'DELETE /api/shop/me/stock-alerts/3': { body: { ok: true } } })
    const user = userEvent.setup()
    renderWithProviders(<StockAlertsPage />, { route: '/account/stock-alerts', path: '/account/stock-alerts' })
    expect(await screen.findByRole('link', { name: 'Desk Lamp' })).toHaveAttribute('href', '/products/12')
    await user.click(screen.getByRole('button', { name: 'Remove the alert for Desk Lamp' }))
    expect(await screen.findByText("You won't get an email about Desk Lamp.")).toBeInTheDocument()
    expect(screen.getByText('No stock alerts')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && new URL(url).pathname === '/api/shop/me/stock-alerts/3')).toBe(true)
  })

  it('the email link stops the alerts after one click', async () => {
    const fetchMock = mockFetch({ 'POST /api/shop/stock-alerts/unsubscribe': { body: { removed: 2, message: "You won't get any more back-in-stock emails for these products." } } })
    const user = userEvent.setup()
    renderWithProviders(<StockAlertUnsubscribePage />, { route: '/stock-alerts/unsubscribe?token=7.abc', path: '/stock-alerts/unsubscribe' })
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Stop these emails' }))
    expect(await screen.findByRole('status')).toHaveTextContent("You won't get any more back-in-stock emails")
    expect(sent(fetchMock, 'POST', '/api/shop/stock-alerts/unsubscribe')).toEqual({ token: '7.abc' })
  })
})

describe('responsive photos on product cards', () => {
  const HEX = 'c'.repeat(32)
  const product = { id: 1, title: 'Lamp', price: 10, discountPercentage: 0, rating: null, stock: 5, thumbnail: `/media/products/1/${HEX}.jpg` }

  it('offers the copies with sizes for the layout, and keeps the original as src', () => {
    const variants = { 320: `/media/products/1/${HEX}-320.webp`, 960: `/media/products/1/${HEX}-960.webp` }
    const grid = renderWithProviders(<ProductCard product={{ ...product, thumbnailVariants: variants }} />)
    const image = grid.container.querySelector('.product-card__media img')
    expect(image).toHaveAttribute('src', product.thumbnail)
    expect(image).toHaveAttribute('srcset', `${variants[320]} 320w, ${variants[960]} 960w, ${product.thumbnail} 1600w`)
    expect(image).toHaveAttribute('sizes', '(min-width: 900px) 300px, 50vw')
    grid.unmount()
    const list = renderWithProviders(<ProductCard product={{ ...product, thumbnailVariants: variants }} layout="list" />)
    expect(list.container.querySelector('.product-card__media img')).toHaveAttribute('sizes', '(min-width: 640px) 208px, 30vw')
  })

  it('leaves photos without copies (and the DummyJSON demo) as they were', () => {
    const { container } = renderWithProviders(<ProductCard product={{ ...product, thumbnail: 'https://cdn.dummyjson.com/a.png' }} />)
    const image = container.querySelector('.product-card__media img')
    expect(image).not.toHaveAttribute('srcset')
    expect(image).not.toHaveAttribute('sizes')
  })
})
