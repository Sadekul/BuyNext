import { LuWifiOff } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import './OfflineBanner.css'

/** Tells shoppers when the connection drops (the live region announces it too). */
function OfflineBanner() {
  const isOnline = useOnlineStatus()
  const { t } = useTranslation('common')

  return (
    <div role="status" className="offline-banner-region">
      {!isOnline && (
        <p className="offline-banner">
          <LuWifiOff aria-hidden="true" />
          {t('layout.offline')}
        </p>
      )}
    </div>
  )
}

export default OfflineBanner
