import { LuArrowRight, LuCircleCheck } from 'react-icons/lu'
import Button from '../ui/Button'
import './HeroBanner.css'

/**
 * Homepage hero. All content comes in through the `content` prop: the demo's
 * data/homeContent.js or the admin's CMS (REAL_SHOP), where a button or the
 * image may be left out.
 */
function HeroBanner({ content }) {
  const { eyebrow, title, description, primaryCta, secondaryCta, image, imageAlt, highlights } = content

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__inner container">
        <div className="hero__copy">
          <p className="hero__eyebrow">{eyebrow}</p>
          <h1 id="hero-title" className="hero__title">
            {title}
          </h1>
          <p className="hero__description">{description}</p>
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
          {highlights.length > 0 && (
            <ul className="hero__highlights">
              {highlights.map((highlight) => (
                <li key={highlight}>
                  <LuCircleCheck aria-hidden="true" />
                  {highlight}
                </li>
              ))}
            </ul>
          )}
        </div>

        {image && (
          <div className="hero__visual">
            <div className="hero__disc" aria-hidden="true" />
            <img src={image} alt={imageAlt} className="hero__image" width="560" height="560" fetchPriority="high" />
          </div>
        )}
      </div>
    </section>
  )
}

export default HeroBanner
