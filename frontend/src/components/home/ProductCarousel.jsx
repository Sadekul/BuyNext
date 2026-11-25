import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import SectionHeading from '../common/SectionHeading'
import ProductCard from '../product/ProductCard'
import ProductGridSkeleton from '../product/ProductGridSkeleton'
import { cn } from '../../utils/classNames'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import './ProductCarousel.css'

const KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
// A pixel or two of rounding (zoom, sub-pixel widths) still counts as "at the end".
const EDGE = 4

/**
 * A row of product cards that scrolls sideways (scroll-snap), for the home
 * page's New arrivals and Featured products.
 *
 *   section (named by its h2)
 *     buttons "<title>: previous" / "<title>: next"  (aria-controls the list; disabled at either end)
 *     ul  one li per ProductCard
 *
 * Keyboard: Tab reaches every card as usual; Left / Right (Home / End) on a
 * card move to the previous / next (first / last) card, which the browser
 * scrolls into view. With prefers-reduced-motion the buttons jump instead of
 * gliding.
 */
function ProductCarousel({ eyebrow, title, description, products, isLoading = false, viewAllTo, onAddToCart, muted = false }) {
  const { t } = useTranslation('marketing')
  const headingId = useId()
  const listId = useId()
  const trackRef = useRef(null)
  const reducedMotion = useReducedMotion()
  const [edges, setEdges] = useState({ start: true, end: true })

  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const scrolled = Math.abs(track.scrollLeft) // negative in right-to-left layouts
    setEdges({ start: scrolled <= EDGE, end: scrolled + track.clientWidth >= track.scrollWidth - EDGE })
  }, [])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    measure()
    track.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(track)
    return () => {
      track.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [measure, products.length, isLoading])

  if (!isLoading && products.length === 0) return null

  const scrollByPage = (direction) => {
    const track = trackRef.current
    if (!track) return
    const rtl = getComputedStyle(track).direction === 'rtl'
    track.scrollBy?.({ left: direction * (rtl ? -1 : 1) * track.clientWidth * 0.9, behavior: reducedMotion ? 'auto' : 'smooth' })
  }

  const onKeyDown = (event) => {
    if (!KEYS.includes(event.key) || event.target.closest('input, select, textarea')) return
    const items = [...event.currentTarget.children]
    const current = items.findIndex((item) => item.contains(event.target))
    if (current < 0) return
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, current + (forward ? 1 : -1)))
    if (next === current) return
    event.preventDefault()
    // The card's link (its photo / name) first; a button only for a card without one.
    const target = items[next].querySelector('a[href]') ?? items[next].querySelector('button:not(:disabled)')
    target?.focus()
  }

  return (
    <section className={cn('section', 'home-section', 'home-carousel', muted && 'section--muted')} aria-labelledby={headingId}>
      <div className="container">
        <div className="home-carousel__head">
          <SectionHeading id={headingId} eyebrow={eyebrow} title={title} description={description} viewAllTo={viewAllTo} />
          {!isLoading && (
            <div className="home-carousel__nav">
              <button
                type="button"
                className="home-carousel__button"
                onClick={() => scrollByPage(-1)}
                disabled={edges.start}
                aria-controls={listId}
                aria-label={t('home.carousel.previous', { title })}
              >
                <LuChevronLeft aria-hidden="true" />
              </button>
              <button
                type="button"
                className="home-carousel__button"
                onClick={() => scrollByPage(1)}
                disabled={edges.end}
                aria-controls={listId}
                aria-label={t('home.carousel.next', { title })}
              >
                <LuChevronRight aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        {isLoading ? (
          <ProductGridSkeleton count={4} />
        ) : (
          <ul id={listId} ref={trackRef} className="home-carousel__track" onKeyDown={onKeyDown}>
            {products.map((product) => (
              <li key={product.id} className="home-carousel__item">
                <ProductCard product={product} onAddToCart={onAddToCart} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export default ProductCarousel
