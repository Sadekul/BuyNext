import { useId } from 'react'
import { availableSortOptions } from '../../constants/catalog'
import './SortSelect.css'
import { useTranslation } from 'react-i18next'

/**
 * Controlled <select>: the parent owns the value and decides what a change means.
 * `labels` renames options for the page ("Featured" is "Best match" for a search).
 */
function SortSelect({ value, onChange, labels }) {
  const { t } = useTranslation('catalog')
  const selectId = useId()

  return (
    <div className="sort-select">
      <label htmlFor={selectId}>{t('sort.label')}</label>
      <select id={selectId} value={value} onChange={(event) => onChange(event.target.value)}>
        {/* Phase 17: "Best selling" and "Newest" only where the API can sort by them. */}
        {availableSortOptions().map((option) => (
          <option key={option.value} value={option.value}>
            {labels?.[option.value] ?? t(option.labelKey, { defaultValue: option.label })}
          </option>
        ))}
      </select>
    </div>
  )
}

export default SortSelect
