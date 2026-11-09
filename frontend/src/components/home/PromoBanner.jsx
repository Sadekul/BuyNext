import Button from '../ui/Button'
import './PromoBanner.css'

/** Promotional tile. `tone` picks the color scheme: "navy" or "emerald". */
function PromoBanner({ banner }) {
  const { eyebrow, title, description, cta, image, imageAlt, tone } = banner

  return (
    <article className={`promo-banner promo-banner--${tone}`}>
      <div className="promo-banner__copy">
        <p className="promo-banner__eyebrow">{eyebrow}</p>
        <h3 className="promo-banner__title">{title}</h3>
        <p className="promo-banner__description">{description}</p>
        <Button to={cta.to} variant="light" size="sm">
          {cta.label}
        </Button>
      </div>
      <img src={image} alt={imageAlt} className="promo-banner__image" loading="lazy" width="280" height="280" />
    </article>
  )
}

export default PromoBanner
