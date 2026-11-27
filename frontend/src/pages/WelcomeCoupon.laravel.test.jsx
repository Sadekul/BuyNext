import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Newsletter from '../components/forms/Newsletter'
import HomeNewsletter from '../components/home/HomeNewsletter'
import NewsletterPage from './NewsletterPage'
import RegisterPage from './RegisterPage'
import LoginPage from './LoginPage'
import ProfilePage from './ProfilePage'
import WelcomeCodeCard from '../components/account/WelcomeCodeCard'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { expectNoEnglish, switchToBangla } from '../test/i18n'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { normalizeStoreSettings } from '../services/adapters/contentAdapter'
import { normalizeUser } from '../services/adapters/dummyJsonAdapter'
import { formatMinimum, normalizeWelcomeCoupon, normalizeWelcomeOffer } from '../utils/welcomeOffer'
import { resetDisplayCurrencyForTests, setStoreCurrency } from '../utils/displayCurrency'

/*
 * Phase 19 (docs/backend/PHASE19_CONTRACT.md §3): the welcome coupon on the
 * storefront. The store promises it only while GET /store `welcome_offer`
 * says it's on, and only where it's earned (`triggers`); with null every text
 * is exactly as before.
 */
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

afterEach(() => resetDisplayCurrencyForTests())

const TAKA = { code: 'BDT', symbol: '৳', decimals: 2 }
const OFFER = { type: 'percent', value: '10', label: '10% off', min_subtotal: null, valid_days: 30, first_order_only: true, triggers: ['signup', 'newsletter'] }
const store = (welcomeOffer, extra = {}) => ({ body: { data: { store_name: 'BuyNest', payment_methods: ['cod'], welcome_offer: welcomeOffer, ...extra } } })

const OLD_TITLE = 'Be first to hear about deals'
const OLD_TEXT = 'Join the BuyNest newsletter for new arrivals, exclusive deals, and style tips.'

describe('welcome offer from GET /store', () => {
  it('is null when off, and keeps only the documented fields when on', () => {
    expect(normalizeStoreSettings({ data: {} }).welcomeOffer).toBeNull()
    expect(normalizeStoreSettings({ data: { welcome_offer: null } }).welcomeOffer).toBeNull()
    expect(normalizeStoreSettings({ data: { welcome_offer: { ...OFFER, extra: 1 } } }).welcomeOffer).toEqual({
      type: 'percent', value: 10, label: '10% off', minSubtotal: null, validDays: 30, firstOrderOnly: true, triggers: ['signup', 'newsletter'],
    })
  })

  it('promises nothing it cannot describe or where it cannot be earned', () => {
    expect(normalizeWelcomeOffer({ ...OFFER, triggers: [] })).toBeNull()
    expect(normalizeWelcomeOffer({ ...OFFER, triggers: ['bogus'] })).toBeNull()
    expect(normalizeWelcomeOffer({ ...OFFER, type: 'bogus', value: 'x', label: null })).toBeNull()
    expect(normalizeWelcomeOffer({ ...OFFER, value: 0, label: '' })).toBeNull()
    expect(normalizeWelcomeOffer({ ...OFFER, triggers: ['newsletter', 'x'] }).triggers).toEqual(['newsletter'])
  })

  it('writes the minimum in the store currency, without empty decimals', () => {
    setStoreCurrency(TAKA)
    expect(formatMinimum('500.00')).toBe('৳500')
    expect(formatMinimum('৳500')).toBe('৳500')
    expect(formatMinimum('৳১,০০০')).toBe('৳1,000')
    expect(formatMinimum('৳12.50')).toBe('৳12.50')
    expect(formatMinimum('500 or more')).toBe('500 or more')
    expect(formatMinimum(null)).toBeNull()
  })
})

describe('newsletter block', () => {
  it('keeps today\'s texts while the offer is off', async () => {
    const fetchMock = mockFetch({ 'GET /api/catalog/store': store(null) })
    renderWithProviders(<HomeNewsletter />)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByRole('heading', { name: OLD_TITLE })).toBeInTheDocument()
    expect(screen.getByText(OLD_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(/off your first order|personal code/)).not.toBeInTheDocument()
  })

  it('keeps today\'s texts when the offer is for new accounts only', async () => {
    mockFetch({ 'GET /api/catalog/store': store({ ...OFFER, triggers: ['signup'] }) })
    renderWithProviders(<Newsletter />)
    expect(await screen.findByRole('heading', { name: OLD_TITLE })).toBeInTheDocument()
    expect(screen.getByText(OLD_TEXT)).toBeInTheDocument()
  })

  it('promises the offer while it is on for the newsletter', async () => {
    mockFetch({ 'GET /api/catalog/store': store(OFFER) })
    renderWithProviders(<HomeNewsletter />)
    expect(await screen.findByRole('heading', { name: 'Get 10% off your first order' })).toBeInTheDocument()
    expect(screen.getByText("Confirm your email and we'll send your personal code.")).toBeInTheDocument()
    // The form keeps its names (e2e: marketing.mjs).
    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
  })

  it('a fixed amount in the store currency, any order, with a minimum', async () => {
    mockFetch({ 'GET /api/catalog/store': store({ ...OFFER, type: 'fixed', value: '100.00', label: '৳100 off', min_subtotal: '500.00', first_order_only: false }, { currency: TAKA }) })
    renderWithProviders(<Newsletter />)
    expect(await screen.findByRole('heading', { name: 'Get ৳100 off' })).toBeInTheDocument()
    expect(screen.getByText("Confirm your email and we'll send your personal code. Orders over ৳500.")).toBeInTheDocument()
  })

  it('in Bangla, with Bangla digits', async () => {
    await switchToBangla()
    mockFetch({ 'GET /api/catalog/store': store({ ...OFFER, min_subtotal: '1000.00' }, { currency: TAKA }) })
    renderWithProviders(<Newsletter />)
    expect(await screen.findByRole('heading', { name: 'আপনার প্রথম অর্ডারে ১০% ছাড় পান' })).toBeInTheDocument()
    expect(screen.getByText(/আপনার ব্যক্তিগত কোড পাঠিয়ে দেব। ৳১,০০০-এর বেশি অর্ডারে।/)).toBeInTheDocument()
    expectNoEnglish(document.body)
  })
})

describe('newsletter confirmation page', () => {
  const confirm = (extra) => mockFetch({ 'POST /api/shop/newsletter/confirm': { body: { message: "You're subscribed to the BuyNest newsletter.", email: 'ava@example.com', status: 'subscribed', ...extra } } })
  const open = () => renderWithProviders(<NewsletterPage action="confirm" />, { route: '/newsletter/confirm?token=abc.123', path: '/newsletter/confirm' })

  it('says the code is on its way when this confirmation issued one', async () => {
    confirm({ welcomeCouponSent: true })
    open()
    expect(await screen.findByText("You're subscribed to the BuyNest newsletter.")).toBeInTheDocument()
    const sent = screen.getByText('Your welcome code is on its way to your inbox.')
    expect(sent.closest('[role="status"]')).not.toBeNull()
  })

  it.each([[{ welcomeCouponSent: false }], [{}]])('says nothing about a code otherwise (%o)', async (extra) => {
    confirm(extra)
    open()
    expect(await screen.findByText("You're subscribed to the BuyNest newsletter.")).toBeInTheDocument()
    expect(screen.queryByText(/welcome code/)).not.toBeInTheDocument()
  })

  it('in Bangla', async () => {
    await switchToBangla()
    mockFetch({ 'POST /api/shop/newsletter/confirm': { body: { message: 'আপনি সাবস্ক্রাইব করেছেন।', email: 'ava@example.com', status: 'subscribed', welcomeCouponSent: true } } })
    open()
    expect(await screen.findByText('আপনার স্বাগতম কোড ইনবক্সে পাঠানো হচ্ছে।')).toBeInTheDocument()
    expectNoEnglish(document.body)
  })
})

describe('sign-up page', () => {
  it('has no note while the offer is off', async () => {
    const fetchMock = mockFetch({ 'GET /api/catalog/store': store(null) })
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.queryByText(/Create an account and get/)).not.toBeInTheDocument()
  })

  it('has no note when the offer is for the newsletter only', async () => {
    const fetchMock = mockFetch({ 'GET /api/catalog/store': store({ ...OFFER, triggers: ['newsletter'] }) })
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await screen.findByRole('heading', { name: 'Create your account' })
    expect(screen.queryByText(/Create an account and get/)).not.toBeInTheDocument()
  })

  it('promises the offer for new accounts', async () => {
    mockFetch({ 'GET /api/catalog/store': store({ ...OFFER, min_subtotal: '25.00' }) })
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' })
    expect(await screen.findByText('Create an account and get 10% off your first order.')).toBeInTheDocument()
    expect(screen.getByText(/Orders over \$25\./)).toBeInTheDocument()
    expect(screen.getByText("We'll email your personal code once you confirm your email.")).toBeInTheDocument()
  })

  it('in Bangla', async () => {
    await switchToBangla()
    mockFetch({ 'GET /api/catalog/store': store({ ...OFFER, type: 'fixed', value: '150', first_order_only: false }, { currency: TAKA }) })
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' })
    expect(await screen.findByText('অ্যাকাউন্ট খুলুন আর ৳১৫০ ছাড় পান।')).toBeInTheDocument()
  })

  it('is never on the sign-in page', async () => {
    mockFetch({ 'GET /api/catalog/store': store(OFFER), 'GET /api/auth/me': { status: 401, body: {} } })
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(/off your first order/)).not.toBeInTheDocument()
  })
})

describe('account overview: your welcome code', () => {
  const COUPON = { code: 'WELCOME-AB23CD', label: '10% off', minSubtotal: '500.00', expiresAt: '2026-12-26T23:59:59+06:00', status: 'active' }

  it('keeps only a usable code from the profile', () => {
    expect(normalizeUser({ id: 1, welcomeCoupon: COUPON }).welcomeCoupon).toEqual(COUPON)
    expect(normalizeUser({ id: 1, welcomeCoupon: { ...COUPON, status: 'weird' } }).welcomeCoupon.status).toBe('active')
    expect(normalizeUser({ id: 1 })).not.toHaveProperty('welcomeCoupon')
    expect(normalizeUser({ id: 1, welcomeCoupon: null })).not.toHaveProperty('welcomeCoupon')
    expect(normalizeWelcomeCoupon({ code: '' })).toBeNull()
  })

  it('shows an active code with Copy (the result in a status message), the offer, minimum and date', async () => {
    setStoreCurrency(TAKA)
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderWithProviders(<WelcomeCodeCard coupon={COUPON} />)
    const card = screen.getByRole('region', { name: 'Your welcome code' })
    expect(within(card).getByText('WELCOME-AB23CD').tagName).toBe('CODE')
    expect(card).toHaveTextContent('Status: Active')
    expect(card).toHaveTextContent('10% off')
    expect(card).not.toHaveTextContent('first order')
    expect(card).toHaveTextContent('Orders over ৳500.')
    expect(card).toHaveTextContent(/Use by Dec 2[67], 2026/)
    await user.click(screen.getByRole('button', { name: 'Copy welcome code WELCOME-AB23CD' }))
    expect(writeText).toHaveBeenCalledWith('WELCOME-AB23CD')
    expect(screen.getByRole('status')).toHaveTextContent('Code WELCOME-AB23CD copied.')
  })

  it('selects the code to copy by hand without clipboard access', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) }, configurable: true })
    renderWithProviders(<WelcomeCodeCard coupon={COUPON} />)
    await user.click(screen.getByRole('button', { name: /Copy welcome code/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/copy it by hand/)
    expect(window.getSelection().toString()).toBe('WELCOME-AB23CD')
  })

  it.each([
    ['used', 'Status: Used', null],
    ['expired', 'Status: Expired', /Expired on Dec 2[67], 2026/],
  ])('%s: the status in words, no Copy button, no "Use by"', (status, words, dateLine) => {
    renderWithProviders(<WelcomeCodeCard coupon={{ ...COUPON, status }} />)
    const card = screen.getByRole('region', { name: 'Your welcome code' })
    expect(card).toHaveTextContent(words)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(card).not.toHaveTextContent('Use by')
    if (dateLine) expect(card).toHaveTextContent(dateLine)
  })

  it('says when the code is for a first order only', () => {
    renderWithProviders(<WelcomeCodeCard coupon={{ ...COUPON, firstOrderOnly: true }} />)
    expect(screen.getByText('10% off your first order')).toBeInTheDocument()
  })

  it('renders nothing without a code', () => {
    const { container } = renderWithProviders(<WelcomeCodeCard coupon={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('in Bangla, with a Bangla date and status', async () => {
    await switchToBangla()
    setStoreCurrency(TAKA)
    renderWithProviders(<WelcomeCodeCard coupon={{ ...COUPON, label: '১০% ছাড়' }} />)
    const card = screen.getByRole('region', { name: 'আপনার স্বাগতম কোড' })
    expect(card).toHaveTextContent('অবস্থা: চালু')
    expect(card).toHaveTextContent('৳৫০০-এর বেশি অর্ডারে।')
    expect(card).toHaveTextContent(/২০২৬-এর মধ্যে ব্যবহার করুন/)
    expect(screen.getByRole('button', { name: 'স্বাগতম কোড WELCOME-AB23CD কপি করুন' })).toBeInTheDocument()
    expectNoEnglish(document.body, { allow: ['WELCOME'] })
  })

  describe('on the profile page', () => {
    const NADIA = { id: 5, firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@example.com', phone: null, emailVerified: true, role: 'customer', newsletter: false }
    const signIn = () => {
      document.cookie = 'buynest_session=session; Path=/'
      window.localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
    }
    const EMPTY_SAVED_CART = { body: { items: [], itemCount: 0, updatedAt: null } }

    it('shows the card when the account has a code', async () => {
      signIn()
      mockFetch({ 'GET /api/auth/me': { body: { ...NADIA, welcomeCoupon: COUPON } }, 'GET /api/shop/me/cart': EMPTY_SAVED_CART })
      renderWithProviders(<ProfilePage />, { route: '/account', path: '/account' })
      expect(await screen.findByRole('region', { name: 'Your welcome code' }, { timeout: 5000 })).toHaveTextContent('WELCOME-AB23CD')
    })

    it('hides it without one', async () => {
      signIn()
      mockFetch({ 'GET /api/auth/me': { body: NADIA }, 'GET /api/shop/me/cart': EMPTY_SAVED_CART })
      renderWithProviders(<ProfilePage />, { route: '/account', path: '/account' })
      expect(await screen.findByText('nadia@example.com', {}, { timeout: 5000 })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Your welcome code' })).not.toBeInTheDocument()
    })

    it('shows the code switching the newsletter on just issued', async () => {
      signIn()
      mockFetch({
        'GET /api/auth/me': { body: NADIA },
        'PUT /api/auth/profile': { body: { ...NADIA, newsletter: true, welcomeCoupon: COUPON } },
        'GET /api/shop/me/cart': EMPTY_SAVED_CART,
      })
      const user = userEvent.setup()
      renderWithProviders(<ProfilePage />, { route: '/account', path: '/account' })
      await user.click(await screen.findByRole('checkbox', { name: /Email me new arrivals/ }, { timeout: 5000 }))
      expect(await screen.findByRole('region', { name: 'Your welcome code' })).toHaveTextContent('WELCOME-AB23CD')
    })
  })
})
