import { Link } from 'react-router'
import { LuArrowRight } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import './SectionHeading.css'

/** Consistent section title row with an optional "View all" link. */
function SectionHeading({ id, eyebrow, title, description, viewAllTo, viewAllLabel }) {
  const { t } = useTranslation('common')
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="section-heading__eyebrow">{eyebrow}</p>}
        <h2 id={id} className="section-heading__title">
          {title}
        </h2>
        {description && <p className="section-heading__description">{description}</p>}
      </div>
      {viewAllTo && (
        <Link to={viewAllTo} className="section-heading__link">
          {viewAllLabel ?? t('section.viewAll')}
          <LuArrowRight aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

export default SectionHeading
