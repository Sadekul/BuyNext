import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductDetailsPage from './ProductDetailsPage'
import ProductListingPage from './ProductListingPage'
import CartPage from './CartPage'
import MainNavigation from '../components/layout/MainNavigation'
import OrderItems from '../components/orders/OrderItems'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { useNavLinks } from '../hooks/useNavLinks'

// Phase 5 storefront with BuyNest's API: category tree, variants, reviews.
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const CATEGORIES = {
  data: [
    { slug: 'fashion', name: 'Fashion', children: [{ slug: 'tees', name: 'Tees', children: [] }, { slug: 'shoes', name: 'Shoes', children: [] }] },
    { slug: 'beauty', name: 'Beauty', children: [] },
  ],
}
const TEE = {
  id: 5,
  name: 'Classic Tee',
  price: '20.00',
  discount_percent: 0,
  stock_quantity: 7,
  availability: 'in_stock',
  has_variants: true,
  category: { slug: 'tees' },
  images: [],
  thumbnail_url: '/media/products/5/0123456789abcdef0123456789abcdef.webp',
  options: [
    { id: 1, name: 'Size', values: [{ id: 11, value: 'S' }, { id: 12, value: 'M' }] },
    { id: 2, name: 'Color', values: [{ id: 21, value: 'Red' }, { id: 22, value: 'Blue' }] },
  ],
  variants: [
    { id: 51, sku: 'TEE-S-RED', option_value_ids: [11, 21], price: '20.00', final_price: '20.00', stock_quantity: 4, in_stock: true },
    { id: 52, sku: 'TEE-M-RED', option_value_ids: [12, 21], price: '24.00', final_price: '24.00', stock_quantity: 0, in_stock: false },
    { id: 53, sku: 'TEE-M-BLUE', option_value_ids: [12, 22], price: '24.00', final_price: '24.00', stock_quantity: 3, in_stock: true },
  ],
  reviews: [
    { id: 1, rating: 5, title: 'Great fit', comment: 'Soft cotton, true to size.', author_name: 'Ava C.', created_at: '2026-11-01T10:00:00Z', verified_purchase: true },
    { id: 2, rating: 4, title: null, comment: 'Nice colour.', author_name: 'Ben', created_at: '2026-11-02T10:00:00Z', verified_purchase: false },
  ],
}
const page = (items) => ({ data: items, meta: { current_page: 1, per_page: 100, total: items.length } })
const CATALOG = {
  'GET /api/catalog/products/5': { body: { data: TEE } },
  'GET /api/catalog/products': { body: page([]) },
  'GET /api/catalog/categories': { body: CATEGORIES },
}
const signIn = () => {
  document.cookie = 'buynest_session=session; Path=/'
  window.localStorage.setItem('buynest.session.v2', JSON.stringify({ user: { id: 5, firstName: 'Nadia' }, remember: false }))
}
const ME = { 'GET /api/auth/me': { body: { id: 5, firstName: 'Nadia', email: 'nadia@example.com', role: 'customer' } } }
const renderProduct = () => renderWithProviders(<ProductDetailsPage />, { route: '/products/5', path: '/products/:productId' })
const savedCart = () => JSON.parse(window.localStorage.getItem('buynest.cart.v1')).items

describe('product options and variants', () => {
  it('needs a full selection, disables unavailable combinations, and follows the chosen variant', async () => {
    mockFetch(CATALOG)
    const user = userEvent.setup()
    renderProduct()

    expect(await screen.findByRole('heading', { level: 1, name: 'Classic Tee' })).toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'Add to cart' })
    expect(add).toBeDisabled()
    expect(add).toHaveAccessibleDescription('Choose size and color to add this to your cart')
    expect(screen.getByText('From')).toBeInTheDocument() // variants cost $20 or $24

    const size = screen.getByRole('group', { name: 'Size' })
    const color = screen.getByRole('group', { name: 'Color' })
    await user.click(within(size).getByRole('radio', { name: 'M' }))
    expect(within(color).getByRole('radio', { name: /Red/ })).toBeDisabled() // M / Red is sold out
    await user.click(within(color).getByRole('radio', { name: 'Blue' }))

    expect(add).toBeEnabled()
    expect(screen.getByText('$24.00')).toBeInTheDocument()
    // The quantity stops at the variant's stock (3), not the product's total.
    const more = screen.getByRole('button', { name: 'Increase quantity' })
    await user.click(more)
    await user.click(more)
    expect(more).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }))
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('HomeFashionTeesClassic Tee')

    await user.click(add)
    expect(savedCart()).toEqual([
      expect.objectContaining({ productId: 5, variantId: 53, variantLabel: 'Size: M / Color: Blue', price: 24, stock: 3, quantity: 2 }),
    ])
  })

  it('sends the variant with the cart and shows its label on the cart page', async () => {
    window.localStorage.setItem(
      'buynest.cart.v1',
      JSON.stringify({ items: [{ productId: 5, variantId: 53, variantLabel: 'Size: M / Color: Blue', title: 'Classic Tee', price: 24, stock: 3, quantity: 1, discountPercentage: 0, minimumOrderQuantity: 1 }], couponCode: null }),
    )
    const fetchMock = mockFetch({
      ...CATALOG,
      'GET /api/catalog/store': { body: { data: { shipping_methods: [{ id: 'standard', label: 'Standard', price: '4.99' }], payment_methods: ['cod'], allowed_countries: [] } } },
      'POST /api/shop/cart/validate': { body: { lines: [], problems: [], coupon: null, couponError: null, shippingOptions: [], totals: { itemCount: 1, subtotal: 24, discount: 0, shipping: 4.99, tax: 0, total: 28.99 } } },
    })
    renderWithProviders(<CartPage />, { route: '/cart', path: '/cart' })
    expect(await screen.findByText('Size: M / Color: Blue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Classic Tee (Size: M / Color: Blue) from cart' })).toBeInTheDocument()
    await screen.findByText('$28.99')
    const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/api/shop/cart/validate')
    expect(JSON.parse(call[1].body).items).toEqual([{ productId: 5, variantId: 53, quantity: 1 }])
  })

  it('shows the variant label on order lines', () => {
    renderWithProviders(<OrderItems items={[{ productId: 5, variantId: 53, variantLabel: 'Size: M / Color: Blue', title: 'Classic Tee', quantity: 1, salePrice: 24, lineTotal: 24 }]} />)
    expect(screen.getByText('Size: M / Color: Blue')).toBeInTheDocument()
  })
})

describe('reviews', () => {
  it('shows a "Verified purchase" badge and a sign-in link for signed-out visitors', async () => {
    mockFetch(CATALOG)
    renderProduct()
    const verified = await screen.findByText('Great fit')
    expect(verified.closest('li')).toHaveTextContent('Verified purchase')
    expect(screen.getByText('Nice colour.').closest('li')).not.toHaveTextContent('Verified purchase')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('button', { name: 'Submit review' })).not.toBeInTheDocument()
  })

  it('lets a customer write a review that waits for approval', async () => {
    signIn()
    const fetchMock = mockFetch({
      ...CATALOG,
      ...ME,
      'POST /api/shop/products/5/reviews': { status: 201, body: { id: 9, rating: 4, title: 'Good', comment: 'Soft and fits well.', status: 'pending', verifiedPurchase: false } },
    })
    const user = userEvent.setup()
    renderProduct()
    const submit = await screen.findByRole('button', { name: 'Submit review' })

    await user.click(submit)
    expect(screen.getByRole('group', { name: 'Your rating' })).toHaveAccessibleDescription('Choose a rating from 1 to 5 stars.')
    expect(screen.getByLabelText('Your review')).toHaveAccessibleDescription(/Write at least 10 characters/)

    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.type(screen.getByLabelText('Title (optional)'), 'Good')
    await user.type(screen.getByLabelText('Your review'), 'Soft and fits well.')
    await user.click(submit)

    expect(await screen.findByRole('status')).toHaveTextContent('Thanks — your review will appear after approval.')
    const call = fetchMock.mock.calls.find(([url]) => new URL(url).pathname === '/api/shop/products/5/reviews')
    expect(JSON.parse(call[1].body)).toEqual({ rating: 4, title: 'Good', comment: 'Soft and fits well.' })
    expect(call[1].credentials).toBe('same-origin')
  })

  it('explains a second review of the same product', async () => {
    signIn()
    mockFetch({
      ...CATALOG,
      ...ME,
      'POST /api/shop/products/5/reviews': { status: 422, body: { message: 'You have already reviewed this product.', code: 'already_reviewed' } },
    })
    const user = userEvent.setup()
    renderProduct()
    await user.click(await screen.findByRole('radio', { name: '5 stars' }))
    await user.type(screen.getByLabelText('Your review'), 'Still lovely after a month.')
    await user.click(screen.getByRole('button', { name: 'Submit review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("You've already reviewed this product.")
  })
})

describe('category tree', () => {
  it('lists subcategories on a category page and asks the API for the whole branch', async () => {
    const fetchMock = mockFetch(CATALOG)
    renderWithProviders(<ProductListingPage />, { route: '/categories/fashion', path: '/categories/:categorySlug' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Fashion' })).toBeInTheDocument()
    const subcategories = screen.getByRole('navigation', { name: 'Fashion subcategories' })
    expect(within(subcategories).getByRole('link', { name: 'Tees' })).toHaveAttribute('href', '/categories/tees')
    // Top-level categories only in the category chips.
    const chips = screen.getByRole('navigation', { name: 'Product categories' })
    expect(within(chips).queryByRole('link', { name: 'Tees' })).not.toBeInTheDocument()
    await screen.findByRole('heading', { name: 'No products here yet' })
    const list = fetchMock.mock.calls.map(([url]) => new URL(url)).find((url) => url.pathname === '/api/catalog/products')
    expect(list.searchParams.get('category')).toBe('fashion')
  })

  it('shows top-level categories in the navigation, with a submenu for their children', async () => {
    mockFetch(CATALOG)
    const user = userEvent.setup()
    function Nav() {
      return <MainNavigation links={useNavLinks().links} />
    }
    renderWithProviders(<Nav />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(await within(nav).findByRole('link', { name: 'Beauty' })).toHaveAttribute('href', '/categories/beauty')
    expect(within(nav).getByRole('link', { name: 'Fashion' })).toHaveAttribute('href', '/categories/fashion')
    expect(within(nav).queryByRole('link', { name: 'Tees' })).not.toBeInTheDocument() // closed

    const toggle = within(nav).getByRole('button', { name: 'Fashion subcategories' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: 'Tees' })).toHaveAttribute('href', '/categories/tees')

    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })
})
