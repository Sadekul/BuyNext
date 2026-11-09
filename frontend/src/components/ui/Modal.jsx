import { useEffect, useId, useRef } from 'react'
import { LuX } from 'react-icons/lu'
import { cn } from '../../utils/classNames'
import './Modal.css'

/**
 * Accessible modal built on the native <dialog> element, which gives us
 * focus trapping, Escape-to-close, and a backdrop for free.
 *
 * The parent owns the open/closed state (`isOpen`) and passes `onClose`.
 * Variants: "center" (classic dialog), "drawer" (slides in from the left),
 * or "drawer-right" (slides in from the right, used by the cart).
 */
function Modal({ isOpen, onClose, title, variant = 'center', footer, children }) {
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
      className={cn('modal', `modal--${variant}`)}
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={handlePointerDown}
      onClick={handleBackdropClick}
    >
      <div className="modal__panel">
        <header className="modal__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            <LuX aria-hidden="true" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </dialog>
  )
}

export default Modal
