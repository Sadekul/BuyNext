import { LuLayoutGrid, LuList } from 'react-icons/lu'
import { cn } from '../../utils/classNames'
import './ViewToggle.css'
import { useTranslation } from 'react-i18next'

const VIEWS = [
  { value: 'grid', labelKey: 'view.grid', icon: LuLayoutGrid },
  { value: 'list', labelKey: 'view.list', icon: LuList },
]

/** Two toggle buttons; `aria-pressed` tells screen readers which view is on. */
function ViewToggle({ value, onChange }) {
  const { t } = useTranslation('catalog')
  return (
    <div className="view-toggle" role="group" aria-label={t('view.layout')}>
      {VIEWS.map(({ value: view, labelKey, icon: Icon }) => (
        <button
          key={view}
          type="button"
          className={cn('view-toggle__button', value === view && 'view-toggle__button--active')}
          onClick={() => onChange(view)}
          aria-pressed={value === view}
          aria-label={t(labelKey)}
        >
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

export default ViewToggle
