import { LuX } from 'react-icons/lu'
import './ActiveFilters.css'

/**
 * Removable chips for every active filter, plus "Clear all".
 * `chips` = [{ id, label, onRemove }] built by the catalog page.
 */
function ActiveFilters({ chips, onClearAll }) {
  if (chips.length === 0) return null

  return (
    <div className="active-filters">
      <h2 className="visually-hidden">Active filters</h2>
      <ul className="active-filters__list">
        {chips.map((chip) => (
          <li key={chip.id}>
            <button type="button" className="active-filters__chip" onClick={chip.onRemove} aria-label={`Remove filter: ${chip.label}`}>
              {chip.label}
              <LuX aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {chips.length > 1 && (
        <button type="button" className="active-filters__clear" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  )
}

export default ActiveFilters
