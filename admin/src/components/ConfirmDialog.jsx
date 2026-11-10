import { useEffect, useId, useRef } from 'react'

/** A native <dialog> asking to confirm a destructive action. */
function ConfirmDialog({ isOpen, title, message, confirmLabel, onConfirm, onCancel, busy = false }) {
  const ref = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (isOpen && !dialog.open) dialog.showModal()
    if (!isOpen && dialog.open) dialog.close()
  }, [isOpen])

  return (
    <dialog ref={ref} className="confirm" aria-labelledby={titleId} onClose={onCancel}>
      <h2 id={titleId}>{title}</h2>
      <p>{message}</p>
      <div className="confirm__actions">
        <button type="button" className="btn btn--outline" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  )
}

export default ConfirmDialog
