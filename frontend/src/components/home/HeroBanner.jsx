import { LuCircleCheck } from 'react-icons/lu'
import Button from '../ui/Button'
import './HeroBanner.css'

/** Homepage hero. All content comes in through the `content` prop (CMS-ready). */
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
          <div className="hero__actions">
            <Button to={primaryCta.to} size="lg">
              {primaryCta.label}
            </Button>
            <Button to={secondaryCta.to} size="lg" variant="outline">
              {secondaryCta.label}
            </Button>
          </div>
          <ul className="hero__highlights">
            {highlights.map((highlight) => (
              <li key={highlight}>
                <LuCircleCheck aria-hidden="true" />
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <div className="hero__visual">
          <div className="hero__blob" aria-hidden="true" />
          <img src={image} alt={imageAlt} className="hero__image" width="560" height="560" fetchPriority="high" />
        </div>
      </div>
    </section>
  )
}

export default HeroBanner
