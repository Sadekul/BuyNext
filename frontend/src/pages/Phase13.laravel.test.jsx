import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckoutPage from './CheckoutPage'
import CartPage from './CartPage'
import ProductDetailsPage from './ProductDetailsPage'
import ProductListingPage from './ProductListingPage'
import OrderConfirmationPage from './OrderConfirmationPage'
import OrderDetailsPage from './OrderDetailsPage'
import ProfilePage from './ProfilePage'
import AddressBookPage from './AddressBookPage'
import LoginPage from './LoginPage'
import Header from '../components/layout/Header'
import Footer from '../components/layout/Footer'
import LanguageSwitch from '../components/layout/LanguageSwitch'
import LanguageSync from '../components/layout/LanguageSync'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { expectNoEnglish, switchToBangla } from '../test/i18n'
import { currentLanguage } from '../i18n'
import { resetDisplayCurrencyForTests, setStoreCurrency } from '../utils/displayCurrency'

// Phase 13 storefront in Bangla with BuyNest's API (docs/backend/PHASE13_CONTRACT.md §1–§2): every key page
// renders without English app text, money is ৳১,২৫০.০০, the API's content and messages are shown as sent,
// and the language switch saves the cookie and the account's language.
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const SLOW = { timeout: 20_000 }
const TAKA = { code: 'BDT', symbol: '৳', decimals: 2 }
const STORE = {
  data: {
    store_name: 'BuyNest', support_email: 'help@buynest.test', free_shipping_threshold: '5000.00', allowed_countries: ['Bangladesh'], guest_checkout: true, tax_enabled: false,
    shipping_methods: [{ id: 'standard', label: 'স্ট্যান্ডার্ড', eta: '৩–৫ কর্মদিবস', price: '120.00' }],
    payment_methods: ['sslcommerz', 'cod'], card_payments: 'manual', paypal_payments: 'unavailable', sslcommerz_payments: 'sslcommerz',
    currency: TAKA, currencies: { base: 'BDT', display: [] }, ga4_measurement_id: null, locales: ['en', 'bn'], default_locale: 'en', bangla_digits: true,
  },
}
const ADDRESS = { firstName: 'রহিম', lastName: 'উদ্দিন', line1: 'বাড়ি ১২, রোড ৫', line2: '', city: 'ঢাকা', state: 'ঢাকা', postalCode: '1207', country: 'Bangladesh' }
// Product content as the API sends it in Bangla.
const ITEM = { productId: 1, title: 'মাসকারা', brand: 'এসেন্স', category: 'beauty', thumbnail: 'm.webp', price: 1250, discountPercentage: 0, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 2 }
const seedCart = (items) => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items, couponCode: null }))
const LINE = { productId: 1, title: 'মাসকারা', thumbnail: 'm.webp', price: 1250, discountPercentage: 0, salePrice: 1250, quantity: 2, lineTotal: 2500, stock: 99, minimumOrderQuantity: 1, available: true }
const TOTALS = { itemCount: 2, subtotal: 2500, discount: 0, shipping: 120, tax: 0, total: 2620, giftCard: 0, amountDue: 2620 }
const CART = { lines: [LINE], problems: [], coupon: null, couponError: null, appliedRules: [], shippingOptions: [{ id: 'standard', label: 'স্ট্যান্ডার্ড', eta: '৩–৫ কর্মদিবস', price: 120 }], requiresShipping: true, shippingError: null, giftCard: null, giftCardError: null, totals: TOTALS }
const ORDER = {
  number: 'BN-100001', status: 'processing', paymentStatus: 'unpaid', paymentMethod: 'cod', paymentProvider: null, canPay: false, payment: null,
  shippingMethod: { id: 'standard', label: 'স্ট্যান্ডার্ড', eta: '৩–৫ কর্মদিবস' }, email: 'rahim@example.com', phone: '+880 1711 000000', shippingAddress: ADDRESS, billingAddress: ADDRESS,
  couponCode: null, items: [LINE], totals: TOTALS, currency: 'BDT', placedAt: '2026-11-19T10:00:00Z', history: [], shipments: [], invoices: [], creditMemos: [], locale: 'bn',
}
const CATEGORIES = { data: [{ slug: 'beauty', name: 'সৌন্দর্য', children: [] }] }
const PRODUCT = {
  id: 1, name: 'মাসকারা', locale: 'bn', short_description: 'দীর্ঘস্থায়ী কালো মাসকারা।', description: 'চোখের পাপড়ি ঘন করে।', price: '1250.00', discount_percent: 0, stock_quantity: 7,
  availability: 'in_stock', has_variants: false, category: { slug: 'beauty', name: 'সৌন্দর্য' }, images: [], thumbnail_url: '/media/products/1/0123456789abcdef0123456789abcdef.webp', reviews: [],
}
const PRODUCTS = { data: [PRODUCT], meta: { current_page: 1, per_page: 100, total: 1 } }
const CATALOG = {
  'GET /api/catalog/store': { body: STORE },
  'GET /api/catalog/categories': { body: CATEGORIES },
  'GET /api/catalog/products': { body: PRODUCTS },
  'GET /api/catalog/products/1': { body: { data: PRODUCT } },
}
const NAV = [
  { label: 'Home', labelKey: 'nav.home', to: '/' },
  { label: 'সৌন্দর্য', to: '/categories/beauty' },
]
const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'নাদিয়া' }, remember: false }))
}
const ME = (extra = {}) => ({ 'GET /api/auth/me': { body: { id: 5, firstName: 'নাদিয়া', lastName: 'রহমান', email: 'nadia@example.com', role: 'customer', ...extra } } })
const ACCOUNT = { 'GET /api/shop/me/wishlist': { body: { items: [], shared: false } }, 'GET /api/shop/me/cart': { body: { items: [], itemCount: 0, updatedAt: null } } }
// Product data, emails, codes and numbers that stay as they are.
const ALLOW = ['BDT', 'rahim', 'nadia', 'NEST']

afterEach(() => resetDisplayCurrencyForTests())

async function bangla() {
  setStoreCurrency(TAKA)
  await switchToBangla()
}

describe('the store in Bangla', () => {
  it('header and footer: navigation, switch and links in Bangla', async () => {
    await bangla()
    mockFetch(CATALOG)
    renderWithProviders(
      <>
        <Header navLinks={NAV} mobileNavLinks={NAV} />
        <Footer />
      </>,
    )
    expect(await screen.findAllByRole('button', { name: 'বাংলা' })).not.toHaveLength(0)
    expect(screen.getAllByRole('group', { name: 'ভাষা' }).length).toBeGreaterThan(0)
    expect(document.documentElement.lang).toBe('bn')
    await waitFor(() => expectNoEnglish(document.body, { allow: ALLOW }))
  })

  it('listing and product page: app text in Bangla, the API’s Bangla content and prices ৳১,২৫০.০০', SLOW, async () => {
    await bangla()
    mockFetch(CATALOG)
    const view = renderWithProviders(<ProductListingPage />, { route: '/products', path: '/products' })
    expect(await screen.findByRole('heading', { name: 'সব পণ্য', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('৳১,২৫০.০০')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('১টির মধ্যে ১–১ দেখানো হচ্ছে')
    expectNoEnglish(document.body, { allow: ALLOW })
    view.unmount()

    renderWithProviders(<ProductDetailsPage />, { route: '/products/1', path: '/products/:productId' })
    expect(await screen.findByRole('heading', { name: 'মাসকারা', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('দীর্ঘস্থায়ী কালো মাসকারা।')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /কার্টে যোগ করুন/ })).toBeInTheDocument()
    expectNoEnglish(document.body, { allow: ALLOW })
  })

  it('cart page in Bangla', async () => {
    await bangla()
    seedCart([ITEM])
    mockFetch({ ...CATALOG, 'POST /api/shop/cart/validate': { body: CART } })
    renderWithProviders(<CartPage />, { route: '/cart', path: '/cart' })
    expect(await screen.findByRole('heading', { name: 'শপিং কার্ট' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('সাবটোটাল (২টি পণ্য)').nextSibling).toHaveTextContent('৳২,৫০০.০০'))
    await waitFor(() => expectNoEnglish(document.body, { allow: ALLOW }))
  })

  it('checkout: labels, payment notes and validation errors in Bangla', SLOW, async () => {
    await bangla()
    seedCart([ITEM])
    mockFetch({ ...CATALOG, 'POST /api/shop/cart/validate': { body: CART } })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })

    const place = await screen.findByRole('button', { name: 'অর্ডার করুন · ৳২,৬২০.০০' })
    expect(screen.getByRole('radio', { name: /ক্যাশ অন ডেলিভারি/ })).toBeInTheDocument()
    await user.click(place)
    expect(await screen.findAllByText('সঠিক ইমেইল ঠিকানা লিখুন।')).not.toHaveLength(0)
    expect(screen.getAllByText('নামের প্রথম অংশ লিখুন।').length).toBeGreaterThan(0)
    expectNoEnglish(document.body, { allow: ALLOW })
  })

  it('shows the API’s Bangla field errors as sent', SLOW, async () => {
    await bangla()
    seedCart([ITEM])
    mockFetch({
      ...CATALOG,
      'POST /api/shop/cart/validate': { body: CART },
      'POST /api/shop/orders': { status: 422, body: { message: 'চিহ্নিত ঘরগুলো একবার দেখে নিন।', errors: { 'shippingAddress.postalCode': ['পোস্টাল কোডটি সঠিক নয়।'] } } },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await user.type(await screen.findByLabelText('ইমেইল'), 'rahim@example.com')
    await user.type(screen.getByLabelText('ফোন নম্বর'), '+880 1711 000000')
    const fields = { 'নামের প্রথম অংশ': 'Rahim', 'নামের শেষ অংশ': 'Uddin', 'রাস্তার ঠিকানা': 'House 12', শহর: 'Dhaka', 'জেলা / বিভাগ': 'Dhaka', 'পোস্টাল কোড': '1207' }
    for (const [label, value] of Object.entries(fields)) await user.type(screen.getByLabelText(label), value)
    await new Promise((resolve) => setTimeout(resolve, 700))
    await user.click(screen.getByRole('radio', { name: /ক্যাশ অন ডেলিভারি/ }))
    await user.click(await screen.findByRole('button', { name: /অর্ডার করুন/ }))
    expect(await screen.findByText('পোস্টাল কোডটি সঠিক নয়।')).toBeInTheDocument()
  })

  it('order confirmation and order details in Bangla', async () => {
    await bangla()
    signIn()
    mockFetch({ ...ME(), ...CATALOG, ...ACCOUNT, 'GET /api/shop/orders/BN-100001': { body: ORDER } })
    const view = renderWithProviders(<OrderConfirmationPage />, { route: '/order-confirmation/BN-100001', path: '/order-confirmation/:orderId' })
    expect(await screen.findByRole('heading', { name: 'ধন্যবাদ, নাদিয়া!' })).toBeInTheDocument()
    expect(screen.getByText('মোট').nextSibling).toHaveTextContent('৳২,৬২০.০০')
    expectNoEnglish(document.body, { allow: ALLOW })
    view.unmount()

    renderWithProviders(<OrderDetailsPage />, { route: '/account/orders/BN-100001', path: '/account/orders/:orderId' })
    expect(await screen.findByRole('heading', { name: 'অর্ডার BN-100001' })).toBeInTheDocument()
    expect(screen.getByText('২ × ৳১,২৫০.০০')).toBeInTheDocument()
    expectNoEnglish(document.body, { allow: ALLOW })
  })

  it('account pages and sign-in in Bangla', async () => {
    await bangla()
    signIn()
    mockFetch({
      ...ME({ phone: '+880 1711 000000', newsletter: true, locale: 'bn' }),
      ...CATALOG,
      ...ACCOUNT,
      'GET /api/shop/me/addresses': { body: { addresses: [{ id: 1, ...ADDRESS, phone: '+880 1711 000000', company: '', isDefaultShipping: true, isDefaultBilling: true }] } },
    })
    const view = renderWithProviders(<ProfilePage />, { route: '/account', path: '/account' })
    expect(await screen.findByText('নিউজলেটার')).toBeInTheDocument()
    expectNoEnglish(document.body, { allow: ALLOW })
    view.unmount()

    const book = renderWithProviders(<AddressBookPage />, { route: '/account/addresses', path: '/account/addresses' })
    expect(await screen.findByText('ডিফল্ট ডেলিভারি')).toBeInTheDocument()
    expect(screen.getByText('বাংলাদেশ')).toBeInTheDocument()
    expectNoEnglish(document.body, { allow: ALLOW })
    book.unmount()

    window.localStorage.clear()
    document.cookie = 'buynest_session=; Max-Age=0; Path=/'
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' })
    expect(screen.getByRole('heading', { name: 'আবার স্বাগতম' })).toBeInTheDocument()
    expectNoEnglish(document.body, { allow: ALLOW })
  })
})

describe('choosing the language (§1)', () => {
  it('the switch saves the cookie and the signed-in account’s language (PATCH /me locale)', async () => {
    signIn()
    const fetchMock = mockFetch({
      ...ME({ locale: null }),
      ...CATALOG,
      ...ACCOUNT,
      'PUT /api/auth/profile': (url, init) => ({ body: { id: 5, firstName: 'নাদিয়া', locale: JSON.parse(init.body).locale } }),
    })
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <LanguageSync />
        <LanguageSwitch />
      </>,
    )
    await user.click(await screen.findByRole('button', { name: 'বাংলা' }))
    await waitFor(() => expect(currentLanguage()).toBe('bn'))
    expect(document.cookie).toContain('buynest_lang=bn')
    expect(screen.getByRole('button', { name: 'বাংলা' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('lang', 'en')
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init = {}]) => new URL(url).pathname === '/api/auth/profile' && init.method === 'PUT')
      expect(call && JSON.parse(call[1].body)).toEqual({ locale: 'bn' })
    })
  })

  it('after sign-in the account’s language wins', async () => {
    signIn()
    mockFetch({ ...ME({ locale: 'bn' }), ...CATALOG, ...ACCOUNT })
    renderWithProviders(<LanguageSync />)
    await waitFor(() => expect(currentLanguage()).toBe('bn'))
  })

  it('a first visit uses the store’s default language, not the browser’s', async () => {
    mockFetch({ ...CATALOG, 'GET /api/catalog/store': { body: { data: { ...STORE.data, default_locale: 'bn' } } } })
    renderWithProviders(<LanguageSync />)
    await waitFor(() => expect(currentLanguage()).toBe('bn'))
    expect(document.cookie).not.toContain('buynest_lang=')
  })

  it('Bangla catalog requests name the language in the URL (cached separately)', async () => {
    await bangla()
    const fetchMock = mockFetch(CATALOG)
    renderWithProviders(<ProductDetailsPage />, { route: '/products/1', path: '/products/:productId' })
    await screen.findByRole('heading', { name: 'মাসকারা', level: 1 })
    const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/api/catalog/products/1')
    expect(new URL(call[0]).searchParams.get('lang')).toBe('bn')
  })
})
