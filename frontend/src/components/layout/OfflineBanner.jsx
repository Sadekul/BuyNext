import { LuWifiOff } from 'react-icons/lu'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import './OfflineBanner.css'

/** Tells shoppers when the connection drops (the live region announces it too). */
function OfflineBanner() {
  const isOnline = useOnlineStatus()

  return (
    <div role="status" className="offline-banner-region">
      {!isOnline && (
        <p className="offline-banner">
          <LuWifiOff aria-hidden="true" />
          You're offline. You can keep browsing, but prices and stock can't be updated until you reconnect.
        </p>
      )}
    </div>
  )
}

export default OfflineBanner
