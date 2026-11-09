import { LuCircleAlert, LuRefreshCw } from 'react-icons/lu'
import Button from './Button'
import './Feedback.css'

/**
 * Error panel with an optional retry action.
 * `onRetry` is a function prop: the parent decides what "retry" means.
 */
function ErrorMessage({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="feedback feedback--error" role="alert">
      <LuCircleAlert className="feedback__icon" aria-hidden="true" />
      <h2 className="feedback__title">{title}</h2>
      {message && <p className="feedback__message">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <LuRefreshCw aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  )
}

export default ErrorMessage
