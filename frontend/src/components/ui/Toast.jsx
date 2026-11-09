import { useEffect } from 'react'
import { LuCircleCheck, LuX } from 'react-icons/lu'
import './Toast.css'

const AUTO_DISMISS_MS = 4000

/**
 * Small notification that dismisses itself after a few seconds.
 * The live region (role="status") is always rendered so screen readers
 * announce new messages as they appear.
 */
function Toast({ message, onDismiss }) {
  // Start a timer whenever a new message appears. The cleanup function
  // cancels the old timer if the message changes or the Toast unmounts.
  useEffect(() => {
    if (!message) return
    const timerId = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timerId)
  }, [message, onDismiss])

  return (
    <div className="toast-region" role="status">
      {message && (
        <div className="toast">
          <LuCircleCheck className="toast__icon" aria-hidden="true" />
          <p className="toast__message">{message}</p>
          <button type="button" className="toast__close" onClick={onDismiss} aria-label="Dismiss notification">
            <LuX aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

export default Toast
