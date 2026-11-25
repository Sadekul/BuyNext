import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import ProductCarousel from './ProductCarousel'
import DealsBand from './DealsBand'
import FeaturedCategories from './FeaturedCategories'
import BrandStrip from './BrandStrip'
import PromoGrid from './PromoGrid'
import { renderWithProviders } from '../../test/renderWithProviders'
import { productById } from '../../test/fixtures'
import { switchToBangla } from '../../test/i18n'

// The redesigned home page's sections (docs/STOREFRONT_REDESIGN.md, "Home page").
const PRODUCTS = [123, 78, 100, 173, 90].map(productById)

/** jsdom has no layout: give the carousel's list a size and a scroll position. */
function layout(list, { scrollLeft, clientWidth = 600, scrollWidth = 1500 }) {
  Object.defineProperty(list, 'clientWidth', { configurable: true, value: clientWidth })
  Object.defineProperty(list, 'scrollWidth', { configurable: true, value: scrollWidth })
  list.scrollLeft = scrollLeft
  fireEvent.scroll(list)
}

describe('ProductCarousel', () => {
  it('is a section named by its heading, with Previous / Next buttons that scroll the list and stop at the ends', () => {
    renderWithProviders(<ProductCarousel eyebrow="Just landed" title="New arrivals" products={PRODUCTS} viewAllTo="/products" />)
    const section = screen.getByRole('region', { name: 'New arrivals' })
    const list = within(section).getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    const previous = within(section).getByRole('button', { name: 'New arrivals: previous' })
    const next = within(section).getByRole('button', { name: 'New arrivals: next' })
    expect(previous).toHaveAttribute('aria-controls', list.id)
    expect(next).toHaveAttribute('aria-controls', list.id)

    list.scrollBy = vi.fn()
    layout(list, { scrollLeft: 0 })
    expect(previous).toBeDisabled() // at the start
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(list.scrollBy).toHaveBeenCalledWith({ left: 540, behavior: 'smooth' })

    layout(list, { scrollLeft: 900 })
    expect(next).toBeDisabled() // at the end
    fireEvent.click(previous)
    expect(list.scrollBy).toHaveBeenLastCalledWith({ left: -540, behavior: 'smooth' })
  })

  it('jumps instead of gliding with prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (query) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }))
    renderWithProviders(<ProductCarousel title="New arrivals" products={PRODUCTS} />)
    const list = screen.getByRole('list')
    list.scrollBy = vi.fn()
    layout(list, { scrollLeft: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'New arrivals: next' }))
    expect(list.scrollBy).toHaveBeenCalledWith({ left: 540, behavior: 'auto' })
    vi.unstubAllGlobals()
  })

  it('moves between cards with the arrow keys, Home and End', () => {
    renderWithProviders(<ProductCarousel title="New arrivals" products={PRODUCTS} />)
    const firstLinks = screen.getAllByRole('listitem').map((item) => within(item).getAllByRole('link')[0])
    firstLinks[0].focus()
    fireEvent.keyDown(firstLinks[0], { key: 'ArrowRight' })
    expect(firstLinks[1]).toHaveFocus()
    fireEvent.keyDown(firstLinks[1], { key: 'End' })
    expect(firstLinks[4]).toHaveFocus()
    fireEvent.keyDown(firstLinks[4], { key: 'ArrowRight' }) // already the last one: stays
    expect(firstLinks[4]).toHaveFocus()
    fireEvent.keyDown(firstLinks[4], { key: 'ArrowLeft' })
    expect(firstLinks[3]).toHaveFocus()
    fireEvent.keyDown(firstLinks[3], { key: 'Home' })
    expect(firstLinks[0]).toHaveFocus()
  })

  it('shows placeholders while loading and nothing at all without products', () => {
    const { unmount } = renderWithProviders(<ProductCarousel title="New arrivals" products={[]} isLoading />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New arrivals: / })).not.toBeInTheDocument()
    unmount()
    renderWithProviders(<ProductCarousel title="New arrivals" products={[]} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})

describe('DealsBand', () => {
  it('shows the deals with a real "up to" badge and never a countdown', () => {
    renderWithProviders(<DealsBand deals={PRODUCTS.slice(0, 4)} maxDiscount={19} />)
    const band = screen.getByRole('region', { name: 'Big savings, in stock now' })
    expect(within(band).getByText("Today's deals")).toBeInTheDocument()
    expect(within(band).getAllByRole('article')).toHaveLength(4)
    expect(band).toHaveTextContent('Up to19%off')
    expect(within(band).getByRole('link', { name: /All deals/ })).toHaveAttribute('href', '/deals')
    expect(band).not.toHaveTextContent(/ends in|hours?|minutes?|\d+:\d\d/i) // no fake urgency
    expect(band.querySelector('[role="timer"], time')).toBeNull()
  })

  it('is left out without deals, and the badge uses Bangla digits in Bangla', async () => {
    const { unmount } = renderWithProviders(<DealsBand deals={[]} maxDiscount={0} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    unmount()
    await switchToBangla()
    renderWithProviders(<DealsBand deals={PRODUCTS.slice(0, 1)} maxDiscount={19} />)
    expect(screen.getByRole('region', { name: 'বড় ছাড়, এখনই স্টকে' })).toHaveTextContent('সর্বোচ্চ১৯%ছাড়')
  })
})

describe('FeaturedCategories', () => {
  it('shows a photo tile per category, each one link named by the category', () => {
    renderWithProviders(<FeaturedCategories categories={[{ slug: 'laptops', name: 'Laptops', image: 'l.webp' }, { slug: 'beauty', name: 'Beauty', image: 'b.webp' }]} />)
    const section = screen.getByRole('region', { name: 'Shop by category' })
    expect(within(section).getByRole('link', { name: 'Laptops' })).toHaveAttribute('href', '/categories/laptops')
    expect(within(section).getByRole('link', { name: 'Beauty' }).querySelector('img')).toHaveAttribute('alt', '')
    expect(within(section).getByRole('link', { name: 'All products' })).toHaveAttribute('href', '/products')
  })

  it('is left out when no category has a photo', () => {
    renderWithProviders(<FeaturedCategories categories={[]} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})

describe('BrandStrip', () => {
  it('links each brand to the catalog brand filter, naming the product count', () => {
    renderWithProviders(<BrandStrip brands={[{ name: 'Apple', count: 12, to: '/products?brand=Apple' }, { name: 'Nest', count: 1, to: '/products?brand=Nest' }]} />)
    const strip = screen.getByRole('region', { name: 'Shop by brand' })
    expect(within(strip).getByRole('link', { name: 'Apple, 12 products' })).toHaveAttribute('href', '/products?brand=Apple')
    expect(within(strip).getByRole('link', { name: 'Nest, 1 product' })).toBeInTheDocument()
  })
})

describe('PromoGrid', () => {
  const banner = (id, tone) => ({ id, eyebrow: '', title: `Banner ${id}`, description: '', cta: null, image: null, imageAlt: '', tone })

  it('keeps the banners in order, the first one large, with the stored tone keys mapped to the new tones', () => {
    renderWithProviders(<PromoGrid banners={[banner(1, 'navy'), banner(2, 'amber'), banner(3, 'rose')]} />)
    const promotions = screen.getByRole('region', { name: 'Promotions' })
    const tiles = within(promotions).getAllByRole('article')
    expect(tiles.map((tile) => tile.textContent)).toEqual(['Banner 1', 'Banner 2', 'Banner 3'])
    expect(tiles[0]).toHaveClass('promo-banner--large', 'tone--navy')
    expect(tiles[1]).toHaveClass('tone--amber')
    expect(tiles[1]).not.toHaveClass('promo-banner--large')
  })

  it('renders nothing without banners', () => {
    renderWithProviders(<PromoGrid banners={[]} />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
