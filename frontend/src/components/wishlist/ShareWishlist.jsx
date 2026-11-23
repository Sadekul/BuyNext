import { useId, useRef, useState } from 'react'
import { LuCopy, LuLink, LuShare2 } from 'react-icons/lu'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { useWishlist } from '../../hooks/useWishlist'
import { shareWishlist, stopSharingWishlist } from '../../services/wishlistService'
import { ROUTES } from '../../constants/routes'
import './ShareWishlist.css'
import { useTranslation } from 'react-i18next'

/**
 * Phase 11 §1 (REAL_SHOP, signed in): "Share my wishlist". Makes a link
 * anyone can open (no sign-in) to see the list and add its products to their
 * own cart; it shows the customer's first name only. The API keeps only a
 * hash of the link's token, so the link is shown when it is made and can't
 * be shown again later: "Get a new link" makes another (the old one stops
 * working). "Stop sharing" turns it off.
 */
function ShareWishlist() {
  const { t } = useTranslation('catalog')
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
      setError(failure?.message ?? t('share.failed'))
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
          setStatus(t('share.alreadyShared'))
          return
        }
        setLink(`${window.location.origin}${ROUTES.sharedWishlist(result.token)}`)
        setStatus(t(regenerate ? 'share.newLink' : 'share.ready'))
      },
    )

  const stopSharing = () =>
    run(
      () => stopSharingWishlist(),
      () => {
        setLink(null)
        wishlist.setShared(false)
        setStatus(t('share.stopped'))
      },
    )

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setStatus(t('share.copied'))
    } catch {
      // No clipboard access (an older browser, or permission refused): select the link so it can be copied by hand.
      inputRef.current?.select()
      setStatus(t('share.selectToCopy'))
    }
  }

  return (
    <section className="share-wishlist" aria-labelledby={titleId}>
      <h2 id={titleId} className="share-wishlist__title">
        <LuShare2 aria-hidden="true" /> {t('share.title')}
      </h2>
      {link ? (
        <>
          <label htmlFor={inputId} className="share-wishlist__label">
            {t('share.linkLabel')}
          </label>
          <div className="share-wishlist__row">
            <input ref={inputRef} id={inputId} className="share-wishlist__input" value={link} readOnly onFocus={(event) => event.target.select()} />
            <Button size="sm" onClick={copyLink} disabled={busy}>
              <LuCopy aria-hidden="true" /> {t('share.copy')}
            </Button>
          </div>
          <p className="share-wishlist__hint">{t('share.linkHint')}</p>
        </>
      ) : (
        <p className="share-wishlist__hint">
          {t(wishlist.shared ? 'share.sharedHint' : 'share.intro')}
        </p>
      )}
      <div className="share-wishlist__actions">
        {!wishlist.shared ? (
          <Button size="sm" onClick={() => makeLink(false)} disabled={busy}>
            <LuLink aria-hidden="true" /> {t('share.create')}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => makeLink(true)} disabled={busy}>
              {t('share.regenerate')}
            </Button>
            <Button size="sm" variant="ghost" onClick={stopSharing} disabled={busy}>
              {t('share.stop')}
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
