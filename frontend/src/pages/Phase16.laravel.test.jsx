import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProductDetailsPage from './ProductDetailsPage'
import ProductCard from '../components/product/ProductCard'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { expectNoEnglish, switchToBangla } from '../test/i18n'
import { normalizeProduct } from '../services/adapters/laravelAdapter'
import { resetDisplayCurrencyForTests, setStoreCurrency } from '../utils/displayCurrency'

// Phase 16 storefront (docs/backend/PHASE16_CONTRACT.md §2–§4): colour swatches, Magento-style choice
// (nothing pre-selected, "From", "Please select …"), shareable URLs, photos per colour, cards.
vi.mock('../services/providers/index', async () => ({ apiProvider: (await import('../services/providers/laravelProvider')).laravelProvider }))
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const SLOW = { timeout: 20_000 }
const image = (name, valueId = null) => ({ url: `/media/products/7/${name}.webp`, alt: null, option_value_id: valueId })
const SHIRT = {
  id: 7,
  name: 'Oxford Shirt',
  sku: 'SHIRT',
  price: '20.00',
  discount_percent: 0,
  stock_quantity: 10,
  availability: 'in_stock',
  has_variants: true,
  category: { slug: 'shirts', name: 'Shirts' },
  images: [image('shared'), image('red-1', 21), image('blue-1', 22), image('blue-2', 22)],
  thumbnail_url: '/media/products/7/shared.webp',
  reviews: [],
  options: [
    {
      id: 2,
      name: 'Color',
      type: 'color',
      values: [
        { id: 21, value: 'Red', swatch: '#CC0000' },
        { id: 22, value: 'Blue', swatch: '#1D4ED8' },
        { id: 23, value: 'Green', swatch: '#15803D' },
      ],
    },
    { id: 1, name: 'Size', type: 'text', values: [{ id: 11, value: 'S', swatch: null }, { id: 12, value: 'M', swatch: null }] },
  ],
  variants: [
    { id: 61, sku: 'SHIRT-RED-S', option_value_ids: [21, 11], price: '20.00', final_price: '20.00', stock_quantity: 5, in_stock: true },
    { id: 62, sku: 'SHIRT-RED-M', option_value_ids: [21, 12], price: '20.00', final_price: '20.00', stock_quantity: 0, in_stock: false },
    { id: 63, sku: 'SHIRT-BLUE-S', option_value_ids: [22, 11], price: '24.00', final_price: '24.00', stock_quantity: 9, in_stock: true },
    { id: 64, sku: 'SHIRT-BLUE-M', option_value_ids: [22, 12], price: '24.00', final_price: '24.00', stock_quantity: 2, in_stock: true },
    { id: 65, sku: 'SHIRT-GREEN-S', option_value_ids: [23, 11], price: '20.00', final_price: '20.00', stock_quantity: 0, in_stock: false },
  ],
}
const catalog = (product = SHIRT) => ({
  'GET /api/catalog/products/7': { body: { data: product } },
  'GET /api/catalog/products': { body: { data: [], meta: { current_page: 1, per_page: 4, total: 0 } } },
  'GET /api/catalog/categories': { body: { data: [{ slug: 'shirts', name: 'Shirts', children: [] }] } },
})
const renderShirt = (query = '') => renderWithProviders(<ProductDetailsPage />, { route: `/products/7${query}`, path: '/products/:productId' })
const savedCart = () => JSON.parse(window.localStorage.getItem('buynest.cart.v1') ?? '{"items":[]}').items
const mainImage = () => document.querySelector('.gallery__main img')

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(() => resetDisplayCurrencyForTests())

describe('product page: colour swatches and the Magento choice', () => {
  it('shows swatches as radios, nothing chosen, "From", no stock line and the parent SKU', async () => {
    mockFetch(catalog())
    renderShirt()
    expect(await screen.findByRole('heading', { level: 1, name: 'Oxford Shirt' })).toBeInTheDocument()

    const color = screen.getByRole('group', { name: 'Color' })
    const radios = within(color).getAllByRole('radio')
    expect(radios.map((radio) => radio.labels[0].textContent)).toEqual(['Red', 'Blue', 'Green (sold out)'])
    expect(within(color).getByRole('radio', { name: 'Blue' }).labels[0]).toHaveAttribute('title', 'Blue')
    expect(within(color).getByRole('radio', { name: 'Blue' }).labels[0]).toHaveClass('variant-selector__swatch')
    // Green: sold out in every size — crossed, but selectable for a stock alert (phase 9).
    const green = within(color).getByRole('radio', { name: 'Green (sold out)' })
    expect(green).toBeEnabled()
    expect(green.labels[0]).toHaveClass('variant-selector__swatch--unavailable')
    expect(screen.getAllByRole('radio').filter((radio) => radio.checked)).toHaveLength(0)

    expect(screen.getByText('From')).toBeInTheDocument()
    expect(screen.getByText('From').parentElement).toHaveTextContent('From $20.00')
    expect(screen.queryByText(/In stock|Low stock|Out of stock/)).not.toBeInTheDocument()
    expect(screen.getByText('SHIRT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled()
  })

  it('"Please select …" for each missing option, focus to the first, nothing added', async () => {
    const fetchMock = mockFetch(catalog())
    const user = userEvent.setup()
    renderShirt()
    await user.click(await screen.findByRole('button', { name: 'Add to cart' }))

    const color = screen.getByRole('group', { name: 'Color' })
    const size = screen.getByRole('group', { name: 'Size' })
    expect(color).toHaveAccessibleDescription('Please select Color.')
    expect(size).toHaveAccessibleDescription('Please select Size.')
    expect(within(color).getByRole('radio', { name: 'Red' })).toHaveFocus()
    expect(savedCart()).toEqual([])
    expect(fetchMock.mock.calls.some(([url]) => new URL(url).pathname.startsWith('/api/shop/cart'))).toBe(false)

    // Choosing a colour clears its message; the size message stays until a size is chosen.
    await user.click(within(color).getByRole('radio', { name: 'Blue' }))
    expect(screen.getByRole('group', { name: 'Color: Blue' })).not.toHaveAccessibleDescription()
    await user.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(within(size).getByRole('radio', { name: 'S' })).toHaveFocus()
    expect(size).toHaveAccessibleDescription('Please select Size.')
  })

  it('a full choice sets price, stock, SKU, photo and the URL, then adds that variant', async () => {
    mockFetch(catalog())
    const user = userEvent.setup()
    renderShirt()
    const color = await screen.findByRole('group', { name: 'Color' })
    expect(mainImage()).toHaveAttribute('src', '/media/products/7/shared.webp')

    await user.click(within(color).getByRole('radio', { name: 'Blue' }))
    // The legend names the choice; the gallery moves to Blue's photos (then the shared one).
    expect(screen.getByRole('group', { name: 'Color: Blue' })).toBeInTheDocument()
    expect(mainImage()).toHaveAttribute('src', '/media/products/7/blue-1.webp')
    const thumbs = within(screen.getByRole('list', { name: 'Product images' })).getAllByRole('button')
    expect(thumbs).toHaveLength(3)
    expect(window.location.search).toBe('') // not a full choice yet

    await user.click(screen.getByRole('radio', { name: 'M' }))
    expect(screen.queryByText('From')).not.toBeInTheDocument()
    expect(screen.getByText('$24.00')).toBeInTheDocument()
    expect(screen.getByText('Low stock — only 2 left')).toBeInTheDocument()
    expect(screen.getByText('SHIRT-BLUE-M')).toBeInTheDocument()
    expect(window.location.search).toBe('?color=blue&size=m')

    await user.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(savedCart()).toEqual([expect.objectContaining({ productId: 7, variantId: 64, variantLabel: 'Color: Blue / Size: M', price: 24, quantity: 1 })])
  })

  it('opens a shared URL with that choice (sold out: stock alert) and ignores invalid parameters', async () => {
    mockFetch(catalog())
    const first = renderShirt('?color=red&size=m')
    expect(await screen.findByRole('radio', { name: 'Red' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^M/ })).toBeChecked()
    expect(screen.getByText('Out of stock')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Email me when it's back" })).toBeInTheDocument()
    first.unmount()

    renderShirt('?color=purple&size=m&utm_source=mail')
    await screen.findByRole('heading', { level: 1, name: 'Oxford Shirt' })
    expect(screen.getAllByRole('radio').filter((radio) => radio.checked)).toHaveLength(1)
    expect(screen.getByRole('radio', { name: 'M' })).toBeChecked()
    expect(screen.getByText('From')).toBeInTheDocument()
  })

  it('pre-selects the only buyable combination', async () => {
    const single = { ...SHIRT, variants: SHIRT.variants.map((variant) => (variant.id === 63 ? variant : { ...variant, stock_quantity: 0, in_stock: false })) }
    mockFetch(catalog(single))
    renderShirt()
    expect(await screen.findByRole('radio', { name: 'Blue' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'S' })).toBeChecked()
    expect(screen.getByText('In stock')).toBeInTheDocument()
    expect(screen.getByText('SHIRT-BLUE-S')).toBeInTheDocument()
  })

  it('keeps working with answers from before phase 16 (text buttons, no swatches)', async () => {
    const old = {
      ...SHIRT,
      images: SHIRT.images.map(({ url, alt }) => ({ url, alt })),
      options: SHIRT.options.map(({ id, name, values }) => ({ id, name, values: values.map(({ id: valueId, value }) => ({ id: valueId, value })) })),
    }
    mockFetch(catalog(old))
    const user = userEvent.setup()
    renderShirt()
    const blue = await screen.findByRole('radio', { name: 'Blue' })
    expect(blue.labels[0]).toHaveClass('variant-selector__label')
    await user.click(blue)
    expect(mainImage()).toHaveAttribute('src', '/media/products/7/shared.webp') // no photos per colour
  })
})

describe('product cards', () => {
  const listItem = (overrides = {}) =>
    normalizeProduct({
      id: 7,
      name: 'Oxford Shirt',
      price: '20.00',
      discount_percent: 0,
      stock_quantity: 10,
      availability: 'in_stock',
      has_variants: true,
      thumbnail_url: '/media/products/7/shared.webp',
      images: [],
      price_range: { min: '20.00', max: '24.00' },
      swatches: ['Red', 'Blue', 'Green', 'Black', 'White', 'Pink', 'Navy'].map((value, index) => ({
        value_id: 20 + index,
        value,
        swatch: '#123456',
        image_url: index === 1 ? '/media/products/7/blue-1.webp' : null,
      })),
      ...overrides,
    })

  it('"From", up to 5 decorative dots with a count, and "Choose options" to the product page', () => {
    renderWithProviders(<ProductCard product={listItem()} onAddToCart={vi.fn()} />)
    const card = screen.getByRole('article')
    expect(within(card).getByText('From').parentElement).toHaveTextContent('From $20.00')
    const dots = card.querySelectorAll('.product-card__swatch')
    expect(dots).toHaveLength(5)
    dots.forEach((dot) => expect(dot).toHaveAttribute('aria-hidden', 'true'))
    expect(within(card).getByText('+2')).toHaveAttribute('aria-hidden', 'true')
    expect(within(card).getByText('7 colours')).toHaveClass('visually-hidden')
    expect(within(card).getByRole('link', { name: 'Choose options for Oxford Shirt' })).toHaveAttribute('href', '/products/7')
    expect(within(card).queryByRole('button', { name: /Add to cart/ })).not.toBeInTheDocument()
  })

  it('pointer hover on a dot shows that colour’s photo (not touch)', () => {
    const { container } = renderWithProviders(<ProductCard product={listItem()} />)
    const image = container.querySelector('.product-card__media img')
    const blue = container.querySelectorAll('.product-card__swatch')[1]
    fireEvent.pointerEnter(blue, { pointerType: 'touch' })
    expect(container.querySelector('.product-card__media img')).toHaveAttribute('src', '/media/products/7/shared.webp')
    fireEvent.pointerEnter(blue, { pointerType: 'mouse' })
    expect(container.querySelector('.product-card__media img')).toHaveAttribute('src', '/media/products/7/blue-1.webp')
    expect(container.querySelector('.product-card__media img')).toHaveAttribute('width', image.getAttribute('width'))
    fireEvent.pointerLeave(blue, { pointerType: 'mouse' })
    expect(container.querySelector('.product-card__media img')).toHaveAttribute('src', '/media/products/7/shared.webp')
  })

  it('one price, no "From", when every variant costs the same; simple products unchanged', () => {
    const { unmount } = renderWithProviders(<ProductCard product={listItem({ price_range: { min: '22.00', max: '22.00' } })} />)
    expect(screen.queryByText('From')).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<ProductCard product={listItem({ has_variants: false, price_range: null, swatches: [] })} onAddToCart={vi.fn()} />)
    expect(screen.queryByText('From')).not.toBeInTheDocument()
    expect(document.querySelector('.product-card__swatches')).toBeNull()
    expect(screen.getByRole('button', { name: /Add to cart/ })).toBeInTheDocument()
  })
})

describe('in Bangla', () => {
  const BN_SHIRT = {
    ...SHIRT,
    name: 'অক্সফোর্ড শার্ট',
    options: [
      {
        ...SHIRT.options[0],
        name: 'রং',
        code: 'color',
        values: [
          { id: 21, value: 'লাল', swatch: '#CC0000', code: 'red' },
          { id: 22, value: 'নীল', swatch: '#1D4ED8', code: 'blue' },
          { id: 23, value: 'সবুজ', swatch: '#15803D', code: 'green' },
        ],
      },
      { ...SHIRT.options[1], name: 'সাইজ', code: 'size', values: [{ id: 11, value: 'S', swatch: null, code: 's' }, { id: 12, value: 'M', swatch: null, code: 'm' }] },
    ],
    category: { slug: 'shirts', name: 'শার্ট' },
  }

  it('legend, "শুরু ৳…", Please-select messages, sold out and card count', SLOW, async () => {
    setStoreCurrency({ code: 'BDT', symbol: '৳', decimals: 2 })
    await switchToBangla()
    mockFetch({ ...catalog(BN_SHIRT), 'GET /api/catalog/categories': { body: { data: [{ slug: 'shirts', name: 'শার্ট', children: [] }] } } })
    const user = userEvent.setup()
    const view = renderShirt()
    const color = await screen.findByRole('group', { name: 'রং' })
    expect(screen.getByText('শুরু').parentElement).toHaveTextContent('শুরু ৳২০.০০')
    expect(within(color).getByRole('radio', { name: 'সবুজ (বিক্রি শেষ)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'কার্টে যোগ করুন' }))
    expect(color).toHaveAccessibleDescription('রং বেছে নিন।')
    expect(screen.getByRole('group', { name: 'সাইজ' })).toHaveAccessibleDescription('সাইজ বেছে নিন।')
    await user.click(within(color).getByRole('radio', { name: 'নীল' }))
    expect(screen.getByRole('group', { name: 'রং: নীল' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'M' }))
    // The same parameters as the English page (the API's codes), so a shared link works in both languages.
    expect(window.location.search).toBe('?color=blue&size=m')
    expectNoEnglish(document.body, { allow: ['SHIRT', 'BLUE', 'BDT'] }) // the SKU stays in Latin letters
    view.unmount()

    // An English link opened in Bangla pre-selects that choice.
    const shared = renderShirt('?color=blue&size=s')
    expect(await screen.findByRole('radio', { name: 'নীল' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'S' })).toBeChecked()
    expect(screen.getByRole('group', { name: 'রং: নীল' })).toBeInTheDocument()
    shared.unmount()

    renderWithProviders(
      <ProductCard product={normalizeProduct({ ...BN_SHIRT, price_range: { min: '20.00', max: '24.00' }, swatches: [{ value_id: 21, value: 'লাল', swatch: '#CC0000', image_url: null }] })} onAddToCart={vi.fn()} />,
    )
    expect(screen.getByText('১টি রং')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'অক্সফোর্ড শার্ট-এর অপশন বেছে নিন' })).toBeInTheDocument()
    expect(screen.getByText('শুরু').parentElement).toHaveTextContent('শুরু ৳২০.০০')
  })
})
