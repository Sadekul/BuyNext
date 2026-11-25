import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, useLocation } from 'react-router'
import Header from './Header'
import TopBar from './TopBar'
import MegaMenu from './MegaMenu'
import { DeliverToButton, DeliverToDialog } from './DeliverTo'
import MainLayout from '../../layouts/MainLayout'
import CheckoutPage from '../../pages/CheckoutPage'
import { renderWithProviders } from '../../test/renderWithProviders'
import { mockFetch } from '../../test/mockFetch'
import { expectNoEnglish, switchToBangla } from '../../test/i18n'
import { STORAGE_KEYS } from '../../constants/storageKeys'
import { resetDeliverToForTests, saveDeliverTo } from '../../utils/deliverTo'
import { resetDisplayCurrencyForTests, setStoreCurrency } from '../../utils/displayCurrency'
import { useState } from 'react'

// Phase 17 storefront shell with BuyNest's API (docs/backend/PHASE17_CONTRACT.md §3): the top bar (promo,
// coupon copy, delivery line), "Deliver to" (dialog, estimate, remembered, checkout pre-fill), the
// "All categories" mega menu, the search's "Search in" select, and the layout in the checkout.
vi.mock('../../services/providers/index', async () => ({ apiProvider: (await import('../../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const SLOW = { timeout: 30_000 }
const TAKA = { code: 'BDT', symbol: '৳', decimals: 2 }
const STORE = (overrides = {}) => ({
  data: {
    store_name: 'BuyNest', support_email: 'help@buynest.test', free_shipping_threshold: '5000.00', allowed_countries: ['Bangladesh'], guest_checkout: true, tax_enabled: false,
    shipping_methods: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: '120.00' }],
    payment_methods: ['sslcommerz', 'cod'], card_payments: 'manual', paypal_payments: 'unavailable', sslcommerz_payments: 'sslcommerz',
    currency: TAKA, currencies: { base: 'BDT', display: [] }, ga4_measurement_id: null, locales: ['en', 'bn'], default_locale: 'en', bangla_digits: true,
    default_country: 'Bangladesh', cod: { fee: '0.00', max_order_total: null, advance: 'none', zones: [], require_confirmation: false },
    ...overrides,
  },
})
const DIVISIONS = [{ id: 3, name: 'Dhaka', name_en: 'Dhaka', name_bn: 'ঢাকা' }]
const DISTRICTS = [{ id: 47, division_id: 3, name: 'Dhaka', name_en: 'Dhaka', name_bn: 'ঢাকা' }]
const AREAS = [
  { id: 1001, district_id: 47, name: 'Banani', name_en: 'Banani', name_bn: 'বনানী', kind: 'thana', postcodes: ['1213'] },
  { id: 1002, district_id: 47, name: 'Mirpur', name_en: 'Mirpur', name_bn: 'মিরপুর', kind: 'thana', postcodes: ['1216', '1221'] },
]
const ESTIMATE = (overrides = {}) => ({
  data: {
    area: { id: 1001, name: 'Banani', district: 'Dhaka', district_id: 47, division: 'Dhaka', division_id: 3 },
    zone: { code: 'inside_dhaka', name: 'Inside Dhaka' },
    methods: [
      { id: 'standard', label: 'Standard', price: '60.00', eta: 'Delivery in 1–2 days', eta_days_min: 1, eta_days_max: 2, free_over_threshold: true },
      { id: 'express', label: 'Express', price: '150.00', eta: 'Delivery in 1 day', eta_days_min: 1, eta_days_max: 1, free_over_threshold: false },
    ],
    free_shipping_threshold: '5000.00',
    cod: { available: true, reason: null, message: null, fee: '20.00' },
    ...overrides,
  },
})
const CATEGORIES = {
  data: [
    { slug: 'electronics', name: 'Electronics', children: [{ slug: 'smartphones', name: 'Smartphones', children: [] }, { slug: 'laptops', name: 'Laptops', children: [] }] },
    { slug: 'beauty', name: 'Beauty', children: [] },
  ],
}
const HOME = (topBar = null, banners = []) => ({ data: { hero: {}, banners, featured_products: [], top_bar: topBar } })
const BANNER = { id: 9, eyebrow: 'Phones', title: 'New phones are here', description: '', cta: { label: 'Shop phones', url: '/categories/smartphones' }, image_url: null, tone: 'navy', is_active: true, position: 1 }
const API = ({ store = STORE(), home = HOME(), estimate = ESTIMATE() } = {}) => ({
  'GET /api/catalog/store': { body: store },
  'GET /api/catalog/home': { body: home },
  'GET /api/catalog/categories': { body: CATEGORIES },
  'GET /api/catalog/products': { body: { data: [], meta: { current_page: 1, per_page: 100, total: 0 } } },
  'GET /api/catalog/places/bd/divisions': { body: { data: DIVISIONS } },
  'GET /api/catalog/places/bd/districts': { body: { data: DISTRICTS } },
  'GET /api/catalog/places/bd/areas': { body: { data: AREAS } },
  'GET /api/catalog/delivery/estimate': typeof estimate === 'function' ? estimate : { body: estimate },
})
const BANANI = {
  divisionId: '3', districtId: '47', areaId: '1001',
  division: { nameEn: 'Dhaka', nameBn: 'ঢাকা' }, district: { nameEn: 'Dhaka', nameBn: 'ঢাকা' }, area: { nameEn: 'Banani', nameBn: 'বনানী', postcodes: ['1213'] },
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

beforeEach(() => {
  resetDeliverToForTests()
  // Prices in the store currency, as the store settings set it when they load.
  setStoreCurrency(TAKA)
})
afterEach(() => {
  resetDeliverToForTests()
  resetDisplayCurrencyForTests()
})

describe('top bar', () => {
  it('shows the promo with its coupon; "Copy" copies it and says so', async () => {
    mockFetch(API({ home: HOME({ message: 'Eid sale: 10% off everything', coupon_code: 'EID10' }) }))
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText') // user-event's clipboard
    renderWithProviders(<TopBar />)
    const bar = await screen.findByRole('complementary', { name: 'Store announcements' })
    expect(await within(bar).findByText('Eid sale: 10% off everything')).toBeInTheDocument()
    expect(within(bar).getByText('EID10')).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Copy code EID10' }))
    expect(writeText).toHaveBeenCalledWith('EID10')
    expect(within(bar).getByRole('status')).toHaveTextContent('Code EID10 copied.')
  })

  it('says the code when copying fails, and shows no code the API left out', async () => {
    mockFetch(API({ home: HOME({ message: 'Free gift with every order', coupon_code: 'GIFT' }) }))
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    const view = renderWithProviders(<TopBar />)
    await user.click(await screen.findByRole('button', { name: 'Copy code GIFT' }))
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't copy. The code is GIFT.")
    view.unmount()

    mockFetch(API({ home: HOME({ message: 'Free gift with every order', coupon_code: null }) }))
    renderWithProviders(<TopBar />)
    expect(await screen.findByText('Free gift with every order')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy code/ })).not.toBeInTheDocument()
  })

  it('closes the promo, remembered for that message (storage blocked: closed for now)', async () => {
    mockFetch(API({ home: HOME({ message: 'Eid sale', coupon_code: null }) }))
    const user = userEvent.setup()
    const view = renderWithProviders(<TopBar />)
    await user.click(await screen.findByRole('button', { name: 'Close announcement' }))
    expect(screen.queryByText('Eid sale')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(STORAGE_KEYS.announcement)).toBe('Eid sale')
    // The delivery line stays.
    expect(screen.getByText('Free standard shipping on orders over ৳5,000')).toBeInTheDocument()
    view.unmount()

    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked') } })
    try {
      mockFetch(API({ home: HOME({ message: 'Another sale', coupon_code: null }) }))
      renderWithProviders(<TopBar />)
      await user.click(await screen.findByRole('button', { name: 'Close announcement' }))
      expect(screen.queryByText('Another sale')).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'localStorage', original)
    }
  })

  it('delivery line: the chosen area with its delivery days; the checkout keeps only language and currency', async () => {
    saveDeliverTo(BANANI)
    mockFetch(API({ store: STORE({ currencies: { base: 'BDT', display: [{ code: 'USD', symbol: '$', rate: '0.0082', decimals: 2 }] } }) }))
    const view = renderWithProviders(<TopBar />)
    expect(await screen.findByText('Deliver to: Banani, Dhaka · Delivery in 1–2 days')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Show prices in')).toBeInTheDocument()
    view.unmount()

    renderWithProviders(<TopBar compact />)
    expect(await screen.findByLabelText('Show prices in')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
  })
})

/** The button and the dialog, like the header wires them. */
function DeliverTo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DeliverToButton onClick={() => setOpen(true)} isOpen={open} />
      <DeliverToDialog isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}

describe('"Deliver to"', () => {
  it('Division → District → Area, the estimate, then remembered in this browser', SLOW, async () => {
    const fetchMock = mockFetch(API())
    const user = userEvent.setup()
    renderWithProviders(<DeliverTo />)
    await user.click(screen.getByRole('button', { name: 'Deliver to: Choose your area' }))
    const dialog = screen.getByRole('dialog', { name: 'Deliver to' })
    const save = within(dialog).getByRole('button', { name: 'Deliver here' })
    expect(save).toBeDisabled()
    await user.selectOptions(await within(dialog).findByLabelText('Division'), '3')
    await waitFor(() => expect(within(dialog).getByLabelText('District')).toBeEnabled())
    await user.selectOptions(within(dialog).getByLabelText('District'), '47')
    await waitFor(() => expect(within(dialog).getByLabelText('Area (upazila or thana)')).toBeEnabled())
    await user.selectOptions(within(dialog).getByLabelText('Area (upazila or thana)'), '1001')

    const estimate = await within(dialog).findByRole('region', { name: 'Delivering to Banani, Dhaka' })
    expect(await within(estimate).findByText('Delivery zone: Inside Dhaka')).toBeInTheDocument()
    const options = within(estimate).getByRole('list', { name: 'Delivery options' })
    expect(within(options).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Standard৳60.00Delivery in 1–2 days', 'Express৳150.00Delivery in 1 day'])
    expect(within(estimate).getByText('Free delivery on orders over ৳5,000.00')).toBeInTheDocument()
    expect(within(estimate).getByText('Cash on delivery is available here (fee ৳20.00).')).toBeInTheDocument()
    const estimateCall = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/api/catalog/delivery/estimate')
    expect(new URL(estimateCall[0]).searchParams.get('area_id')).toBe('1001')

    await user.click(save)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deliver to: Banani, Dhaka' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.deliverTo))).toMatchObject({ divisionId: '3', districtId: '47', areaId: '1001', area: { nameEn: 'Banani', postcodes: ['1213'] } })
  })

  it('a saved area opens as a summary with "Change" and "Clear"; cash on delivery refused says why', async () => {
    saveDeliverTo(BANANI)
    mockFetch(API({ estimate: ESTIMATE({ zone: null, cod: { available: false, reason: 'zone', message: 'Cash on delivery isn’t available in this area.', fee: '0.00' } }) }))
    const user = userEvent.setup()
    renderWithProviders(<DeliverTo />)
    await user.click(screen.getByRole('button', { name: 'Deliver to: Banani, Dhaka' }))
    const dialog = screen.getByRole('dialog', { name: 'Deliver to' })
    expect(await within(dialog).findByText('Cash on delivery isn’t available in this area.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(within(dialog).getByLabelText('Division')).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: 'Deliver to: Banani, Dhaka' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('status')).toHaveTextContent('Delivery area cleared.')
    expect(window.localStorage.getItem(STORAGE_KEYS.deliverTo)).toBeNull()
    expect(screen.getByRole('button', { name: 'Deliver to: Choose your area' })).toBeInTheDocument()
  })

  it('an area the API refuses shows its message', async () => {
    saveDeliverTo(BANANI)
    mockFetch(API({ estimate: () => ({ status: 422, body: { message: 'Delivery areas are for Bangladesh addresses.', errors: { area_id: ['Delivery areas are for Bangladesh addresses.'] } } }) }))
    const user = userEvent.setup()
    renderWithProviders(<DeliverTo />)
    await user.click(screen.getByRole('button', { name: 'Deliver to: Banani, Dhaka' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Delivery areas are for Bangladesh addresses.')
  })

  it('fills the checkout’s empty Bangladesh division, district and area (and the area’s only postcode)', SLOW, async () => {
    saveDeliverTo(BANANI)
    window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items: [{ productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 'm.webp', price: 1100, discountPercentage: 0, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 1 }], couponCode: null }))
    // No product list: an empty one would mark the cart's product as gone.
    const api = API()
    delete api['GET /api/catalog/products']
    mockFetch({
      ...api,
      'POST /api/shop/cart/validate': {
        body: {
          lines: [{ productId: 1, title: 'Mascara', thumbnail: 'm.webp', price: 1100, discountPercentage: 0, salePrice: 1100, quantity: 1, lineTotal: 1100, stock: 99, minimumOrderQuantity: 1, available: true }],
          problems: [], coupon: null, couponError: null, appliedRules: [], requiresShipping: true, shippingError: null, giftCard: null, giftCardError: null,
          shippingOptions: [{ id: 'standard', label: 'Standard', eta: 'Delivery in 1–2 days', price: 60 }],
          cod: { available: true, reason: null, message: null, fee: 0, maxOrderTotal: null, advance: 'none', advanceAmount: 0, requiresConfirmation: false },
          totals: { itemCount: 1, subtotal: 1100, discount: 0, shipping: 60, tax: 0, total: 1160, amountDue: 1160 },
        },
      },
    })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    await waitFor(() => expect(screen.getByLabelText('Area (upazila or thana)')).toHaveDisplayValue('Banani'), { timeout: 10_000 })
    expect(screen.getByLabelText('Division')).toHaveDisplayValue('Dhaka')
    expect(screen.getByLabelText('District')).toHaveDisplayValue('Dhaka')
    expect(screen.getByLabelText('Postcode (optional)')).toHaveValue('1213')
  })

  it('in Bangla', async () => {
    saveDeliverTo(BANANI)
    await switchToBangla()
    mockFetch(API())
    const user = userEvent.setup()
    renderWithProviders(<DeliverTo />)
    await user.click(screen.getByRole('button', { name: 'ডেলিভারি এলাকা: বনানী, ঢাকা' }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('এখানে ক্যাশ অন ডেলিভারি পাওয়া যায় (৳২০.০০ ফি)।')).toBeInTheDocument()
    expectNoEnglish(dialog, { allow: ['Banani', 'Dhaka', 'Inside', 'Standard', 'Express', 'Delivery', 'in', 'days', 'day'] })
  })
})

describe('"All categories" mega menu', () => {
  it('a disclosure: columns with subcategories, the first banner as a promo, Escape returns to the button', async () => {
    mockFetch(API({ home: HOME(null, [BANNER]) }))
    const user = userEvent.setup()
    renderWithProviders(<MegaMenu />)
    const button = screen.getByRole('button', { name: 'All categories' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const panel = document.getElementById(button.getAttribute('aria-controls'))
    expect(panel).toBeVisible()
    expect(await within(panel).findByRole('link', { name: 'Electronics' })).toHaveAttribute('href', '/categories/electronics')
    expect(within(panel).getByRole('link', { name: 'Smartphones' })).toHaveAttribute('href', '/categories/smartphones')
    expect(within(panel).getByRole('link', { name: 'Beauty' })).toBeInTheDocument()
    expect(await within(panel).findByRole('link', { name: /New phones are here/ })).toHaveAttribute('href', '/categories/smartphones')

    await user.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
    expect(panel).not.toBeVisible()
  })

  it('keyboard: ↓ opens and moves in, ↑/↓/End move between links; a click outside or Tab out closes it', async () => {
    mockFetch(API())
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <MegaMenu />
        <button type="button">Elsewhere</button>
      </>,
    )
    const button = screen.getByRole('button', { name: 'All categories' })
    await screen.findByText('Electronics') // the tree has loaded (hidden panel)
    button.focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(screen.getByRole('link', { name: 'Electronics' })).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('link', { name: 'Browse all products' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('link', { name: 'Beauty' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await user.click(button)
    await user.tab() // into the panel
    expect(button).toHaveAttribute('aria-expanded', 'true')
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('header', () => {
  it('search with "Search in": searches within the chosen category', async () => {
    mockFetch(API())
    const user = userEvent.setup()
    renderWithProviders(<Header navLinks={[]} />, { path: '/', extraRoutes: <Route path="*" element={<LocationProbe />} /> })
    const select = await screen.findByRole('combobox', { name: 'Search in' })
    await waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['All categories', 'Electronics', 'Beauty']))
    // The search box is still the first combobox on the page (the browser suites rely on it).
    expect(screen.getAllByRole('combobox')[0]).toHaveAccessibleName('Search products')
    await user.selectOptions(select, 'electronics')
    const [box] = screen.getAllByRole('combobox', { name: 'Search products' })
    await user.type(box, 'phone')
    fireEvent.submit(box.closest('form'))
    expect(await screen.findByTestId('location')).toHaveTextContent('/products?q=phone&category=electronics')
  })

  it('keeps the names the browser suites use; "Deliver to" only for a Bangladeshi store', async () => {
    mockFetch(API({ store: STORE({ default_country: null, allowed_countries: ['United States'] }) }))
    const view = renderWithProviders(<Header navLinks={[{ label: 'Home', labelKey: 'nav.home', to: '/' }]} />)
    expect(await screen.findByRole('link', { name: 'Wishlist, 0 items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cart, 0 items' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sign in/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: 'Language' }).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Deliver to/ })).not.toBeInTheDocument())
    view.unmount()

    mockFetch(API())
    renderWithProviders(<Header navLinks={[]} />)
    // Desktop button and the phone line (CSS shows one of them).
    expect(await screen.findAllByRole('button', { name: 'Deliver to: Choose your area' })).toHaveLength(2)
  })
})

describe('layout', () => {
  it('the phone tab bar opens the menu drawer; the checkout has no tab bar and no promo', async () => {
    mockFetch({ ...API({ home: HOME({ message: 'Eid sale', coupon_code: null }) }), 'POST /api/shop/cart/validate': { body: {} } })
    const user = userEvent.setup()
    const view = renderWithProviders(<MainLayout />, { route: '/', path: '/' })
    expect(await screen.findByText('Eid sale')).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Quick links' })
    expect(document.body).toHaveClass('has-tab-bar')
    await user.click(within(tabs).getByRole('button', { name: 'Categories' }))
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'true')
    view.unmount()
    expect(document.body).not.toHaveClass('has-tab-bar')

    renderWithProviders(<MainLayout />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByRole('banner')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByRole('banner')).getAllByRole('group', { name: 'Language' }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('navigation', { name: 'Quick links' })).not.toBeInTheDocument()
    expect(screen.queryByText('Eid sale')).not.toBeInTheDocument()
  })
})
