import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HeroRow from './HeroRow'
import FeaturedCategories from './FeaturedCategories'
import TopProductsTabs from './TopProductsTabs'
import CompactProductList from './CompactProductList'
import ProductLists from './ProductLists'
import CouponBanner from './CouponBanner'
import { renderWithProviders } from '../../test/renderWithProviders'
import { mockFetch } from '../../test/mockFetch'
import { productById, productListResponse } from '../../test/fixtures'
import { switchToBangla } from '../../test/i18n'
import { HOME_RANKINGS, availableRankings } from '../../utils/homeSections'

// Phase 17: the marketplace-style home page's new sections (docs/backend/PHASE17_CONTRACT.md §4).
const PRODUCTS = [123, 78, 100, 173, 90, 7].map(productById)
const ALL_RANKINGS = availableRankings({ bestSelling: true, newest: true })
const DEMO_RANKINGS = availableRankings()
const banner = (id) => ({ id, eyebrow: '', title: `Banner ${id}`, description: '', cta: null, image: null, imageAlt: '', tone: 'navy' })

/** DummyJSON (the unit tests' catalog): answers by sort, and records what was asked. */
function catalogBySort(lists) {
  return mockFetch({
    'GET /products': (url) => {
      const list = lists[url.searchParams.get('sortBy')]
      return list instanceof Error ? { status: 500, body: { message: list.message } } : { body: productListResponse(list ?? []) }
    },
  })
}
const askedSorts = (fetchMock) => fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('sortBy'))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HeroRow', () => {
  it('puts up to two compact banners beside the hero, each an h2 in the "Top offers" region', () => {
    renderWithProviders(<HeroRow hero={<h1>Hero</h1>} banners={[banner(1), banner(2)]} />)
    const offers = screen.getByRole('region', { name: 'Top offers' })
    const tiles = within(offers).getAllByRole('article')
    expect(tiles).toHaveLength(2)
    expect(tiles[0]).toHaveClass('promo-banner--compact')
    expect(within(offers).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Banner 1', 'Banner 2'])
    expect(screen.getByRole('heading', { level: 1, name: 'Hero' }).closest('.home-hero-row__main')).not.toBeNull()
  })

  it('shows the hero alone, as before, without banners', () => {
    const { container } = renderWithProviders(<HeroRow hero={<h1>Hero</h1>} banners={[]} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Hero' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Top offers' })).not.toBeInTheDocument()
    expect(container.querySelector('.home-hero-row')).toBeNull()
  })
})

describe('FeaturedCategories (category icon row)', () => {
  it('shows the photo when there is one and the category icon otherwise, each tile one link', () => {
    renderWithProviders(<FeaturedCategories categories={[{ slug: 'laptops', name: 'Laptops', image: 'l.webp' }, { slug: 'books', name: 'Books', image: null }]} />)
    const section = screen.getByRole('region', { name: 'Shop by category' })
    const laptops = within(section).getByRole('link', { name: 'Laptops' })
    expect(laptops.querySelector('img')).toHaveAttribute('alt', '')
    const books = within(section).getByRole('link', { name: 'Books' })
    expect(books).toHaveAttribute('href', '/categories/books')
    expect(books.querySelector('img')).toBeNull()
    expect(books.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('TopProductsTabs', () => {
  it('is a WAI-ARIA tab set: one tab per ranking, the first selected, its panel labelled by it', async () => {
    catalogBySort({ rating: PRODUCTS, discountPercentage: PRODUCTS.slice(0, 2) })
    renderWithProviders(<TopProductsTabs rankings={ALL_RANKINGS} />)
    const section = screen.getByRole('region', { name: 'Top products' })
    const tablist = within(section).getByRole('tablist', { name: 'Top products' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Best selling', 'Trending', 'New arrivals', 'On sale'])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]) // roving tabindex
    const panel = screen.getByRole('tabpanel', { name: 'Best selling' })
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
    // Every tab controls a panel that exists (hidden until selected).
    for (const tab of tabs) expect(document.getElementById(tab.getAttribute('aria-controls'))).toHaveAttribute('role', 'tabpanel')
    expect(within(panel).getByText('Most units sold in the last 90 days.')).toBeInTheDocument()
  })

  it('moves and selects with Left / Right (wrapping), Home and End, and loads each tab when first shown', async () => {
    const fetchMock = catalogBySort({ rating: PRODUCTS, discountPercentage: PRODUCTS.slice(0, 2) })
    renderWithProviders(<TopProductsTabs rankings={DEMO_RANKINGS} />)
    const [trending, onSale] = screen.getAllByRole('tab')
    expect(await within(screen.getByRole('tabpanel', { name: 'Trending' })).findAllByRole('article')).toHaveLength(6)
    expect(askedSorts(fetchMock)).toEqual(['rating']) // only the shown tab so far

    trending.focus()
    fireEvent.keyDown(trending, { key: 'ArrowRight' })
    expect(onSale).toHaveFocus()
    expect(onSale).toHaveAttribute('aria-selected', 'true')
    expect(onSale.tabIndex).toBe(0)
    expect(trending.tabIndex).toBe(-1)
    const salePanel = screen.getByRole('tabpanel', { name: 'On sale' })
    expect(await within(salePanel).findAllByRole('article')).toHaveLength(2)
    expect(askedSorts(fetchMock)).toEqual(['rating', 'discountPercentage'])
    expect(document.getElementById(trending.getAttribute('aria-controls'))).not.toBeVisible()

    fireEvent.keyDown(onSale, { key: 'ArrowRight' }) // wraps to the first
    expect(trending).toHaveFocus()
    fireEvent.keyDown(trending, { key: 'ArrowLeft' }) // wraps to the last
    expect(onSale).toHaveFocus()
    fireEvent.keyDown(onSale, { key: 'Home' })
    expect(trending).toHaveFocus()
    fireEvent.keyDown(trending, { key: 'End' })
    expect(onSale).toHaveFocus()
    expect(askedSorts(fetchMock)).toEqual(['rating', 'discountPercentage']) // cached: no second request
  })

  it('selects a tab on click, and its "View all" opens the catalog with the matching sort', async () => {
    catalogBySort({ rating: PRODUCTS, discountPercentage: PRODUCTS })
    const user = userEvent.setup()
    renderWithProviders(<TopProductsTabs rankings={DEMO_RANKINGS} />)
    const trendingPanel = screen.getByRole('tabpanel', { name: 'Trending' })
    expect(within(trendingPanel).getByRole('link', { name: 'View all: Trending' })).toHaveAttribute('href', '/products?sort=rating-desc')
    await user.click(screen.getByRole('tab', { name: 'On sale' }))
    const salePanel = screen.getByRole('tabpanel', { name: 'On sale' })
    expect(within(salePanel).getByRole('link', { name: 'View all: On sale' })).toHaveAttribute('href', '/products?sort=discount-desc')
  })

  it('"On sale" keeps real discounts only, says so when there are none, and offers a retry on errors', async () => {
    const noDiscount = { ...productById(123), discountPercentage: 0.4 }
    catalogBySort({ rating: new Error('Server down'), discountPercentage: [noDiscount] })
    const user = userEvent.setup()
    renderWithProviders(<TopProductsTabs rankings={DEMO_RANKINGS} />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { level: 3 })).toHaveTextContent("We couldn't load these products")
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'On sale' }))
    expect(await screen.findByText('Nothing to show here yet.')).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('renders nothing without rankings, and speaks Bangla with Bangla digits', async () => {
    const { unmount } = renderWithProviders(<TopProductsTabs rankings={[]} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    unmount()
    catalogBySort({ bestSelling: PRODUCTS })
    await switchToBangla()
    renderWithProviders(<TopProductsTabs rankings={ALL_RANKINGS} />)
    expect(screen.getByRole('tablist', { name: 'সেরা পণ্য' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'সর্বাধিক বিক্রিত' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('গত ৯০ দিনে সবচেয়ে বেশি বিক্রি হওয়া পণ্য।')).toBeInTheDocument()
  })
})

describe('CompactProductList', () => {
  it('shows four rows: a link named by the product, its rating, and sale + original price', () => {
    const iphone = productById(123) // $1099.99, 9.37% off
    renderWithProviders(<CompactProductList title="Top rated" products={[iphone, ...PRODUCTS.slice(1)]} viewAllTo="/products?sort=rating-desc" />)
    const list = screen.getByRole('region', { name: 'Top rated' })
    expect(within(list).getByRole('heading', { level: 3, name: 'Top rated' })).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: 'View all: Top rated' })).toHaveAttribute('href', '/products?sort=rating-desc')
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(within(rows[0]).getByRole('link', { name: iphone.title })).toHaveAttribute('href', '/products/123')
    expect(within(rows[0]).getByRole('img', { name: /Rated 4\.\d out of 5/ })).toBeInTheDocument()
    expect(rows[0].querySelector('img[alt=""]')).not.toBeNull() // the thumbnail is decorative
    expect(rows[0]).toHaveTextContent('Sale price:$996.92Original price:$1,099.99')
    expect(rows[0].querySelector('s')).toHaveTextContent('$1,099.99')
  })

  it('shows a regular price without a strike, placeholders while loading, and nothing when empty', () => {
    const plain = { ...productById(78), discountPercentage: 0 }
    const { unmount } = renderWithProviders(<CompactProductList title="New" products={[plain]} />)
    const row = screen.getByRole('listitem')
    expect(row.querySelector('s')).toBeNull()
    expect(row).toHaveTextContent('Price:$1,999.99')
    unmount()
    const loading = renderWithProviders(<CompactProductList title="New" products={[]} isLoading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading New…')
    loading.unmount()
    renderWithProviders(<CompactProductList title="New" products={[]} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('uses Bangla digits in Bangla', async () => {
    await switchToBangla()
    renderWithProviders(<CompactProductList title="সেরা রেটিং" products={[productById(123)]} />)
    const row = screen.getByRole('listitem')
    expect(row.textContent).toMatch(/[০-৯]/)
    expect(row.querySelector('.compact-product__price').textContent).not.toMatch(/[0-9]/)
  })
})

describe('ProductLists', () => {
  it('shows the lists in the contract order, reusing the tabs’ requests; Best selling only with real sales', async () => {
    // DummyJSON answers carry no `has_sales` / `units_sold`: no sales, so no Best selling list (never rating order).
    const fetchMock = catalogBySort({ bestSelling: PRODUCTS, rating: PRODUCTS, createdAt: PRODUCTS, discountPercentage: PRODUCTS })
    renderWithProviders(<ProductLists rankings={ALL_RANKINGS} />)
    const section = screen.getByRole('region', { name: 'Product highlights' })
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(12))
    expect(within(section).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Top rated', 'On sale', 'New'])
    expect(within(section).getByRole('link', { name: 'View all: New' })).toHaveAttribute('href', '/products?sort=newest')
    expect(within(section).getByRole('link', { name: 'View all: On sale' })).toHaveAttribute('href', '/products?sort=discount-desc')
    expect(askedSorts(fetchMock).toSorted()).toEqual(['bestSelling', 'createdAt', 'discountPercentage', 'rating'])
  })

  it('leaves out a list that fails or is empty, and the section when none has products (the demo: two lists)', async () => {
    catalogBySort({ rating: PRODUCTS, discountPercentage: new Error('Down') })
    const { unmount } = renderWithProviders(<ProductLists rankings={DEMO_RANKINGS} />)
    const section = screen.getByRole('region', { name: 'Product highlights' })
    await waitFor(() => expect(within(section).getAllByRole('region')).toHaveLength(1))
    expect(within(section).getByRole('region', { name: 'Top rated' })).toBeInTheDocument()
    unmount()
    catalogBySort({ rating: [], discountPercentage: [] })
    renderWithProviders(<ProductLists rankings={DEMO_RANKINGS} />)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Product highlights' })).not.toBeInTheDocument())
  })
})

describe('CouponBanner', () => {
  const TOP_BAR = { message: 'Save 10% on your first order', couponCode: 'WELCOME10' }

  it('is left out without a real coupon', () => {
    const { container, rerender } = renderWithProviders(<CouponBanner topBar={null} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<CouponBanner topBar={{ message: 'Free delivery this week', couponCode: null }} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('shows the admin’s message and the code; Copy puts it on the clipboard and says so', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CouponBanner topBar={TOP_BAR} />)
    const band = screen.getByRole('region', { name: 'Save 10% on your first order' })
    expect(within(band).getByText('WELCOME10')).toBeInTheDocument()
    expect(within(band).getByRole('status')).toBeEmptyDOMElement()
    const copy = within(band).getByRole('button', { name: 'Copy coupon code WELCOME10' })
    expect(copy).toHaveTextContent('Copy')
    await user.click(copy)
    expect(within(band).getByRole('status')).toHaveTextContent('Copied WELCOME10. Enter it at checkout.')
    expect(await navigator.clipboard.readText()).toBe('WELCOME10')
    expect(band).not.toHaveTextContent(/ends in|hours?|minutes?|\d+:\d\d/i) // no fake urgency
  })

  it('selects the code for copying by hand when the clipboard is refused', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CouponBanner topBar={TOP_BAR} />)
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.click(screen.getByRole('button', { name: 'Copy coupon code WELCOME10' }))
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't copy. Select the code and copy it yourself.")
    expect(window.getSelection().toString()).toBe('WELCOME10')
    writeText.mockRestore()
  })

  it('is in Bangla in Bangla (the message is the admin’s own text)', async () => {
    await switchToBangla()
    renderWithProviders(<CouponBanner topBar={{ message: 'প্রথম অর্ডারে ১০% ছাড়', couponCode: 'WELCOME10' }} />)
    expect(screen.getByRole('button', { name: 'কুপন কোড WELCOME10 কপি করুন' })).toHaveTextContent('কপি')
    expect(screen.getByText('চেকআউটে এই কোডটি লিখুন।')).toBeInTheDocument()
  })
})

describe('HOME_RANKINGS', () => {
  it('maps each ranking to an API sort', () => {
    expect(HOME_RANKINGS.map(({ id, sortBy }) => [id, sortBy])).toEqual([
      ['best-selling', 'bestSelling'],
      ['trending', 'rating'],
      ['new', 'createdAt'],
      ['on-sale', 'discountPercentage'],
    ])
  })
})
