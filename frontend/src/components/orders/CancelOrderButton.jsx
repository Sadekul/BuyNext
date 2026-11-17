import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuBan } from 'react-icons/lu'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useAuth } from '../../hooks/useAuth'
import { cancelOrder } from '../../services/shopService'
import './CancelOrderButton.css'

const MAX_REASON = 500

/**
 * "Cancel order" (phase 9), for orders the API says the shopper may cancel
 * themselves (`order.canCancel`: unpaid, nothing invoiced or shipped). Asks
 * first in a dialog, with an optional reason. Signed-in customers are
 * recognised by their session; a guest passes the order's `email` (the same
 * proof as order tracking). If the API refuses (it was paid or shipped in
 * the meantime) its own text is shown, which says how to contact the store.
 * `onCancelled(order)` receives the cancelled order.
 */
function CancelOrderButton({ order, email, onCancelled }) {
  const { isAuthenticated, authorizedRequest } = useAuth()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [done, setDone] = useState('')
  const reasonId = useId()
  const hintId = useId()
  const guestEmail = isAuthenticated ? undefined : (email ?? order.email)

  const cancel = useMutation({
    mutationFn: () => {
      const input = { reason, email: guestEmail }
      return isAuthenticated ? authorizedRequest(() => cancelOrder(order.number, input)) : cancelOrder(order.number, input)
    },
    onSuccess: (cancelled) => {
      setOpen(false)
      setDone(`Order ${order.number} was cancelled. We've emailed you a confirmation.`)
      onCancelled?.(cancelled)
    },
  })

  // The status line stays after the button goes, so the result is announced.
  if (!order.canCancel && !done) return null

  function close() {
    if (cancel.isPending) return
    setOpen(false)
    cancel.reset()
  }

  return (
    <div className="cancel-order">
      {order.canCancel && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <LuBan aria-hidden="true" /> Cancel order
        </Button>
      )}
      <p className="cancel-order__status" role="status">
        {done}
      </p>
      <Modal
        isOpen={open && order.canCancel}
        onClose={close}
        title={`Cancel order ${order.number}?`}
        footer={
          <div className="cancel-order__actions">
            <Button variant="ghost" onClick={close} disabled={cancel.isPending}>
              Keep my order
            </Button>
            <Button className="cancel-order__confirm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending ? 'Cancelling…' : 'Yes, cancel it'}
            </Button>
          </div>
        }
      >
        <div className="cancel-order__body">
          <p>The items go back on sale, any discount code can be used again, and nothing is charged. We'll email you a confirmation.</p>
          <label htmlFor={reasonId} className="cancel-order__label">
            Why are you cancelling? <span className="cancel-order__optional">(optional)</span>
          </label>
          <textarea
            id={reasonId}
            className="cancel-order__reason"
            rows={3}
            maxLength={MAX_REASON}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby={hintId}
          />
          <p id={hintId} className="cancel-order__hint">
            Up to {MAX_REASON} characters. It's kept with the order.
          </p>
          {cancel.error && (
            <p className="cancel-order__error" role="alert">
              {cancel.error.message}
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}

export default CancelOrderButton
