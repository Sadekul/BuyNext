import { LuArrowRight } from 'react-icons/lu'
import Button from '../ui/Button'
import { cn } from '../../utils/classNames'
import './tones.css'
import './PromoBanner.css'

/**
 * Promotional tile. `tone` picks the colour scheme from the stored keys "navy", "emerald",
 * "amber", or "rose" (tones.css maps them to light blue grey, grey, beige, and pink, with dark text).
 * `large`: the big tile of the promo grid (more room for the photo and the title).
 * `compact` (phase 17): a short tile for the column beside the hero; `headingLevel` its heading (h2 there).
 */
function PromoBanner({ banner, large = false, compact = false, headingLevel = 3 }) {
  const { eyebrow, title, description, cta, image, imageAlt, tone } = banner
  const Heading = headingLevel === 2 ? 'h2' : 'h3'

  return (
    <article className={cn('promo-banner', `tone--${tone}`, large && 'promo-banner--large', compact && 'promo-banner--compact')}>
      <div className="promo-banner__copy">
        {eyebrow && <p className="promo-banner__eyebrow">{eyebrow}</p>}
        <Heading className="promo-banner__title">{title}</Heading>
        {description && <p className="promo-banner__description">{description}</p>}
        {cta && (
          <Button to={cta.to} size="sm" className="promo-banner__cta">
            {cta.label}
            <LuArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
      {image && (
        <div className="promo-banner__visual">
          <img src={image} alt={imageAlt} className="promo-banner__image" loading="lazy" width="280" height="280" />
        </div>
      )}
    </article>
  )
}

export default PromoBanner
