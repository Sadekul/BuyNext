import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomePage from './HomePage'
import CmsPage from './CmsPage'
import CartPage from './CartPage'
import CheckoutPage from './CheckoutPage'
import Footer from '../components/layout/Footer'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { normalizeStoreSettings, safeLinkTarget } from '../services/adapters/contentAdapter'

// The admin's CMS and store settings with BuyNest's API (VITE_API_PROVIDER=laravel + VITE_ACCOUNTS_BACKEND=laravel).
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

// Laravel resources, unchanged (snake_case, money as strings), as /api/catalog passes them on.
const PRODUCT = { id: 7, name: 'Nest Lamp', price: '40.00', discount_percent: '0', category: { slug: 'furniture' }, brand: { name: 'Nest' }, rating_average: '4.5', stock_quantity: 12, availability: 'in_stock', thumbnail_url: 'lamp.webp', images: [] }
const HOME = {
  data: {
    hero: {
      eyebrow: 'Winter edit',
      title: 'Cosy up your nest.',
      description: 'Warm lights and soft throws.',
      primary_cta: { label: 'Shop winter', url: '/categories/furniture' },
      secondary_cta: { label: 'Bad link', url: 'javascript:alert(1)' },
      image_url: 'https://img.test/hero.webp',
      image_alt: 'A lamp on a side table',
      highlights: ['Free shipping over $75', 'Easy returns', 'Secure checkout'],
    },
    banners: [
      { id: 2, eyebrow: 'Later', title: 'Second banner', description: 'B', cta: { label: 'Go', url: '/deals' }, image_url: 'b.webp', image_alt: 'B', tone: 'rose', position: 2, is_active: true },
      { id: 1, eyebrow: 'First', title: 'First banner', description: 'A', cta: { label: 'Shop lamps', url: '/categories/furniture' }, image_url: 'a.webp', image_alt: 'A', tone: 'amber', position: 1, is_active: true },
      { id: 3, eyebrow: 'Off', title: 'Hidden banner', description: 'C', cta: null, image_url: 'c.webp', image_alt: 'C', tone: 'navy', position: 3, is_active: false },
    ],
    featured_products: [PRODUCT],
  },
}
const STORE = {
  data: {
    store_name: 'BuyNest',
    support_email: 'help@buynest.test',
    support_phone: '+1 (555) 010-9999',
    shipping_methods: [
      { id: 'standard', label: 'Standard', eta: '3–5 business days', price: '5.99' },
      { id: 'express', label: 'Express', eta: '1–2 business days', price: '14.99' },
    ],
    free_shipping_threshold: '100.00',
    allowed_countries: ['United States', 'Canada'],
    payment_methods: ['card', 'cod'],
    guest_checkout: true,
    tax_enabled: false,
  },
}
const storeWith = (changes) => ({ body: { data: { ...STORE.data, ...changes } } })
// The rest of the home page still comes from the (DummyJSON, in unit tests) catalog.
const CATALOG = {
  'GET /products': { body: { products: [], total: 0, skip: 0, limit: 0 } },
  'GET /products/categories': { body: [] },
}

const LINE_ITEM = { productId: 1, title: 'Mascara', brand: 'Essence', category: 'beauty', thumbnail: 't.webp', price: 10, discountPercentage: 0, stock: 99, minimumOrderQuantity: 1, availabilityStatus: 'In Stock', quantity: 3 }
const seedCart = () => window.localStorage.setItem('buynest.cart.v1', JSON.stringify({ items: [LINE_ITEM], couponCode: null }))
const CART_CATALOG = { 'GET /products': { body: { products: [{ ...LINE_ITEM, id: 1 }], total: 1, skip: 0, limit: 1 } } }
const pricedCart = (totals) => ({
  lines: [{ productId: 1, sku: 'BEA-1', title: 'Mascara', thumbnail: 't.webp', price: 10, discountPercentage: 0, salePrice: 10, quantity: 3, lineTotal: 30, stock: 99, minimumOrderQuantity: 1, available: true }],
  problems: [],
  coupon: null,
  couponError: null,
  shippingOptions: [{ id: 'standard', label: 'Standard', eta: '3–5 business days', price: 5.99 }, { id: 'express', label: 'Express', eta: '1–2 business days', price: 14.99 }],
  totals: { itemCount: 3, subtotal: 30, discount: 0, shipping: 5.99, tax: 0, total: 35.99, ...totals },
})
const sentBodies = (fetchMock, path) => fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === path).map(([, init]) => JSON.parse(init.body))

describe('home page from the CMS', () => {
  it('shows the admin’s hero, active banners in order, and featured products', async () => {
    mockFetch({ ...CATALOG, 'GET /api/catalog/home': { body: HOME } })
    renderWithProviders(<HomePage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Cosy up your nest.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Shop winter' })).toHaveAttribute('href', '/categories/furniture')
    expect(screen.queryByRole('link', { name: 'Bad link' })).not.toBeInTheDocument() // javascript: never becomes a link
    expect(screen.getByRole('img', { name: 'A lamp on a side table' })).toBeInTheDocument()
    expect(screen.getByText('Free shipping over $75')).toBeInTheDocument()

    const promotions = screen.getByRole('region', { name: 'Promotions' })
    expect(within(promotions).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['First banner', 'Second banner'])
    expect(screen.queryByText('Hidden banner')).not.toBeInTheDocument()

    const featured = screen.getByRole('region', { name: /Featured products/ })
    expect(within(featured).getByRole('link', { name: 'Nest Lamp' })).toHaveAttribute('href', '/products/7')
  })

  it('keeps the page usable when the content can’t be loaded', async () => {
    const fetchMock = mockFetch({ ...CATALOG, 'GET /api/catalog/home': { status: 500, body: { message: 'The server had a problem.' } } })
    renderWithProviders(<HomePage />)
    expect(screen.getByRole('heading', { level: 1, name: 'BuyNest' })).toBeInTheDocument() // the h1 stays while it loads

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 1 })).toHaveTextContent("We couldn't load this page's highlights")
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument() // the newsletter (rest of the page) is still there

    fetchMock.mockClear()
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/api/catalog/home' }), expect.anything())
  })
})

describe('CMS pages', () => {
  it('renders the page’s HTML in an article, with its title and meta description', async () => {
    mockFetch({
      'GET /api/catalog/pages/shipping-and-returns': {
        body: { data: { slug: 'shipping-and-returns', title: 'Shipping & returns', body: '<p>We ship fast.</p><h2>Returns</h2><ul><li>30 days</li></ul><p><a href="/products">Shop now</a></p>', meta_title: 'Shipping and returns', meta_description: 'How we ship and how to return.', is_published: true } },
      },
    })
    renderWithProviders(<CmsPage />, { route: '/pages/shipping-and-returns', path: '/pages/:slug' })

    const article = await screen.findByRole('article', { name: 'Shipping & returns' })
    expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent('Shipping & returns')
    expect(within(article).getByRole('heading', { level: 2, name: 'Returns' })).toBeInTheDocument()
    expect(within(article).getByText('30 days')).toBeInTheDocument()
    expect(within(article).getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '/products')
    expect(document.title).toBe('Shipping and returns | BuyNest')
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', 'How we ship and how to return.')
  })

  it('shows the contact page with the store’s support details', async () => {
    mockFetch({
      'GET /api/catalog/pages/contact': { body: { data: { slug: 'contact', title: 'Contact us', body: '<p>We are here to help.</p>', meta_title: null, meta_description: null } } },
      'GET /api/catalog/store': { body: STORE },
    })
    renderWithProviders(<CmsPage />, { route: '/pages/contact', path: '/pages/:slug' })
    const support = await screen.findByRole('complementary', { name: 'Customer support' })
    expect(await within(support).findByRole('link', { name: 'help@buynest.test' })).toHaveAttribute('href', 'mailto:help@buynest.test')
    expect(document.title).toBe('Contact us | BuyNest')
  })

  it('shows "page not found" for an unknown or unpublished page', async () => {
    mockFetch({ 'GET /api/catalog/pages/secret-draft': { status: 404, body: { message: 'Not found.' } } })
    renderWithProviders(<CmsPage />, { route: '/pages/secret-draft', path: '/pages/:slug' })
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('links the CMS pages and the store’s support details in the footer', async () => {
    mockFetch({ 'GET /api/catalog/store': { body: STORE } })
    renderWithProviders(<Footer />)
    const help = screen.getByRole('navigation', { name: 'Help & info' })
    const links = within(help).getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(links).toEqual(['/pages/about', '/pages/shipping-and-returns', '/pages/privacy', '/pages/terms', '/pages/contact'])
    expect(await screen.findByRole('link', { name: 'help@buynest.test' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+1 (555) 010-9999' })).toHaveAttribute('href', 'tel:+15550109999')
  })
})

describe('store settings in the cart and checkout', () => {
  it('the cart uses the store’s free-shipping threshold and shows no tax line when tax is off', async () => {
    seedCart()
    mockFetch({ ...CART_CATALOG, 'GET /api/catalog/store': { body: STORE }, 'POST /api/shop/cart/validate': { body: pricedCart() } })
    renderWithProviders(<CartPage />)
    // $30 of $100: $70 to go (the demo threshold is $50).
    expect(await screen.findByText('$70.00')).toBeInTheDocument()
    expect(screen.queryByText('Taxes')).not.toBeInTheDocument()
  })

  it('a guest can’t check out when guest checkout is off', async () => {
    seedCart()
    mockFetch({ ...CART_CATALOG, 'GET /api/catalog/store': storeWith({ guest_checkout: false }), 'POST /api/shop/cart/validate': { body: pricedCart() } })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })
    expect(await screen.findByRole('heading', { name: 'Sign in to check out' })).toBeInTheDocument()
    expect(screen.getByText(/Guest checkout isn't available right now/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('button', { name: /Place order/ })).not.toBeInTheDocument()
  })

  it('offers only the store’s countries, delivery options, and payment methods', async () => {
    seedCart()
    mockFetch({ ...CART_CATALOG, 'GET /api/catalog/store': { body: STORE }, 'POST /api/shop/cart/validate': { body: pricedCart() } })
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })

    const country = await screen.findByLabelText('Country')
    expect(within(country).getAllByRole('option').map((option) => option.textContent)).toEqual(['United States', 'Canada'])
    expect(screen.getByRole('radio', { name: /Credit or debit card/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Cash on delivery/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /PayPal/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Next day/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /Express.*\$14\.99/ })).toBeInTheDocument()
    expect(screen.queryByText('Taxes')).not.toBeInTheDocument()
  })

  it('with tax on, sends the shipping country and shows the server’s tax', async () => {
    seedCart()
    const fetchMock = mockFetch({
      ...CART_CATALOG,
      'GET /api/catalog/store': storeWith({ tax_enabled: true }),
      'POST /api/shop/cart/validate': (url, init) => {
        const { country } = JSON.parse(init.body)
        const tax = country === 'Canada' ? 4.68 : 2.88
        return { body: pricedCart({ tax, total: 35.99 + tax }) }
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<CheckoutPage />, { route: '/checkout', path: '/checkout' })

    expect(await screen.findByRole('button', { name: 'Place order · $38.87' })).toBeInTheDocument()
    const taxRow = screen.getByText('Taxes').closest('div')
    expect(taxRow).toHaveTextContent('$2.88')
    expect(sentBodies(fetchMock, '/api/shop/cart/validate').at(-1)).toMatchObject({ shippingMethod: 'standard', country: 'United States' })

    await user.selectOptions(screen.getByLabelText('Country'), 'Canada')
    expect(await screen.findByRole('button', { name: 'Place order · $40.67' })).toBeInTheDocument()
    expect(sentBodies(fetchMock, '/api/shop/cart/validate').at(-1)).toMatchObject({ country: 'Canada' })
  })
})

describe('content adapter', () => {
  it('only lets site paths and http(s) addresses become links', () => {
    expect(safeLinkTarget('/products')).toBe('/products')
    expect(safeLinkTarget('https://example.com/a')).toBe('https://example.com/a')
    expect(safeLinkTarget('javascript:alert(1)')).toBeNull()
    expect(safeLinkTarget('//evil.example')).toBeNull()
    expect(safeLinkTarget('/\\evil.example')).toBeNull()
    expect(safeLinkTarget(null)).toBeNull()
  })

  it('turns the store settings into the storefront’s rules', () => {
    const settings = normalizeStoreSettings(STORE)
    expect(settings.shippingMethods).toEqual([
      { id: 'standard', label: 'Standard', eta: '3–5 business days', price: null },
      { id: 'express', label: 'Express', eta: '1–2 business days', price: 14.99 },
    ])
    expect(settings).toMatchObject({ standardShippingCost: 5.99, freeShippingThreshold: 100, countries: ['United States', 'Canada'], guestCheckout: true, taxEnabled: false })
    expect(settings.paymentMethods.map((method) => method.id)).toEqual(['card', 'cod'])
  })
})
