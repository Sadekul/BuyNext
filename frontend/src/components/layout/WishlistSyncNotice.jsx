import { LuCircleAlert, LuX } from 'react-icons/lu'
import { useWishlist } from '../../hooks/useWishlist'
import '../ui/Toast.css'
import { useTranslation } from 'react-i18next'

/**
 * Phase 11: when the server refuses a wishlist change (REAL_SHOP, signed in),
 * the change is undone and this says why ("Your wishlist is full…"), on any
 * page: the heart on a product card has no room for it. It stays until
 * dismissed or the next change, and is announced (an alert region that is always present).
 */
function WishlistSyncNotice() {
  const { t } = useTranslation('catalog')
  const { syncError, dismissError } = useWishlist()
  return (
    <div className="toast-region" role="alert">
      {syncError && (
        <div className="toast">
          <LuCircleAlert className="toast__icon toast__icon--warning" aria-hidden="true" />
          <p className="toast__message">{syncError}</p>
          <button type="button" className="toast__close" onClick={dismissError} aria-label={t('syncNotice.dismiss')}>
            <LuX aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

export default WishlistSyncNotice
