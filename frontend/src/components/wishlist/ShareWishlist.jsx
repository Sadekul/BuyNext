import { useId, useRef, useState } from 'react'
import { LuCopy, LuLink, LuShare2 } from 'react-icons/lu'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { useWishlist } from '../../hooks/useWishlist'
import { shareWishlist, stopSharingWishlist } from '../../services/wishlistService'
import { ROUTES } from '../../constants/routes'
import './ShareWishlist.css'

/**
 * Phase 11 §1 (REAL_SHOP, signed in): "Share my wishlist". Makes a link
 * anyone can open (no sign-in) to see the list and add its products to their
 * own cart; it shows the customer's first name only. The API keeps only a
 * hash of the link's token, so the link is shown when it is made and can't
 * be shown again later: "Get a new link" makes another (the old one stops
 * working). "Stop sharing" turns it off.
 */
function ShareWishlist() {
  const { authorizedRequest } = useAuth()
  const wishlist = useWishlist()
  const [link, setLink] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const titleId = useId()
  const inputId = useId()

  async function run(action, onDone) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      onDone(await authorizedRequest(action))
    } catch (failure) {
      setError(failure?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const makeLink = (regenerate) =>
    run(
      () => shareWishlist({ regenerate }),
      (result) => {
        wishlist.setShared(true)
        // Already shared (from another device): the API can't show that link again.
        if (!result.token) {
          setLink(null)
          setStatus('Your wishlist is already shared. Get a new link to copy it here.')
          return
        }
        setLink(`${window.location.origin}${ROUTES.sharedWishlist(result.token)}`)
        setStatus(regenerate ? 'A new share link was made. The old link no longer works.' : 'Your share link is ready.')
      },
    )

  const stopSharing = () =>
    run(
      () => stopSharingWishlist(),
      () => {
        setLink(null)
        wishlist.setShared(false)
        setStatus('Sharing is off. The link no longer works.')
      },
    )

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setStatus('Link copied.')
    } catch {
      // No clipboard access (an older browser, or permission refused): select the link so it can be copied by hand.
      inputRef.current?.select()
      setStatus('Select the link and copy it.')
    }
  }

  return (
    <section className="share-wishlist" aria-labelledby={titleId}>
      <h2 id={titleId} className="share-wishlist__title">
        <LuShare2 aria-hidden="true" /> Share my wishlist
      </h2>
      {link ? (
        <>
          <label htmlFor={inputId} className="share-wishlist__label">
            Share link
          </label>
          <div className="share-wishlist__row">
            <input ref={inputRef} id={inputId} className="share-wishlist__input" value={link} readOnly onFocus={(event) => event.target.select()} />
            <Button size="sm" onClick={copyLink} disabled={busy}>
              <LuCopy aria-hidden="true" /> Copy link
            </Button>
          </div>
          <p className="share-wishlist__hint">Anyone with this link can see your wishlist and your first name. Save it now: for your privacy it isn&apos;t shown again.</p>
        </>
      ) : (
        <p className="share-wishlist__hint">
          {wishlist.shared
            ? 'Your wishlist is shared. For your privacy the link is only shown when it is made: get a new link to copy it again (the old one stops working).'
            : 'Make a link to send to friends and family. They see your saved products and your first name, nothing else.'}
        </p>
      )}
      <div className="share-wishlist__actions">
        {!wishlist.shared ? (
          <Button size="sm" onClick={() => makeLink(false)} disabled={busy}>
            <LuLink aria-hidden="true" /> Create share link
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => makeLink(true)} disabled={busy}>
              Get a new link
            </Button>
            <Button size="sm" variant="ghost" onClick={stopSharing} disabled={busy}>
              Stop sharing
            </Button>
          </>
        )}
      </div>
      <p className="share-wishlist__status" role="status">
        {status}
      </p>
      {error && (
        <p className="share-wishlist__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export default ShareWishlist
