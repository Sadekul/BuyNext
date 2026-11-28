import { useEffect, useId, useRef } from 'react'
import { LuX } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/classNames'
import './Modal.css'

/**
 * Accessible modal built on the native <dialog> element, which gives us
 * focus trapping, Escape-to-close, and a backdrop for free.
 *
 * The parent owns the open/closed state (`isOpen`) and passes `onClose`.
 * Variants: "center" (classic dialog), "drawer" (slides in from the left),
 * or "drawer-right" (slides in from the right, used by the cart).
 * Phase 22: an extra `className` and an `onKeyDown` handler for the whole
 * dialog (the review photo viewer's arrow keys).
 */
function Modal({ isOpen, onClose, title, variant = 'center', footer, className, onKeyDown, children }) {
  const { t } = useTranslation('common')
  const dialogRef = useRef(null)
  const pressStartedOnBackdropRef = useRef(false)
  const titleId = useId()

  // Sync React state → DOM: open or close the native dialog when `isOpen` changes.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen && !dialog.open) {
      dialog.showModal()
    } else if (!isOpen && dialog.open) {
      dialog.close()
    }
  }, [isOpen])

  // A click whose target is the <dialog> itself landed on the backdrop.
  // Also require the press to START there, so selecting text inside the
  // panel and releasing over the backdrop doesn't close the dialog.
  function handlePointerDown(event) {
    pressStartedOnBackdropRef.current = event.target === event.currentTarget
  }

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget && pressStartedOnBackdropRef.current) {
      onClose()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={cn('modal', `modal--${variant}`, className)}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onPointerDown={handlePointerDown}
      onClick={handleBackdropClick}
    >
      <div className="modal__panel">
        {/* A div, not <header>: a dialog opened from the site header must not add a second banner landmark. */}
        <div className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label={t('ui.close')}>
            <LuX aria-hidden="true" />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </dialog>
  )
}

export default Modal
