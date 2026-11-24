import { SLIDE_BANGLA_FIELDS, banglaValues, toBangla } from './bangla'

/*
 * Home page: single banner or slider (docs/backend/HOME_SLIDER_CONTRACT.md §4):
 * the slides' form values, the checks that mirror the API, and what is sent.
 */

export const HERO_MODES = [
  { value: 'banner', label: 'Single banner', hint: 'One large banner with a headline, buttons, and an image (the hero below).' },
  { value: 'slider', label: 'Slider', hint: 'Up to 8 slides that change by themselves or with the arrows.' },
]
export const TONES = [
  { value: 'navy', label: 'Navy' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
]
export const MAX_SLIDES = 8
export const SLIDER_SECONDS = { min: 3, max: 15, default: 6 }

const LINK = /^(\/(?!\/)|https?:\/\/)\S*$/i
const IMAGE = /^https?:\/\/\S+$/i
const LINK_RULE = 'Use a store path like /products or an https:// address.'
export const NO_ACTIVE_SLIDE = 'Add at least one active slide, or show the single banner instead.'

let nextKey = 0
const cta = (value) => ({ label: value?.label ?? '', url: value?.url ?? '' })

/** A saved slide → the form's values (a stable React key, every field a string, Bangla texts ''). */
export const slideForm = (slide = {}) => ({
  key: `slide-${nextKey++}`,
  id: slide.id ?? null,
  eyebrow: slide.eyebrow ?? '',
  title: slide.title ?? '',
  description: slide.description ?? '',
  primaryCta: cta(slide.primaryCta),
  secondaryCta: cta(slide.secondaryCta),
  imageUrl: slide.imageUrl ?? '',
  imageAlt: slide.imageAlt ?? '',
  tone: TONES.some((tone) => tone.value === slide.tone) ? slide.tone : 'navy',
  isActive: slide.isActive !== false,
  bn: banglaValues(slide.bn, SLIDE_BANGLA_FIELDS),
})
export const emptySlide = () => slideForm()

/** The saved slider settings → the form's (seconds as typed text). */
export const sliderForm = (slider) => ({ autoplay: slider?.autoplay !== false, intervalSeconds: String(slider?.intervalSeconds ?? SLIDER_SECONDS.default) })

/** The checks the API makes, by path ("slides.0.title"), so errors show next to the fields before saving. */
export function slideErrors(mode, slides, slider) {
  const found = {}
  if (slides.length > MAX_SLIDES) found.slides = [`Use up to ${MAX_SLIDES} slides.`]
  slides.forEach((slide, index) => {
    const path = `slides.${index}`
    if (!slide.title.trim()) found[`${path}.title`] = ['Enter a title.']
    for (const name of ['primaryCta', 'secondaryCta']) {
      const label = slide[name].label.trim()
      const url = slide[name].url.trim()
      if (!label && !url) continue
      if (!label) found[`${path}.${name}.label`] = ['Enter the button text.']
      if (!url) found[`${path}.${name}.url`] = ['Enter where the button goes.']
      else if (!LINK.test(url)) found[`${path}.${name}.url`] = [LINK_RULE]
    }
    const image = slide.imageUrl.trim()
    if (image && !IMAGE.test(image)) found[`${path}.imageUrl`] = ['Use an https:// image address.']
    if (image && !slide.imageAlt.trim()) found[`${path}.imageAlt`] = ['Describe the image for people who cannot see it.']
  })
  if (mode === 'slider' && !found.slides && !slides.some((slide) => slide.isActive)) found.slides = [NO_ACTIVE_SLIDE]
  const seconds = Number(slider.intervalSeconds)
  if (String(slider.intervalSeconds).trim() === '' || !Number.isInteger(seconds) || seconds < SLIDER_SECONDS.min || seconds > SLIDER_SECONDS.max) {
    found['slider.intervalSeconds'] = [`Choose ${SLIDER_SECONDS.min} to ${SLIDER_SECONDS.max} seconds.`]
  }
  return found
}

const toCta = (value) => (value.label.trim() || value.url.trim() ? { label: value.label.trim(), url: value.url.trim() } : null)

/** The form's slides and settings → what PUT /api/admin/home takes (list order = position). */
export const toSlides = (slides) =>
  slides.map((slide) => ({
    id: slide.id,
    eyebrow: slide.eyebrow.trim(),
    title: slide.title.trim(),
    description: slide.description.trim(),
    primaryCta: toCta(slide.primaryCta),
    secondaryCta: toCta(slide.secondaryCta),
    imageUrl: slide.imageUrl.trim(),
    imageAlt: slide.imageAlt.trim(),
    tone: slide.tone,
    isActive: slide.isActive,
    bn: toBangla(slide.bn, SLIDE_BANGLA_FIELDS),
  }))
export const toSlider = (slider) => ({ autoplay: slider.autoplay, intervalSeconds: Number(slider.intervalSeconds) })
