import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSparkles, LuX } from 'react-icons/lu'
import { STORAGE_KEYS } from '../../constants/storageKeys'
import './AnnouncementBar.css'

// The closed message is remembered per browser; storage may be unavailable (private mode), so every access is guarded.
function readDismissed() {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.announcement)
  } catch {
    return null
  }
}

function saveDismissed(message) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.announcement, message)
  } catch {
    // Not remembered: it shows again on the next visit.
  }
}

/**
 * Slim promo strip above the header (2026 redesign): one short message in the shopper's
 * language, on the brand gradient. The shopper can close it; the closed message is
 * remembered in this browser, and a different message (e.g. a new free-delivery
 * threshold) shows again. The layout leaves it out of the checkout.
 */
function AnnouncementBar({ messages }) {
  const { t } = useTranslation('common')
  const [dismissed, setDismissed] = useState(readDismissed)
  const message = messages[0]
  if (!message || dismissed === message) return null

  function dismiss() {
    saveDismissed(message)
    setDismissed(message)
  }

  return (
    <aside className="announcement-bar" aria-label={t('announcements.label')}>
      <div className="announcement-bar__inner container">
        <p className="announcement-bar__message">
          <LuSparkles aria-hidden="true" className="announcement-bar__icon" />
          <span>{message}</span>
        </p>
        <button type="button" className="announcement-bar__close" onClick={dismiss} aria-label={t('announcements.dismiss')}>
          <LuX aria-hidden="true" />
        </button>
      </div>
    </aside>
  )
}

export default AnnouncementBar
