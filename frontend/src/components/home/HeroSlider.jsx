import { useCallback, useEffect, useRef, useState } from 'react'
import { LuArrowRight, LuChevronLeft, LuChevronRight, LuPause, LuPlay } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import { cn } from '../../utils/classNames'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import './HeroBanner.css'
import './HeroSlider.css'
import './tones.css'

/*
 * Home page slider (docs/backend/HOME_SLIDER_CONTRACT.md, section 3), built on
 * the WAI-ARIA "auto-rotating carousel" pattern:
 *
 *   section  aria-roledescription="carousel"  aria-label="Featured"
 *     div    aria-live="off" while rotating, "polite" when stopped
 *       div  role="group" aria-roledescription="slide" aria-label="2 of 3"   (others inert)
 *     div    controls: Pause/Play · Previous · dots ("Show slide 2", aria-current) · Next
 *
 * Rotation pauses while the pointer is over the slider or keyboard focus is
 * inside it, and never starts with prefers-reduced-motion: reduce. All slides
 * sit in the same grid cell, so the slider is as tall as its tallest slide
 * and nothing below it moves when the slide changes.
 */

const SWIPE_DISTANCE = 50

function Slide({ slide, index, total, active }) {
  const { t } = useTranslation('marketing')
  const { eyebrow, title, description, primaryCta, secondaryCta, image, imageAlt, tone } = slide
  const first = index === 0

  return (
    <div
      role="group"
      aria-roledescription={t('home.slider.roleSlide')}
      aria-label={t('home.slider.slideOf', { current: index + 1, total })}
      className={cn('hero-slider__slide', `tone--${tone}`, active && 'hero-slider__slide--active')}
      // Hidden slides: not focusable, not read (inert), and visibility: hidden in CSS.
      inert={!active}
      data-slide-id={slide.id}
    >
      <div className={cn('hero__inner', 'hero-slider__inner', 'container', !image && 'hero-slider__inner--text')}>
        <div className="hero__copy hero-slider__copy">
          {eyebrow && <p className="hero__eyebrow hero-slider__eyebrow">{eyebrow}</p>}
          <h2 className="hero__title hero-slider__title">{title}</h2>
          {description && <p className="hero__description hero-slider__description">{description}</p>}
          {(primaryCta || secondaryCta) && (
            <div className="hero__actions">
              {primaryCta && (
                <Button to={primaryCta.to} size="lg" className="hero__cta">
                  {primaryCta.label}
                  <LuArrowRight aria-hidden="true" />
                </Button>
              )}
              {secondaryCta && (
                <Button to={secondaryCta.to} size="lg" variant="outline" className="hero__cta hero__cta--secondary">
                  {secondaryCta.label}
                </Button>
              )}
            </div>
          )}
        </div>

        {image && (
          <div className="hero-slider__visual">
            <span className="hero-slider__disc" aria-hidden="true" />
            <img
              src={image}
              alt={imageAlt}
              className="hero-slider__image"
              width="560"
              height="560"
              loading={first ? 'eager' : 'lazy'}
              fetchPriority={first ? 'high' : undefined}
              decoding="async"
            />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * `slides`: [{ id, eyebrow, title, description, primaryCta, secondaryCta, image, imageAlt, tone }]
 * `settings`: { autoplay, intervalSeconds }. `heading`: the page's (visually hidden) h1.
 */
function HeroSlider({ slides, settings = {}, heading }) {
  const { t } = useTranslation('marketing')
  const { autoplay = true, intervalSeconds = 6 } = settings
  const reducedMotion = useReducedMotion()
  const total = slides.length
  const several = total > 1
  // Autoplay only with more than one slide and without a reduced-motion preference.
  const canRotate = several && autoplay && !reducedMotion

  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(true) // the visitor's choice (Pause / Play)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const rotating = canRotate && playing && !hovered && !focused

  const sectionRef = useRef(null)
  const dotsRef = useRef(null)
  const touchStart = useRef(null)

  const index = Math.min(current, total - 1)
  const show = useCallback((next) => setCurrent(((next % total) + total) % total), [total])

  // One timer per shown slide: any change (button, dot, swipe) starts a fresh interval.
  useEffect(() => {
    if (!rotating) return undefined
    const timer = window.setTimeout(() => show(index + 1), intervalSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [rotating, index, intervalSeconds, show])

  if (total === 0) return null

  const togglePlaying = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    // "Play" means play now, even with the pointer or focus still on the button.
    setPlaying(true)
    setHovered(false)
    setFocused(false)
  }

  // Left / Right on any control changes the slide; on a dot, focus follows to the new dot.
  const onControlsKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = (((event.key === 'ArrowRight' ? index + 1 : index - 1) % total) + total) % total
    setCurrent(next)
    if (dotsRef.current?.contains(event.target)) dotsRef.current.querySelectorAll('button')[next]?.focus()
  }

  // Pause while focus is inside: set when focus arrives from outside, cleared when it leaves.
  const onFocus = (event) => {
    if (!sectionRef.current?.contains(event.relatedTarget)) setFocused(true)
  }
  const onBlur = (event) => {
    if (!sectionRef.current?.contains(event.relatedTarget)) setFocused(false)
  }

  const onTouchStart = (event) => {
    const touch = event.touches[0]
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onTouchEnd = (event) => {
    const start = touchStart.current
    const touch = event.changedTouches[0]
    touchStart.current = null
    if (!start || !touch || !several) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy)) return
    show(dx < 0 ? index + 1 : index - 1)
  }

  return (
    <section
      ref={sectionRef}
      className="hero-slider"
      aria-roledescription={t('home.slider.roleCarousel')}
      aria-label={t('home.slider.label')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {heading && <h1 className="visually-hidden">{heading}</h1>}
      <div
        id="hero-slider-slides"
        className="hero-slider__slides"
        aria-live={rotating ? 'off' : 'polite'}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {slides.map((slide, position) => (
          <Slide key={slide.id} slide={slide} index={position} total={total} active={position === index} />
        ))}
      </div>

      {several && (
        <div className="hero-slider__controls container" onKeyDown={onControlsKeyDown}>
          {/* A progress timeline: one slim bar per slide; the shown one fills while the slider plays. */}
          <div className="hero-slider__progress">
            <div ref={dotsRef} className="hero-slider__dots" role="group" aria-label={t('home.slider.choose')}>
              {slides.map((slide, position) => (
                <button
                  key={slide.id}
                  type="button"
                  className={cn('hero-slider__dot', position < index && 'hero-slider__dot--done')}
                  onClick={() => show(position)}
                  aria-controls="hero-slider-slides"
                  aria-current={position === index ? 'true' : undefined}
                  aria-label={t('home.slider.show', { number: position + 1 })}
                >
                  <span className="hero-slider__track" aria-hidden="true">
                    {position === index && (
                      <span
                        key={`${index}-${rotating}`}
                        className={cn('hero-slider__fill', rotating && 'hero-slider__fill--running')}
                        style={rotating ? { animationDuration: `${intervalSeconds}s` } : undefined}
                      />
                    )}
                  </span>
                </button>
              ))}
            </div>
            <p className="hero-slider__counter" aria-hidden="true">
              <span className="hero-slider__counter-current">{t('home.slider.number', { value: index + 1 })}</span>
              <span className="hero-slider__counter-sep">/</span>
              <span>{t('home.slider.number', { value: total })}</span>
            </p>
          </div>
          <div className="hero-slider__nav">
            {canRotate && (
              <button type="button" className="hero-slider__button hero-slider__button--play" onClick={togglePlaying} aria-label={playing ? t('home.slider.pause') : t('home.slider.play')}>
                {playing ? <LuPause aria-hidden="true" /> : <LuPlay aria-hidden="true" />}
              </button>
            )}
            <button type="button" className="hero-slider__button hero-slider__button--prev" onClick={() => show(index - 1)} aria-controls="hero-slider-slides" aria-label={t('home.slider.previous')}>
              <LuChevronLeft aria-hidden="true" />
            </button>
            <button type="button" className="hero-slider__button hero-slider__button--next" onClick={() => show(index + 1)} aria-controls="hero-slider-slides" aria-label={t('home.slider.next')}>
              <LuChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default HeroSlider
