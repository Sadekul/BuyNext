import { LuHeadphones, LuRotateCcw, LuShieldCheck, LuTruck } from 'react-icons/lu'
import SectionHeading from '../common/SectionHeading'
import './BenefitsSection.css'
import { useTranslation } from 'react-i18next'

const BENEFIT_ICONS = {
  truck: LuTruck,
  returns: LuRotateCcw,
  shield: LuShieldCheck,
  support: LuHeadphones,
}

/** The store's promises as four flat, light grey tiles, each with a emerald line icon. */
function BenefitsSection({ benefits }) {
  const { t } = useTranslation('marketing')
  return (
    <section className="section home-section benefits" aria-labelledby="benefits-title">
      <div className="container">
        <SectionHeading id="benefits-title" eyebrow={t('benefits.eyebrow')} title={t('benefits.title')} />
        <ul className="benefits__list">
          {benefits.map((benefit) => {
            const Icon = BENEFIT_ICONS[benefit.icon]
            return (
              <li key={benefit.id} className={`benefits__item benefits__item--${benefit.icon}`}>
                <span className="benefits__icon" aria-hidden="true">
                  <Icon />
                </span>
                <div>
                  <h3 className="benefits__title">{benefit.title}</h3>
                  <p className="benefits__text">{benefit.text}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

export default BenefitsSection
