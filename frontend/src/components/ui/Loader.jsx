import { useTranslation } from 'react-i18next'
import './Loader.css'

/** Accessible loading spinner. `role="status"` makes screen readers announce the label. */
function Loader({ label, size = 'md' }) {
  const { t } = useTranslation('common')
  return (
    <div className={`loader loader--${size}`} role="status">
      <span className="loader__spinner" aria-hidden="true" />
      <span className="loader__label">{label ?? t('ui.loading')}</span>
    </div>
  )
}

export default Loader
