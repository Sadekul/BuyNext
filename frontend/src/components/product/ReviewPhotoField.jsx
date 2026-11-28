import { useRef } from 'react'
import { LuImagePlus, LuX } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/classNames'
import { PHOTO_TYPES } from '../../utils/shrinkPhoto'
import './ReviewPhotoField.css'

/**
 * Phase 22: "Add photos (optional)" in the review form.
 *
 * The file input is the field: it is visually hidden but stays focusable, and
 * its <label> is what you see, styled as a button (clicking it, or Enter /
 * Space on the focused input, opens the photo picker). Chosen photos show as
 * small previews, each with a "Remove photo N" button. Problems (from the
 * browser's own checks or from the server, `photos` / `photos.N`) are shown
 * under the field and linked to the input with aria-describedby.
 */
function ReviewPhotoField({ id, photos, onAdd, onRemove, error, serverErrors = [], preparing, max, maxMegabytes }) {
  const { t } = useTranslation('catalog')
  const inputRef = useRef(null)
  const inputId = `${id}-photos`
  const hintId = `${id}-photos-hint`
  const errorId = `${id}-photos-error`
  const messages = [error, ...serverErrors].filter(Boolean)

  function handleChange(event) {
    const files = [...event.target.files]
    // Cleared, so choosing the same photo again after removing it still counts as a change.
    event.target.value = ''
    onAdd(files)
  }

  function handleRemove(key) {
    onRemove(key)
    inputRef.current?.focus()
  }

  return (
    <div className={cn('form-field review-photos', messages.length > 0 && 'form-field--invalid')}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name="photos"
        accept={PHOTO_TYPES}
        multiple
        className="review-photos__input"
        onChange={handleChange}
        aria-invalid={messages.length > 0 ? true : undefined}
        aria-describedby={[hintId, messages.length > 0 && errorId].filter(Boolean).join(' ')}
      />
      <label htmlFor={inputId} className="review-photos__button">
        <LuImagePlus aria-hidden="true" />
        {t('reviewForm.photosLabel')}
      </label>
      <p id={hintId} className="form-field__hint">
        {t('reviewForm.photosHint', { max, size: maxMegabytes })}
      </p>
      <p className="review-photos__status" role="status">
        {preparing ? t('reviewForm.preparingPhotos') : ''}
      </p>

      {photos.length > 0 && (
        <ul className="review-photos__list" aria-label={t('reviewForm.chosenPhotos')}>
          {photos.map((photo, index) => (
            <li key={photo.key} className="review-photos__item">
              {photo.previewUrl ? (
                <img src={photo.previewUrl} alt={t('reviewForm.photoPreview', { number: index + 1, name: photo.name })} className="review-photos__preview" />
              ) : (
                <span className="review-photos__preview review-photos__preview--name">{photo.name}</span>
              )}
              <button type="button" className="review-photos__remove" onClick={() => handleRemove(photo.key)} aria-label={t('reviewForm.removePhoto', { number: index + 1 })}>
                <LuX aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {messages.length > 0 && (
        <div id={errorId} role="alert">
          {messages.map((message) => (
            <p key={message} className="form-field__error">
              {message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export default ReviewPhotoField
