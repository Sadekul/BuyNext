import { LuPackageOpen } from 'react-icons/lu'
import './Feedback.css'

/**
 * Friendly "nothing here" panel. `icon` accepts any icon component and
 * `children` holds optional actions (e.g. a "Continue shopping" button).
 * `titleAs` sets the heading level so it fits the surrounding page outline.
 */
function EmptyState({ icon: Icon = LuPackageOpen, title, titleAs: Title = 'h2', message, children }) {
  return (
    <div className="feedback">
      <Icon className="feedback__icon" aria-hidden="true" />
      <Title className="feedback__title">{title}</Title>
      {message && <p className="feedback__message">{message}</p>}
      {children && <div className="feedback__actions">{children}</div>}
    </div>
  )
}

export default EmptyState
