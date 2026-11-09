import { LuPackageOpen } from 'react-icons/lu'
import './Feedback.css'

/**
 * Friendly "nothing here" panel. `icon` accepts any icon component and
 * `children` holds optional actions (e.g. a "Continue shopping" button).
 */
function EmptyState({ icon: Icon = LuPackageOpen, title, message, children }) {
  return (
    <div className="feedback">
      <Icon className="feedback__icon" aria-hidden="true" />
      <h2 className="feedback__title">{title}</h2>
      {message && <p className="feedback__message">{message}</p>}
      {children && <div className="feedback__actions">{children}</div>}
    </div>
  )
}

export default EmptyState
