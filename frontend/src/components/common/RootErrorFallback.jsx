import { LuTriangleAlert } from 'react-icons/lu'
import Button from '../ui/Button'
import { ACCOUNT_STORES } from '../../constants/storageKeys'

// Saved data that is safe to drop: carts, wishlists (guest and per-account
// copies), and demo orders. The sign-in session is kept so the customer
// doesn't have to sign in again.

function resetSavedDataAndReload() {
  try {
    Object.keys(window.localStorage)
      .filter((key) => ACCOUNT_STORES.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // storage blocked: reloading is still worth a try
  }
  window.location.assign('/')
}

/**
 * Last-resort screen for the app-level ErrorBoundary (main.jsx): shown when
 * something OUTSIDE a page crashes (header, cart drawer, providers), where
 * the page-level boundary can't help. Deliberately plain: no router links or
 * context, since those may be what failed (Button without `to` is a plain <button>).
 */
function RootErrorFallback() {
  return (
    <div className="feedback feedback--error section container" role="alert">
      <LuTriangleAlert className="feedback__icon" aria-hidden="true" />
      <h1 className="feedback__title">BuyNest couldn&apos;t load</h1>
      <p className="feedback__message">
        Something went wrong while starting the store. Reloading usually fixes it. If it keeps happening, resetting
        your saved cart and wishlist on this device should help.
      </p>
      <div className="feedback__actions">
        <Button onClick={() => window.location.reload()}>Reload page</Button>
        <Button variant="outline" onClick={resetSavedDataAndReload}>
          Reset saved cart and reload
        </Button>
      </div>
    </div>
  )
}

export default RootErrorFallback
