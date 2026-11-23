import { LuHeadphones, LuRotateCcw, LuShieldCheck, LuTruck } from 'react-icons/lu'
import './BenefitsSection.css'
import { useTranslation } from 'react-i18next'

const BENEFIT_ICONS = {
  truck: LuTruck,
  returns: LuRotateCcw,
  shield: LuShieldCheck,
  support: LuHeadphones,
}

function BenefitsSection({ benefits }) {
  const { t } = useTranslation('marketing')
  return (
    <section className="benefits" aria-labelledby="benefits-title">
      <div className="container">
        <h2 id="benefits-title" className="visually-hidden">
          {t('benefits.title')}
        </h2>
        <ul className="benefits__list">
          {benefits.map((benefit) => {
            const Icon = BENEFIT_ICONS[benefit.icon]
            return (
              <li key={benefit.id} className="benefits__item">
                <Icon className="benefits__icon" aria-hidden="true" />
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
