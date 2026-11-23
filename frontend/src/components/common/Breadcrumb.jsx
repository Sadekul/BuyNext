import { Link } from 'react-router'
import { LuChevronRight } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import './Breadcrumb.css'

/**
 * Breadcrumb trail. `items` = [{ label, to }]; the last item is the current
 * page (no link, aria-current="page").
 */
function Breadcrumb({ items }) {
  const { t } = useTranslation('common')
  return (
    <nav className="breadcrumb" aria-label={t('breadcrumb.label')}>
      <ol className="breadcrumb__list">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1
          return (
            <li key={item.label} className="breadcrumb__item">
              {isCurrent ? (
                <span aria-current="page">{item.label}</span>
              ) : (
                <>
                  <Link to={item.to}>{item.label}</Link>
                  <LuChevronRight className="breadcrumb__separator" aria-hidden="true" />
                </>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumb
