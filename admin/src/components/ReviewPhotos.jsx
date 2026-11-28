import { useEffect, useId, useRef, useState } from 'react'
import { LuEye, LuEyeOff, LuX } from 'react-icons/lu'
import { formatBytes } from '../utils/format'

/**
 * Phase 22 (docs/backend/PHASE22_CONTRACT.md §3): a review's photos on
 * Catalog → Reviews. Each one is a thumbnail loaded through the admin service
 * (never the store's public address: a pending or hidden photo is only
 * visible to staff). Clicking a thumbnail opens it larger in a dialog. A
 * hidden photo is dimmed and says "Hidden from the store"; with
 * reviews.moderate each photo has a Hide photo / Show photo button.
 *
 * Photos are numbered in their order on the review (1 to 3), the same
 * numbers the audit log uses ("Photo 2 of review #41 …").
 */
function ReviewPhotos({ photos, who, moderate, busyId, onToggle }) {
  const [open, setOpen] = useState(null)
  const openerRef = useRef(null)
  const ordered = [...photos].sort((a, b) => a.position - b.position)
  if (ordered.length === 0) return null
  const current = open === null ? null : ordered.find((photo) => photo.id === open)
  const currentNumber = current ? ordered.indexOf(current) + 1 : 0

  return (
    <>
      <ul className="review-photos">
        {ordered.map((photo, index) => {
          const number = index + 1
          const action = photo.hidden ? 'Show' : 'Hide'
          return (
            <li key={photo.id} className={photo.hidden ? 'review-photo review-photo--hidden' : 'review-photo'}>
              <button
                type="button"
                className="review-photo__open"
                aria-label={`View photo ${number} of review by ${who}`}
                onClick={(event) => {
                  openerRef.current = event.currentTarget
                  setOpen(photo.id)
                }}
              >
                <Thumbnail photo={photo} />
              </button>
              {photo.hidden && <span className="review-photo__note">Hidden from the store</span>}
              {moderate && (
                <button
                  type="button"
                  className="btn btn--outline btn--sm review-photo__toggle"
                  disabled={busyId === photo.id}
                  aria-label={`${action} photo ${number} of review by ${who}`}
                  onClick={() => onToggle(photo, number)}
                >
                  {photo.hidden ? <LuEye aria-hidden="true" /> : <LuEyeOff aria-hidden="true" />} {action} photo
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <PhotoDialog
        photo={current}
        title={current ? `Photo ${currentNumber} of ${ordered.length}, review by ${who}` : ''}
        onClose={() => setOpen(null)}
        returnFocus={() => openerRef.current?.focus()}
      />
    </>
  )
}

/** The small picture; a photo that can't be loaded (session ended, file gone) says so instead of showing a broken image. */
function Thumbnail({ photo }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="review-photo__missing">Not loaded</span>
  return <img src={photo.url} alt="" width="80" height="80" loading="lazy" decoding="async" onError={() => setFailed(true)} />
}

/** A native modal <dialog>: Escape closes it, and focus goes back to the thumbnail that opened it. */
function PhotoDialog({ photo, title, onClose, returnFocus }) {
  const ref = useRef(null)
  const wasOpen = useRef(false)
  const titleId = useId()
  const isOpen = photo !== null && photo !== undefined

  useEffect(() => {
    const dialog = ref.current
    if (isOpen && !dialog.open) dialog.showModal()
    if (!isOpen && dialog.open) dialog.close()
    // Closed (Escape, the Close button, or the photo went away): back to the thumbnail.
    if (!isOpen && wasOpen.current) returnFocus()
    wasOpen.current = isOpen
  }, [isOpen, returnFocus])

  const facts = isOpen ? [photo.width && photo.height ? `${photo.width} × ${photo.height} px` : null, photo.sizeBytes !== null && photo.sizeBytes !== undefined ? formatBytes(photo.sizeBytes) : null].filter(Boolean) : []
  return (
    <dialog ref={ref} className="confirm photo-dialog" aria-labelledby={titleId} onClose={() => isOpen && onClose()}>
      {isOpen && (
        <>
          <div className="photo-dialog__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-button" aria-label="Close photo" onClick={onClose} autoFocus>
              <LuX aria-hidden="true" />
            </button>
          </div>
          <img className="photo-dialog__image" src={photo.url} alt={title} width={photo.width ?? undefined} height={photo.height ?? undefined} />
          <p>
            {photo.hidden ? 'Hidden from the store. ' : ''}
            {facts.join(' · ')}
          </p>
        </>
      )}
    </dialog>
  )
}

export default ReviewPhotos
