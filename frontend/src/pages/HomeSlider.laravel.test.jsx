import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import HomePage from './HomePage'
import { renderWithProviders } from '../test/renderWithProviders'
import { mockFetch } from '../test/mockFetch'
import { normalizeHome } from '../services/adapters/contentAdapter'

// Home page: single banner or slider (docs/backend/HOME_SLIDER_CONTRACT.md), with BuyNest's API.
vi.mock('../constants/shop', () => ({ REAL_SHOP: true }))
vi.mock('../constants/accounts', () => ({ ACCOUNTS_BACKEND: 'laravel', REAL_ACCOUNTS: true, DEMO_ACCOUNT: null }))

const HERO = { eyebrow: 'Winter edit', title: 'Cosy up your nest.', description: 'Warm lights.', primary_cta: { label: 'Shop winter', url: '/categories/furniture' }, secondary_cta: null, image_url: 'https://img.test/hero.webp', image_alt: 'A lamp', highlights: [] }
const SLIDE = (changes) => ({ id: 'slide-a', eyebrow: 'New', title: 'Slide A', description: 'A.', primary_cta: { label: 'Shop A', url: '/products' }, secondary_cta: null, image_url: 'https://img.test/a.webp', image_alt: 'A', tone: 'emerald', position: 0, ...changes })
const SLIDES = [SLIDE({ id: 'slide-b', title: 'Slide B', position: 1, tone: 'amber' }), SLIDE()]
const home = (changes) => ({ body: { data: { hero: HERO, banners: [], featured_products: [], ...changes } } })
const CATALOG = {
  'GET /products': { body: { products: [], total: 0, skip: 0, limit: 0 } },
  'GET /products/categories': { body: [] },
}

describe('home page: banner or slider', () => {
  it('shows the slider when the admin chose it', async () => {
    mockFetch({ ...CATALOG, 'GET /api/catalog/home': home({ hero_mode: 'slider', slides: SLIDES, slider: { autoplay: false, interval_seconds: 8 } }) })
    renderWithProviders(<HomePage />)

    const carousel = await screen.findByRole('region', { name: 'Featured' })
    expect(carousel).toHaveAttribute('aria-roledescription', 'carousel')
    expect(screen.getByRole('heading', { level: 1, name: 'BuyNest' })).toBeInTheDocument() // the page keeps one h1
    const shown = within(carousel).getByRole('group', { name: '1 of 2' })
    expect(within(shown).getByRole('heading', { level: 2, name: 'Slide A' })).toBeInTheDocument() // ordered by position
    expect(within(shown).getByRole('link', { name: 'Shop A' })).toHaveAttribute('href', '/products')
    expect(screen.queryByRole('button', { name: 'Pause slides' })).not.toBeInTheDocument() // autoplay off
    expect(screen.queryByRole('heading', { name: 'Cosy up your nest.' })).not.toBeInTheDocument()
  })

  it('keeps the single banner in banner mode, even with slides stored', async () => {
    mockFetch({ ...CATALOG, 'GET /api/catalog/home': home({ hero_mode: 'banner', slides: SLIDES, slider: { autoplay: true, interval_seconds: 6 } }) })
    renderWithProviders(<HomePage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Cosy up your nest.' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Featured' })).not.toBeInTheDocument()
  })

  it('shows the single banner for an older answer without the slider keys', async () => {
    mockFetch({ ...CATALOG, 'GET /api/catalog/home': home() })
    renderWithProviders(<HomePage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Cosy up your nest.' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Featured' })).not.toBeInTheDocument()
  })

  it('never shows an empty slider', async () => {
    mockFetch({ ...CATALOG, 'GET /api/catalog/home': home({ hero_mode: 'slider', slides: [] }) })
    renderWithProviders(<HomePage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Cosy up your nest.' })).toBeInTheDocument()
  })
})

describe('normalizeHome slider fields', () => {
  it('maps hero_mode, slides and slider to camelCase', () => {
    const home = normalizeHome({
      data: {
        hero: HERO,
        hero_mode: 'slider',
        slides: [
          SLIDE({ id: 'b', position: 2, tone: 'purple', secondary_cta: { label: 'Bad', url: 'javascript:alert(1)' } }),
          SLIDE({ id: 'a', position: 1, primary_cta: { label: 'Go', url: 'https://shop.test/x' }, secondary_cta: { label: 'More', url: '/deals' }, image_url: '', image_alt: null }),
          SLIDE({ id: 'off', is_active: false }),
        ],
        slider: { autoplay: false, interval_seconds: 9 },
      },
    })
    expect(home.heroMode).toBe('slider')
    expect(home.slider).toEqual({ autoplay: false, intervalSeconds: 9 })
    expect(home.slides).toEqual([
      { id: 'a', eyebrow: 'New', title: 'Slide A', description: 'A.', primaryCta: { label: 'Go', to: 'https://shop.test/x' }, secondaryCta: { label: 'More', to: '/deals' }, image: null, imageAlt: '', tone: 'emerald' },
      { id: 'b', eyebrow: 'New', title: 'Slide A', description: 'A.', primaryCta: { label: 'Shop A', to: '/products' }, secondaryCta: null, image: 'https://img.test/a.webp', imageAlt: 'A', tone: 'navy' },
    ])
  })

  it('defaults to banner mode with the default slider settings when the keys are missing or bad', () => {
    expect(normalizeHome({ data: { hero: HERO } })).toMatchObject({ heroMode: 'banner', slides: [], slider: { autoplay: true, intervalSeconds: 6 } })
    expect(normalizeHome({ data: { hero_mode: 'slider', slides: [] } }).heroMode).toBe('banner')
    expect(normalizeHome({ data: { hero_mode: 'carousel', slides: [SLIDE()] } }).heroMode).toBe('banner')
    expect(normalizeHome({ data: { slider: { autoplay: 'yes', interval_seconds: 99 } } }).slider).toEqual({ autoplay: true, intervalSeconds: 15 })
    expect(normalizeHome({ data: { slider: { interval_seconds: 1 } } }).slider.intervalSeconds).toBe(3)
  })
})
