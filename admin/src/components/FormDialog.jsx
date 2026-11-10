import { useEffect, useId, useRef } from 'react'

/**
 * A form in a native modal <dialog>: the browser keeps keyboard focus inside,
 * Escape closes it, and focus goes back to the button that opened it.
 * `error` is the form-level message (announced); field errors belong on the
 * fields themselves (components/Field.jsx).
 */
function FormDialog({ isOpen, title, description, submitLabel, onSubmit, onCancel, busy = false, error, danger = false, wide = false, children }) {
  const ref = useRef(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (isOpen && !dialog.open) dialog.showModal()
    if (!isOpen && dialog.open) dialog.close()
  }, [isOpen])

  return (
    <dialog
      ref={ref}
      className={`confirm form-dialog${wide ? ' form-dialog--wide' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onCancel}
    >
      {isOpen && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy) onSubmit()
          }}
        >
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
          <div className="form-dialog__body">{children}</div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm__actions">
            <button type="button" className="btn btn--outline" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} disabled={busy}>
              {busy ? 'Working…' : submitLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}

export default FormDialog
