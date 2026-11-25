import Button from '../ui/Button'
import { cn } from '../../utils/classNames'
import './tones.css'
import './PromoBanner.css'

/**
 * Promotional tile. `tone` picks the colour scheme from the stored keys "navy", "emerald",
 * "amber", or "rose" (tones.css maps them to ink, indigo, coral, and violet).
 * `large`: the big tile of the promo grid (more room for the photo and the title).
 */
function PromoBanner({ banner, large = false }) {
  const { eyebrow, title, description, cta, image, imageAlt, tone } = banner

  return (
    <article className={cn('promo-banner', `tone--${tone}`, large && 'promo-banner--large')}>
      <div className="promo-banner__copy">
        {eyebrow && <p className="promo-banner__eyebrow">{eyebrow}</p>}
        <h3 className="promo-banner__title">{title}</h3>
        {description && <p className="promo-banner__description">{description}</p>}
        {cta && (
          <Button to={cta.to} variant="light" size="sm" className="promo-banner__cta">
            {cta.label}
          </Button>
        )}
      </div>
      {image && (
        <div className="promo-banner__visual">
          <span className="promo-banner__disc" aria-hidden="true" />
          <img src={image} alt={imageAlt} className="promo-banner__image" loading="lazy" width="280" height="280" />
        </div>
      )}
    </article>
  )
}

export default PromoBanner
