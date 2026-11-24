import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import HeroSlider from './HeroSlider'
import { switchToBangla } from '../../test/i18n'

// Home slider (docs/backend/HOME_SLIDER_CONTRACT.md, sections 3 and 5): the WAI-ARIA carousel.
const SLIDES = [
  { id: 'new-season', eyebrow: 'New season', title: 'Everything you love', description: 'Fresh picks.', primaryCta: { label: 'Shop now', to: '/products' }, secondaryCta: { label: 'Explore deals', to: '/deals' }, image: 'https://img.test/1.webp', imageAlt: 'Headphones', tone: 'navy' },
  { id: 'laptops', eyebrow: 'Laptops', title: 'Work from anywhere', description: 'Thin and light.', primaryCta: { label: 'Shop laptops', to: '/categories/laptops' }, secondaryCta: null, image: 'https://img.test/2.webp', imageAlt: 'A laptop', tone: 'emerald' },
  { id: 'scents', eyebrow: '', title: 'Find your scent', description: '', primaryCta: null, secondaryCta: null, image: null, imageAlt: '', tone: 'rose' },
]

const renderSlider = (props = {}) =>
  render(
    <MemoryRouter>
      <HeroSlider slides={SLIDES} settings={{ autoplay: true, intervalSeconds: 5 }} heading="BuyNest" {...props} />
      <button type="button">Outside</button>
    </MemoryRouter>,
  )

const carousel = () => screen.getByRole('region') // the only region; its name is checked per language below
const slides = () => within(carousel()).getAllByRole('group').filter((group) => group.hasAttribute('aria-roledescription'))
const shownSlide = () => slides().find((slide) => !slide.hasAttribute('inert'))
const slidesArea = () => document.getElementById('hero-slider-slides')

function stubReducedMotion(matches) {
  vi.stubGlobal('matchMedia', (query) => ({ matches: matches && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }))
}

beforeEach(() => stubReducedMotion(false))
afterEach(() => vi.useRealTimers())

describe('HeroSlider', () => {
  it('is a labelled carousel of labelled slides, with only the shown one reachable', () => {
    renderSlider()
    expect(screen.getByRole('region', { name: 'Featured' })).toBe(carousel())
    expect(carousel()).toHaveAttribute('aria-roledescription', 'carousel')
    expect(screen.getByRole('heading', { level: 1, name: 'BuyNest' })).toBeInTheDocument()
    expect(slides().map((slide) => slide.getAttribute('aria-label'))).toEqual(['1 of 3', '2 of 3', '3 of 3'])
    expect(slides()[0]).toHaveAttribute('aria-roledescription', 'slide')
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
    expect(slides()[1]).toHaveAttribute('inert')
    expect(slides()[2]).toHaveAttribute('inert')
    expect(within(shownSlide()).getByRole('heading', { level: 2, name: 'Everything you love' })).toBeInTheDocument()
    expect(within(shownSlide()).getByRole('link', { name: 'Shop now' })).toHaveAttribute('href', '/products')
  })

  it('loads the first image at once with high priority and the others lazily', () => {
    renderSlider()
    const first = screen.getByAltText('Headphones')
    expect(first).toHaveAttribute('loading', 'eager')
    expect(first).toHaveAttribute('fetchpriority', 'high')
    const second = screen.getByAltText('A laptop')
    expect(second).toHaveAttribute('loading', 'lazy')
    expect(second).not.toHaveAttribute('fetchpriority')
  })

  it('changes slides with Previous, Next and the dots (wrapping around), marking the current dot', () => {
    renderSlider()
    const next = screen.getByRole('button', { name: 'Next slide' })
    const previous = screen.getByRole('button', { name: 'Previous slide' })
    const dots = ['Show slide 1', 'Show slide 2', 'Show slide 3'].map((name) => screen.getByRole('button', { name }))
    expect(dots[0]).toHaveAttribute('aria-current', 'true')

    fireEvent.click(next)
    expect(shownSlide()).toHaveAttribute('aria-label', '2 of 3')
    expect(dots[1]).toHaveAttribute('aria-current', 'true')
    expect(dots[0]).not.toHaveAttribute('aria-current')

    fireEvent.click(dots[2])
    expect(shownSlide()).toHaveAttribute('aria-label', '3 of 3')
    fireEvent.click(next)
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
    fireEvent.click(previous)
    expect(shownSlide()).toHaveAttribute('aria-label', '3 of 3')
  })

  it('places the controls after the slide content in the tab order', () => {
    renderSlider()
    const focusables = [...carousel().querySelectorAll('a, button')].filter((element) => !element.closest('[inert]'))
    expect(focusables.map((element) => element.textContent || element.getAttribute('aria-label'))).toEqual([
      'Shop now',
      'Explore deals',
      'Show slide 1',
      'Show slide 2',
      'Show slide 3',
      'Pause slides',
      'Previous slide',
      'Next slide',
    ])
  })

  it('changes slides with the Left and Right arrows on the controls; focus follows on the dots', () => {
    renderSlider()
    const next = screen.getByRole('button', { name: 'Next slide' })
    fireEvent.keyDown(next, { key: 'ArrowRight' })
    expect(shownSlide()).toHaveAttribute('aria-label', '2 of 3')
    fireEvent.keyDown(next, { key: 'ArrowLeft' })
    fireEvent.keyDown(next, { key: 'ArrowLeft' })
    expect(shownSlide()).toHaveAttribute('aria-label', '3 of 3')

    const dot = screen.getByRole('button', { name: 'Show slide 3' })
    dot.focus()
    fireEvent.keyDown(dot, { key: 'ArrowRight' })
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
    expect(screen.getByRole('button', { name: 'Show slide 1' })).toHaveFocus()
  })

  it('plays automatically every intervalSeconds, silent for screen readers while it plays; Pause stops it', () => {
    vi.useFakeTimers()
    renderSlider()
    expect(slidesArea()).toHaveAttribute('aria-live', 'off')

    act(() => vi.advanceTimersByTime(4999))
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
    act(() => vi.advanceTimersByTime(1))
    expect(shownSlide()).toHaveAttribute('aria-label', '2 of 3')

    fireEvent.click(screen.getByRole('button', { name: 'Pause slides' }))
    expect(slidesArea()).toHaveAttribute('aria-live', 'polite')
    act(() => vi.advanceTimersByTime(20000))
    expect(shownSlide()).toHaveAttribute('aria-label', '2 of 3')

    fireEvent.click(screen.getByRole('button', { name: 'Play slides' }))
    expect(slidesArea()).toHaveAttribute('aria-live', 'off')
    act(() => vi.advanceTimersByTime(5000))
    expect(shownSlide()).toHaveAttribute('aria-label', '3 of 3')
  })

  it('pauses while the pointer is over it', () => {
    vi.useFakeTimers()
    renderSlider()
    fireEvent.mouseEnter(carousel())
    expect(slidesArea()).toHaveAttribute('aria-live', 'polite')
    act(() => vi.advanceTimersByTime(15000))
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')

    fireEvent.mouseLeave(carousel())
    expect(slidesArea()).toHaveAttribute('aria-live', 'off')
    act(() => vi.advanceTimersByTime(5000))
    expect(shownSlide()).toHaveAttribute('aria-label', '2 of 3')
  })

  it('pauses while keyboard focus is inside it, and plays again when focus leaves', () => {
    vi.useFakeTimers()
    renderSlider()
    act(() => screen.getByRole('link', { name: 'Shop now' }).focus())
    expect(slidesArea()).toHaveAttribute('aria-live', 'polite')
    act(() => screen.getByRole('button', { name: 'Next slide' }).focus()) // moving inside keeps it paused
    act(() => vi.advanceTimersByTime(15000))
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
    expect(screen.getByRole('button', { name: 'Pause slides' })).toBeInTheDocument() // the visitor's choice is unchanged

    act(() => screen.getByRole('button', { name: 'Outside' }).focus())
    expect(slidesArea()).toHaveAttribute('aria-live', 'off')
    act(() => vi.advanceTimersByTime(5000))
    expect(shownSlide()).toHaveAttribute('aria-label', '2 of 3')
  })

  it('never plays by itself with prefers-reduced-motion: reduce', () => {
    stubReducedMotion(true)
    vi.useFakeTimers()
    renderSlider()
    expect(screen.queryByRole('button', { name: /Pause slides|Play slides/ })).not.toBeInTheDocument()
    expect(slidesArea()).toHaveAttribute('aria-live', 'polite')
    act(() => vi.advanceTimersByTime(30000))
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' })) // still usable by hand
    expect(shownSlide()).toHaveAttribute('aria-label', '2 of 3')
  })

  it('has no Pause / Play button and stays put when the admin turned autoplay off', () => {
    vi.useFakeTimers()
    renderSlider({ settings: { autoplay: false, intervalSeconds: 5 } })
    expect(screen.queryByRole('button', { name: /Pause slides|Play slides/ })).not.toBeInTheDocument()
    expect(slidesArea()).toHaveAttribute('aria-live', 'polite')
    act(() => vi.advanceTimersByTime(30000))
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
  })

  it('shows one slide without any controls or autoplay', () => {
    vi.useFakeTimers()
    renderSlider({ slides: [SLIDES[1]] })
    expect(slides()).toHaveLength(1)
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 1')
    expect(within(carousel()).queryAllByRole('button')).toHaveLength(0)
    expect(slidesArea()).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByAltText('A laptop')).toHaveAttribute('loading', 'eager')
  })

  it('follows a swipe on touch screens', () => {
    renderSlider()
    const area = slidesArea()
    fireEvent.touchStart(area, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 150, clientY: 110 }] })
    expect(shownSlide()).toHaveAttribute('aria-label', '2 of 3')
    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 260, clientY: 100 }] })
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
    // A mostly vertical move (scrolling the page) is not a swipe.
    fireEvent.touchStart(area, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(area, { changedTouches: [{ clientX: 220, clientY: 400 }] })
    expect(shownSlide()).toHaveAttribute('aria-label', '1 of 3')
  })

  it('speaks Bangla with Bangla digits', async () => {
    await switchToBangla()
    renderSlider()
    const region = screen.getByRole('region', { name: 'বিশেষ আকর্ষণ' })
    expect(region).toHaveAttribute('aria-roledescription', 'ক্যারোসেল')
    expect(slides().map((slide) => slide.getAttribute('aria-label'))).toEqual(['৩টির মধ্যে ১', '৩টির মধ্যে ২', '৩টির মধ্যে ৩'])
    expect(slides()[0]).toHaveAttribute('aria-roledescription', 'স্লাইড')
    for (const name of ['আগের স্লাইড', 'পরের স্লাইড', 'স্লাইড থামান', 'স্লাইড ১ দেখান', 'স্লাইড ৩ দেখান']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: 'স্লাইড থামান' }))
    expect(screen.getByRole('button', { name: 'স্লাইড চালান' })).toBeInTheDocument()
  })

  it('writes Latin digits in Bangla when the store turned Bangla digits off', async () => {
    await switchToBangla({ digits: false })
    renderSlider()
    expect(shownSlide()).toHaveAttribute('aria-label', '3টির মধ্যে 1')
    expect(screen.getByRole('button', { name: 'স্লাইড 2 দেখান' })).toBeInTheDocument()
  })
})
