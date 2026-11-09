import { LuLayoutGrid, LuList } from 'react-icons/lu'
import { cn } from '../../utils/classNames'
import './ViewToggle.css'

const VIEWS = [
  { value: 'grid', label: 'Grid view', icon: LuLayoutGrid },
  { value: 'list', label: 'List view', icon: LuList },
]

/** Two toggle buttons; `aria-pressed` tells screen readers which view is on. */
function ViewToggle({ value, onChange }) {
  return (
    <div className="view-toggle" role="group" aria-label="Product layout">
      {VIEWS.map(({ value: view, label, icon: Icon }) => (
        <button
          key={view}
          type="button"
          className={cn('view-toggle__button', value === view && 'view-toggle__button--active')}
          onClick={() => onChange(view)}
          aria-pressed={value === view}
          aria-label={label}
        >
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

export default ViewToggle
