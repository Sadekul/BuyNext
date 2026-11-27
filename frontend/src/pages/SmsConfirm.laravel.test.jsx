import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SmsConfirmPage from './SmsConfirmPage'
import CheckoutPage from './CheckoutPage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { expectNoEnglish, switchToBangla } from '../test/i18n'
import { normalizeStoreSettings } from '../services/adapters/contentAdapter'
import { DEFAULT_STORE_SETTINGS } from '../hooks/useStoreSettings'
import { ROUTES } from '../constants/routes'
import { resetDisplayCurrencyForTests } from '../utils/displayCurrency'

/*
 * Phase 20 (docs/backend/PHASE20_CONTRACT.md §3): the one-tap confirmation link
 * from the cash on delivery text (/c/:token), and the checkout line under the
 * phone field while the store texts order updates (GET /store `sms_updates`).
 */
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

afterEach(() => resetDisplayCurrencyForTests())

const TOKEN = 'Q2hhbmdlTWUtYS1yYW5kb20tdG9rZW4tMzJieXRlcw'
const LINK = `/api/shop/order-confirmations/${TOKEN}`
const STORE = (extra = {}) => ({ body: { data: { store_name: 'BuyNest', payment_methods: ['cod'], currency: { code: 'BDT', symbol: '৳', decimals: 2 }, currencies: { base: 'BDT', display: [] }, ...extra } } })
const SUMMARY = (extra = {}) => ({ number: 'BN-100042', total: 1250, itemsCount: 3, placedAt: '2026-11-27T10:15:00+06:00', status: 'pending', ...extra })
const open = () => renderWithProviders(<SmsConfirmPage />, { route: ROUTES.smsConfirm(TOKEN), path: '/c/:token' })
const routes = (summary, extra = {}) => ({ 'GET /api/catalog/store': STORE(), [`GET ${LINK}`]: summary, ...extra })
const posts = (fetchMock) => fetchMock.mock.calls.filter(([url, init]) => new URL(url).pathname === LINK && init?.method === 'POST')

describe('confirmation page /c/:token', () => {
  it('shows a loader, then the summary with the two buttons; opening the link changes nothing', async () => {
    const fetchMock = mockFetch(routes({ body: SUMMARY(), delay: 20 }))
    open()
    expect(screen.getByRole('status')).toHaveTextContent('Loading your order…')
    await screen.findByRole('button', { name: 'Confirm my order' })
    expect(screen.getByRole('heading', { level: 1, name: 'Confirm your order' })).toBeInTheDocument()
    const summary = screen.getByText('BN-100042').closest('dl')
    expect(summary).toHaveAccessibleName('Order summary')
    expect(within(summary).getByText('BN-100042')).toBeInTheDocument()
    expect(within(summary).getByText('3 items')).toBeInTheDocument()
    expect(within(summary).getByText('Nov 27, 2026')).toBeInTheDocument()
    await waitFor(() => expect(within(summary).getByText('৳1,250.00')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Confirm my order' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel this order' })).toBeEnabled()
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Track your order' })).toBeNull()
    expect(posts(fetchMock)).toHaveLength(0)
  })

  it('Confirm: thanks the shopper in a status message that takes the focus', async () => {
    const fetchMock = mockFetch(routes({ body: SUMMARY() }, { [`POST ${LINK}`]: { body: SUMMARY({ status: 'confirmed' }) } }))
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Confirm my order' }))
    const result = await screen.findByText("Thank you, your order BN-100042 is confirmed. We'll text you when it ships.")
    const status = result.closest('[role="status"]')
    expect(status).not.toBeNull()
    await waitFor(() => expect(status).toHaveFocus())
    expect(JSON.parse(posts(fetchMock)[0][1].body)).toEqual({ action: 'confirm' })
    expect(screen.queryByRole('button', { name: 'Confirm my order' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Your order' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Track your order' })).toHaveAttribute('href', '/track-order')
  })

  it('Cancel asks again in a dialog with an optional reason; "Keep my order" changes nothing', async () => {
    const fetchMock = mockFetch(routes({ body: SUMMARY() }, { [`POST ${LINK}`]: { body: SUMMARY({ status: 'cancelled' }) } }))
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Cancel this order' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel order BN-100042?' })
    expect(within(dialog).getByRole('textbox', { name: 'Why are you cancelling? (optional)' })).toHaveAccessibleDescription("Up to 500 characters. It's kept with the order.")
    await user.click(within(dialog).getByRole('button', { name: 'Keep my order' }))
    expect(posts(fetchMock)).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Confirm my order' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel this order' }))
    await user.type(screen.getByRole('textbox', { name: 'Why are you cancelling? (optional)' }), 'Ordered twice')
    await user.click(screen.getByRole('button', { name: 'Yes, cancel this order' }))
    const status = (await screen.findByText('Your order BN-100042 is cancelled.')).closest('[role="status"]')
    await waitFor(() => expect(status).toHaveFocus())
    expect(JSON.parse(posts(fetchMock)[0][1].body)).toEqual({ action: 'cancel', reason: 'Ordered twice' })
  })

  it('a refused cancel (already shipped) shows the API text in the dialog', async () => {
    mockFetch(routes({ body: SUMMARY() }, { [`POST ${LINK}`]: { status: 422, body: { message: 'This order has shipped and can no longer be cancelled.' } } }))
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Cancel this order' }))
    await user.click(screen.getByRole('button', { name: 'Yes, cancel this order' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('This order has shipped and can no longer be cancelled.')
  })

  it.each([
    ['confirmed', "Your order BN-100042 is already confirmed. We'll text you when it ships."],
    ['cancelled', 'Your order BN-100042 was already cancelled.'],
    ['expired', 'This confirmation link has expired. You can still see order BN-100042 with Track your order.'],
    ['not_waiting', "Order BN-100042 doesn't need confirming any more. You can see where it is with Track your order."],
  ])('a link already answered or no longer waiting (%s) says so, with no buttons', async (status, text) => {
    mockFetch(routes({ body: SUMMARY({ status }) }))
    open()
    expect((await screen.findByText(text)).closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm my order' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel this order' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Track your order' })).toHaveAttribute('href', '/track-order')
  })

  it('an expired or unknown link (404) explains it plainly and links to Track your order', async () => {
    mockFetch(routes({ status: 404, body: { message: 'No query results for model [Order].' } }))
    open()
    expect(await screen.findByRole('heading', { level: 1, name: "This link can't be used" })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("This link isn't valid or has expired. You can still find your order with Track your order.")
    expect(screen.queryByText(/No query results/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Track your order' })).toBeInTheDocument()
  })

  it('a link used up meanwhile (404 on Confirm) switches to the same explanation', async () => {
    mockFetch(routes({ body: SUMMARY() }, { [`POST ${LINK}`]: { status: 404, body: { message: 'Gone.' } } }))
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Confirm my order' }))
    const status = (await screen.findByText(/This link isn't valid or has expired/)).closest('[role="status"]')
    expect(status).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm my order' })).toBeNull()
  })

  it('too many tries (429) shows the API text and keeps the buttons', async () => {
    mockFetch(routes({ body: SUMMARY() }, { [`POST ${LINK}`]: { status: 429, body: { message: 'Too many attempts. Try again in a minute.' } } }))
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Confirm my order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in a minute.')
    expect(screen.getByRole('button', { name: 'Confirm my order' })).toBeEnabled()
  })

  it('a failed load offers to try again', async () => {
    let calls = 0
    mockFetch(routes(() => (++calls === 1 ? { status: 500, body: { message: 'Server error.' } } : { body: SUMMARY() })))
    const user = userEvent.setup()
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Confirm my order' })).toBeInTheDocument()
  })

  it('in Bangla, with Bangla digits and nothing left in English', async () => {
    await switchToBangla()
    mockFetch(routes({ body: SUMMARY() }, { [`POST ${LINK}`]: { body: SUMMARY({ status: 'confirmed' }) } }))
    const user = userEvent.setup()
    open()
    await screen.findByRole('button', { name: 'আমার অর্ডার নিশ্চিত করুন' })
    expect(screen.getByRole('heading', { level: 1, name: 'আপনার অর্ডার নিশ্চিত করুন' })).toBeInTheDocument()
    expect(screen.getByText('৩টি পণ্য')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('৳১,২৫০.০০')).toBeInTheDocument())
    expect(screen.getByRole('group', { name: 'ভাষা' })).toBeInTheDocument()
    expectNoEnglish(document.body, { allow: ['BN'] })
    await user.click(screen.getByRole('button', { name: 'আমার অর্ডার নিশ্চিত করুন' }))
    expect(await screen.findByText('ধন্যবাদ, আপনার অর্ডার BN-100042 নিশ্চিত হয়েছে। পাঠানোর সময় আমরা আপনাকে এসএমএস করব।')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'আপনার অর্ডার ট্র্যাক করুন' })).toBeInTheDocument()
    expectNoEnglish(document.body, { allow: ['BN'] })
  })

  it('the language switch on the page turns it into Bangla', async () => {
    mockFetch(routes({ body: SUMMARY() }))
    const user = userEvent.setup()
    open()
    await screen.findByRole('button', { name: 'Confirm my order' })
    await user.click(screen.getByRole('button', { name: 'বাংলা' }))
    expect(await screen.findByRole('button', { name: 'আমার অর্ডার নিশ্চিত করুন' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'এই অর্ডারটি বাতিল করুন' })).toBeInTheDocument()
  })
})

describe('GET /store sms_updates', () => {
  it('is on only when the API says true; off in the demo defaults', () => {
    expect(normalizeStoreSettings({ data: { sms_updates: true } }).smsUpdates).toBe(true)
    expect(normalizeStoreSettings({ data: { sms_updates: false } }).smsUpdates).toBe(false)
    expect(normalizeStoreSettings({ data: { sms_updates: 'yes' } }).smsUpdates).toBe(false)
    expect(normalizeStoreSettings({ data: {} }).smsUpdates).toBe(false)
    expect(DEFAULT_STORE_SETTINGS.smsUpdates).toBe(false)
  })
})

describe('checkout: the SMS line under the phone field', () => {
  const ITEM = { productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 'm.webp', price: 1100, discountPercentage: 0, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 1 }
  const CHECKOUT_STORE = (extra) =>
    STORE({
      support_email: 'help@buynest.test', allowed_countries: ['Bangladesh'], guest_checkout: true, tax_enabled: false, free_shipping_threshold: null,
      shipping_methods: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: '120.00' }], card_payments: 'manual', paypal_payments: 'unavailable', sslcommerz_payments: 'manual',
      ...extra,
    })
  const priced = { body: { lines: [{ productId: 1, title: 'Mascara', thumbnail: 'm.webp', price: 1100, discountPercentage: 0, salePrice: 1100, quantity: 1, lineTotal: 1100, stock: 99, minimumOrderQuantity: 1, available: true }], problems: [], coupon: null, couponError: null, appliedRules: [], requiresShipping: true, shippingError: null, shippingOptions: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 120 }], totals: { itemCount: 1, subtotal: 1100, discount: 0, shipping: 120, tax: 0, total: 1220, amountDue: 1220 } } }
  const seed = () => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items: [ITEM], couponCode: null }))

  it('says texts go to this number while the store sends them', async () => {
    seed()
    mockFetch({ 'GET /api/catalog/store': CHECKOUT_STORE({ sms_updates: true }), 'POST /api/shop/cart/validate': priced })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    const phone = await screen.findByLabelText('Phone')
    const line = await screen.findByText("We'll text order updates to this number.")
    expect(phone.closest('section')).toContainElement(line)
  })

  it('in Bangla', async () => {
    await switchToBangla()
    seed()
    mockFetch({ 'GET /api/catalog/store': CHECKOUT_STORE({ sms_updates: true }), 'POST /api/shop/cart/validate': priced })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByText('অর্ডারের আপডেট আমরা এই নম্বরে এসএমএস করে জানাব।')).toBeInTheDocument()
  })

  it.each([[false], [undefined]])('says nothing when sms_updates is %s', async (value) => {
    seed()
    mockFetch({ 'GET /api/catalog/store': CHECKOUT_STORE({ sms_updates: value }), 'POST /api/shop/cart/validate': priced })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    // The store's own countries (only Bangladesh) show the settings have arrived.
    await waitFor(() => expect(screen.getByLabelText('Country').options).toHaveLength(1))
    expect(screen.queryByText(/text order updates/)).toBeNull()
  })
})
