import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import Modal from '../ui/Modal'
import './ReviewPhotoViewer.css'

/**
 * Phase 22: one review's photos, large, in a dialog (the native <dialog>
 * through Modal: focus stays inside, Escape and "Close" close it). "Previous
 * photo" / "Next photo" (and the arrow keys) move between the photos, and
 * "Photo 1 of 2" says where you are; with a single photo there is nothing to
 * move to, so those buttons aren't shown. The parent puts the focus back on
 * the thumbnail that opened it.
 */
function ReviewPhotoViewer({ photos, index, name, onIndexChange, onClose, onPhotoError }) {
  const { t } = useTranslation('catalog')
  const total = photos.length
  const photo = photos[index]
  if (!photo) return null

  const move = (step) => onIndexChange((index + step + total) % total)

  function handleKeyDown(event) {
    if (total < 2) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={t('reviews.photosOf', { name })} className="photo-viewer" onKeyDown={handleKeyDown}>
      <div className="photo-viewer__frame">
        <img
          key={photo.url}
          src={photo.url}
          alt={t('reviews.photoAlt', { number: index + 1, total, name })}
          width={photo.width ?? undefined}
          height={photo.height ?? undefined}
          className="photo-viewer__image"
          onError={() => onPhotoError(photo.url)}
        />
      </div>
      <p className="photo-viewer__count" aria-live="polite">
        {t('reviews.photoCount', { number: index + 1, total })}
      </p>
      {total > 1 && (
        <div className="photo-viewer__controls">
          <button type="button" className="photo-viewer__move" onClick={() => move(-1)}>
            <LuChevronLeft aria-hidden="true" />
            {t('reviews.previousPhoto')}
          </button>
          <button type="button" className="photo-viewer__move" onClick={() => move(1)}>
            {t('reviews.nextPhoto')}
            <LuChevronRight aria-hidden="true" />
          </button>
        </div>
      )}
    </Modal>
  )
}

export default ReviewPhotoViewer
