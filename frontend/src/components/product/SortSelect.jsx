import { useId } from 'react'
import { SORT_OPTIONS } from '../../constants/catalog'
import './SortSelect.css'

/**
 * Controlled <select>: the parent owns the value and decides what a change means.
 * `labels` renames options for the page ("Featured" is "Best match" for a search).
 */
function SortSelect({ value, onChange, labels }) {
  const selectId = useId()

  return (
    <div className="sort-select">
      <label htmlFor={selectId}>Sort by</label>
      <select id={selectId} value={value} onChange={(event) => onChange(event.target.value)}>
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {labels?.[option.value] ?? option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export default SortSelect
