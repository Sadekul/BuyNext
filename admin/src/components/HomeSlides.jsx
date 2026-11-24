import { useRef, useState } from 'react'
import { LuArrowDown, LuArrowUp, LuPlus, LuTrash2 } from 'react-icons/lu'
import BanglaField from './BanglaField'
import ConfirmDialog from './ConfirmDialog'
import Field from './Field'
import StatusBadge from './StatusBadge'
import { HERO_MODES, MAX_SLIDES, SLIDER_SECONDS, TONES, emptySlide } from '../utils/homeSlides'

/*
 * Home page: single banner or slider (docs/backend/HOME_SLIDER_CONTRACT.md §4).
 * HeroModeChoice: "Top of the home page" (Single banner / Slider).
 * SlidesEditor: the slides (add up to 8, edit, reorder, delete with a
 * confirmation) and the slider settings. The page keeps the state and saves
 * everything with its own Save button; errors come in by path ("slides.0.title").
 */

/** Phase 13: a "Bangla (বাংলা)" group of fields inside a hero, banner, or slide. */
export function BanglaGroup({ children }) {
  return (
    <fieldset className="form__fieldset bangla-section">
      <legend>
        Bangla{' '}
        <span lang="bn" className="muted">
          (বাংলা)
        </span>
      </legend>
      <p className="field__hint">Shown when shoppers use the store in Bangla. Empty fields show the English text.</p>
      {children}
    </fieldset>
  )
}

/** "Top of the home page": a radio group, each choice with a one-line hint read with it. */
export function HeroModeChoice({ mode, onChange, error }) {
  return (
    <section className="panel" aria-labelledby="hero-mode-title">
      <h2 id="hero-mode-title" className="panel__title">
        Top of the home page
      </h2>
      <div role="radiogroup" aria-labelledby="hero-mode-title" aria-describedby={error ? 'hero-mode-error' : undefined} className="form__fieldset hero-mode">
        {HERO_MODES.map((option) => (
          <div key={option.value} className="choices__option">
            <label className="checkbox">
              <input type="radio" name="hero-mode" value={option.value} checked={mode === option.value} aria-describedby={`hero-mode-${option.value}-hint`} onChange={() => onChange(option.value)} />
              {option.label}
            </label>
            <p id={`hero-mode-${option.value}-hint`} className="field__hint choices__note">
              {option.hint}
            </p>
          </div>
        ))}
        {mode === 'slider' && <p className="field__hint">The single banner is kept: choose “Single banner” again to show and edit it.</p>}
        {error && (
          <p id="hero-mode-error" className="field__error">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

/** A visible label with the slide's number for screen readers ("Slide 2: Title"), so every slide's fields have their own names. */
const slideLabel = (number, text) => (
  <>
    <span className="visually-hidden">Slide {number}:</span> {text}
  </>
)
const isImage = (value) => /^https?:\/\/\S+$/i.test(value)

export function SlidesEditor({ slides, setSlides, slider, setSlider, err, announce, clearErrors }) {
  const [toDelete, setToDelete] = useState(null) // index of the slide to delete
  const buttons = useRef(new Map())
  const addButton = useRef(null)
  const full = slides.length >= MAX_SLIDES

  const setSlide = (key, change) => setSlides((current) => current.map((slide) => (slide.key === key ? { ...slide, ...change } : slide)))
  const setCta = (slide, cta, part) => (event) => setSlide(slide.key, { [cta]: { ...slide[cta], [part]: event.target.value } })
  const setBn = (slide, field) => (text) => setSlide(slide.key, { bn: { ...slide.bn, [field]: text } })

  function move(index, step) {
    const target = index + step
    if (target < 0 || target >= slides.length) return
    const next = [...slides]
    ;[next[index], next[target]] = [next[target], next[index]]
    setSlides(next)
    clearErrors() // field errors are numbered by position
    announce(`${next[target].title || 'Slide'} moved to position ${target + 1} of ${next.length}.`)
    const direction = step < 0 ? 'up' : 'down'
    requestAnimationFrame(() => {
      const atEnd = (direction === 'up' && target === 0) || (direction === 'down' && target === next.length - 1)
      buttons.current.get(`${next[target].key}-${atEnd ? (direction === 'up' ? 'down' : 'up') : direction}`)?.focus()
    })
  }
  function add() {
    if (full) return
    const slide = emptySlide()
    setSlides((current) => [...current, slide])
    announce(`Slide ${slides.length + 1} added.`)
    requestAnimationFrame(() => document.querySelector(`[data-slide-title="${slide.key}"]`)?.focus())
  }
  function remove() {
    const index = toDelete
    setToDelete(null)
    if (index === null) return
    announce(`Slide ${index + 1}${slides[index].title ? ` (${slides[index].title})` : ''} deleted.`)
    setSlides((current) => current.filter((_, position) => position !== index))
    clearErrors()
    requestAnimationFrame(() => addButton.current?.focus())
  }

  const listError = err('slides')
  return (
    <section className="panel" aria-labelledby="slides-title">
      <h2 id="slides-title" className="panel__title">
        Slides
      </h2>
      <p className="field__hint">Shown in this order. Inactive slides are kept but not shown. At least one slide must be active.</p>
      {listError && (
        <p id="slides-error" className="field__error">
          {listError}
        </p>
      )}
      {slides.length === 0 && <p className="muted">No slides yet. Add one to show the slider.</p>}
      <ol className="banner-list" aria-describedby={listError ? 'slides-error' : undefined}>
        {slides.map((slide, index) => {
          const number = index + 1
          const path = `slides.${index}`
          const label = (text) => slideLabel(number, text)
          return (
            <li key={slide.key} className="banner-item">
              <fieldset className="form__fieldset">
                <legend className="slide-item__legend">
                  {isImage(slide.imageUrl) && <img className="slide-item__thumb" src={slide.imageUrl} alt="" width="48" height="32" loading="lazy" />}
                  <span>
                    Slide {number}: {slide.title || 'New slide'}
                  </span>{' '}
                  {slide.isActive ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label="Inactive" />}
                </legend>
                <div className="banner-item__tools">
                  <button type="button" ref={(node) => buttons.current.set(`${slide.key}-up`, node)} className="icon-button" aria-label={`Move slide ${number} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <LuArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    ref={(node) => buttons.current.set(`${slide.key}-down`, node)}
                    className="icon-button"
                    aria-label={`Move slide ${number} down`}
                    disabled={index === slides.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <LuArrowDown aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-button icon-button--danger" aria-label={`Delete slide ${number}`} onClick={() => setToDelete(index)}>
                    <LuTrash2 aria-hidden="true" />
                  </button>
                </div>
                <div className="form__grid">
                  <Field label={label('Title')} error={err(`${path}.title`)}>
                    {(a11y) => <input {...a11y} data-slide-title={slide.key} required value={slide.title} maxLength={120} onChange={(event) => setSlide(slide.key, { title: event.target.value })} />}
                  </Field>
                  <Field label={label('Eyebrow (small text above the title)')} error={err(`${path}.eyebrow`)}>
                    {(a11y) => <input {...a11y} value={slide.eyebrow} maxLength={60} onChange={(event) => setSlide(slide.key, { eyebrow: event.target.value })} />}
                  </Field>
                </div>
                <Field label={label('Description')} error={err(`${path}.description`)}>
                  {(a11y) => <textarea {...a11y} rows={2} value={slide.description} maxLength={300} onChange={(event) => setSlide(slide.key, { description: event.target.value })} />}
                </Field>
                <div className="form__grid">
                  <Field label={label('Main button text (optional)')} error={err(`${path}.primaryCta.label`)}>
                    {(a11y) => <input {...a11y} value={slide.primaryCta.label} maxLength={40} onChange={setCta(slide, 'primaryCta', 'label')} />}
                  </Field>
                  <Field label={label('Main button link')} error={err(`${path}.primaryCta.url`)} hint="A store path like /products, or https://…">
                    {(a11y) => <input {...a11y} value={slide.primaryCta.url} maxLength={500} onChange={setCta(slide, 'primaryCta', 'url')} />}
                  </Field>
                  <Field label={label('Second button text (optional)')} error={err(`${path}.secondaryCta.label`)}>
                    {(a11y) => <input {...a11y} value={slide.secondaryCta.label} maxLength={40} onChange={setCta(slide, 'secondaryCta', 'label')} />}
                  </Field>
                  <Field label={label('Second button link')} error={err(`${path}.secondaryCta.url`)}>
                    {(a11y) => <input {...a11y} value={slide.secondaryCta.url} maxLength={500} onChange={setCta(slide, 'secondaryCta', 'url')} />}
                  </Field>
                  <Field label={label('Image address')} error={err(`${path}.imageUrl`)} hint="An https:// address. Without an image, the slide shows its color.">
                    {(a11y) => <input {...a11y} type="url" value={slide.imageUrl} maxLength={2048} onChange={(event) => setSlide(slide.key, { imageUrl: event.target.value })} />}
                  </Field>
                  <Field label={label('Image description (alt text)')} error={err(`${path}.imageAlt`)} hint="What the image shows, for people who can't see it.">
                    {(a11y) => <input {...a11y} value={slide.imageAlt} maxLength={160} onChange={(event) => setSlide(slide.key, { imageAlt: event.target.value })} />}
                  </Field>
                  <Field label={label('Color')} error={err(`${path}.tone`)} hint="The background behind the text.">
                    {(a11y) => (
                      <select {...a11y} value={slide.tone} onChange={(event) => setSlide(slide.key, { tone: event.target.value })}>
                        {TONES.map((tone) => (
                          <option key={tone.value} value={tone.value}>
                            {tone.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
                <label className="checkbox">
                  <input type="checkbox" checked={slide.isActive} onChange={(event) => setSlide(slide.key, { isActive: event.target.checked })} />
                  {label('Active (shown in the store)')}
                </label>
                <BanglaGroup>
                  <div className="form__grid">
                    <BanglaField label={`Slide ${number}: title in Bangla`} value={slide.bn.title} english={slide.title} onChange={setBn(slide, 'title')} maxLength={120} error={err(`${path}.bn.title`)} />
                    <BanglaField label={`Slide ${number}: eyebrow in Bangla`} value={slide.bn.eyebrow} english={slide.eyebrow} onChange={setBn(slide, 'eyebrow')} maxLength={60} error={err(`${path}.bn.eyebrow`)} />
                  </div>
                  <BanglaField label={`Slide ${number}: description in Bangla`} value={slide.bn.description} english={slide.description} onChange={setBn(slide, 'description')} maxLength={300} multiline rows={2} error={err(`${path}.bn.description`)} />
                  <div className="form__grid">
                    <BanglaField label={`Slide ${number}: main button text in Bangla`} value={slide.bn.primaryCtaLabel} english={slide.primaryCta.label} onChange={setBn(slide, 'primaryCtaLabel')} maxLength={40} error={err(`${path}.bn.primaryCtaLabel`)} />
                    <BanglaField label={`Slide ${number}: second button text in Bangla`} value={slide.bn.secondaryCtaLabel} english={slide.secondaryCta.label} onChange={setBn(slide, 'secondaryCtaLabel')} maxLength={40} error={err(`${path}.bn.secondaryCtaLabel`)} />
                    <BanglaField label={`Slide ${number}: image description in Bangla`} value={slide.bn.imageAlt} english={slide.imageAlt} onChange={setBn(slide, 'imageAlt')} maxLength={160} error={err(`${path}.bn.imageAlt`)} />
                  </div>
                </BanglaGroup>
              </fieldset>
            </li>
          )
        })}
      </ol>
      <div className="slides__add">
        <button type="button" ref={addButton} className="btn btn--outline btn--sm" disabled={full} aria-describedby="slides-count" onClick={add}>
          <LuPlus aria-hidden="true" /> Add slide
        </button>
        <span id="slides-count" className="field__hint">
          {full ? `${MAX_SLIDES} of ${MAX_SLIDES} slides, the most the slider holds. Delete one to add another.` : `${slides.length} of ${MAX_SLIDES} slides.`}
        </span>
      </div>

      <fieldset className="form__fieldset slider-settings">
        <legend>Slider settings</legend>
        <label className="checkbox">
          <input type="checkbox" checked={slider.autoplay} aria-describedby="slider-autoplay-hint" onChange={(event) => setSlider((current) => ({ ...current, autoplay: event.target.checked }))} />
          Play automatically
        </label>
        <p id="slider-autoplay-hint" className="field__hint">
          Shoppers can pause it. It also pauses while the pointer or keyboard focus is on it, and stays still for people who ask for less motion.
        </p>
        {err('slider.autoplay') && <p className="field__error">{err('slider.autoplay')}</p>}
        <Field label="Seconds per slide" error={err('slider.intervalSeconds')} hint={`${SLIDER_SECONDS.min} to ${SLIDER_SECONDS.max} seconds.`}>
          {(a11y) => (
            <input
              {...a11y}
              type="number"
              inputMode="numeric"
              min={SLIDER_SECONDS.min}
              max={SLIDER_SECONDS.max}
              step="1"
              value={slider.intervalSeconds}
              onChange={(event) => setSlider((current) => ({ ...current, intervalSeconds: event.target.value }))}
            />
          )}
        </Field>
      </fieldset>

      <ConfirmDialog
        isOpen={toDelete !== null}
        title={toDelete !== null ? `Delete slide ${toDelete + 1}?` : 'Delete slide?'}
        message={toDelete !== null ? `“${slides[toDelete]?.title || 'New slide'}” is removed from the slider when you save the home page.` : ''}
        confirmLabel="Delete slide"
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </section>
  )
}
