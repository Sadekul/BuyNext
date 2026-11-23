import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuBan } from 'react-icons/lu'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useAuth } from '../../hooks/useAuth'
import { cancelOrder } from '../../services/shopService'
import './CancelOrderButton.css'
import { Trans, useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('orders')
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
      setDone(t('cancel.done', { number: order.number }))
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
          <LuBan aria-hidden="true" /> {t('cancel.button')}
        </Button>
      )}
      <p className="cancel-order__status" role="status">
        {done}
      </p>
      <Modal
        isOpen={open && order.canCancel}
        onClose={close}
        title={t('cancel.title', { number: order.number })}
        footer={
          <div className="cancel-order__actions">
            <Button variant="ghost" onClick={close} disabled={cancel.isPending}>
              {t('cancel.keep')}
            </Button>
            <Button className="cancel-order__confirm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {t(cancel.isPending ? 'cancel.cancelling' : 'cancel.confirm')}
            </Button>
          </div>
        }
      >
        <div className="cancel-order__body">
          <p>{t('cancel.explain')}</p>
          <label htmlFor={reasonId} className="cancel-order__label">
            <Trans t={t} i18nKey="cancel.why" components={{ optional: <span className="cancel-order__optional" /> }} />
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
            {t('cancel.hint', { max: MAX_REASON })}
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
