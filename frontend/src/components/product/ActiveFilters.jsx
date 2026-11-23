import { LuX } from 'react-icons/lu'
import './ActiveFilters.css'
import { useTranslation } from 'react-i18next'

/**
 * Removable chips for every active filter, plus "Clear all".
 * `chips` = [{ id, label, onRemove }] built by the catalog page.
 */
function ActiveFilters({ chips, onClearAll }) {
  const { t } = useTranslation('catalog')
  if (chips.length === 0) return null

  return (
    <div className="active-filters">
      <h2 className="visually-hidden">{t('filters.active')}</h2>
      <ul className="active-filters__list">
        {chips.map((chip) => (
          <li key={chip.id}>
            <button type="button" className="active-filters__chip" onClick={chip.onRemove} aria-label={t('filters.remove', { label: chip.label })}>
              {chip.label}
              <LuX aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {chips.length > 1 && (
        <button type="button" className="active-filters__clear" onClick={onClearAll}>
          {t('filters.clearAll')}
        </button>
      )}
    </div>
  )
}

export default ActiveFilters
