import { useEffect, useId, useRef } from 'react'
import { LuX } from 'react-icons/lu'
import { cn } from '../../utils/classNames'
import './Modal.css'

/**
 * Accessible modal built on the native <dialog> element, which gives us
 * focus trapping, Escape-to-close, and a backdrop for free.
 *
 * The parent owns the open/closed state (`isOpen`) and passes `onClose`.
 * Variants: "center" (classic dialog) or "drawer" (slides in from the left).
 */
function Modal({ isOpen, onClose, title, variant = 'center', children }) {
  const dialogRef = useRef(null)
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
  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={cn('modal', `modal--${variant}`)}
      aria-labelledby={titleId}
      onClose={onClose}
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
      </div>
    </dialog>
  )
}

export default Modal
