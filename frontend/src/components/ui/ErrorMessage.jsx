import { LuCircleAlert, LuRefreshCw } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import Button from './Button'
import './Feedback.css'

/**
 * Error panel with an optional retry action.
 * `onRetry` is a function prop: the parent decides what "retry" means.
 */
function ErrorMessage({ title, titleAs: Title = 'h2', message, onRetry }) {
  const { t } = useTranslation('common')
  return (
    <div className="feedback feedback--error" role="alert">
      <LuCircleAlert className="feedback__icon" aria-hidden="true" />
      <Title className="feedback__title">{title ?? t('ui.somethingWrong')}</Title>
      {message && <p className="feedback__message">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <LuRefreshCw aria-hidden="true" />
          {t('ui.tryAgain')}
        </Button>
      )}
    </div>
  )
}

export default ErrorMessage
