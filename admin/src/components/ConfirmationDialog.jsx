import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { recordConfirmation } from '../api/phase14'
import Field from './Field'
import FormDialog from './FormDialog'
import { formatBdMobile } from '../utils/bangladesh'
import { actionErrorMessage } from '../utils/permissions'

/*
 * Phase 14 §4: what came of a call to confirm a cash on delivery order.
 * Confirmed (the order may ship; the customer is emailed "We've confirmed
 * your order"), Couldn't reach (it stays in the queue, the attempt counted),
 * Cancel (a reason is required; the items go back into stock and the
 * customer gets the cancel email), each with an optional note for staff.
 */
const KINDS = {
  confirmed: {
    title: (number) => `Confirm order ${number}?`,
    description: 'The customer confirmed on the phone. The order can then be packed and shipped.',
    submit: 'Mark as confirmed',
    done: (number, notify) => `Order ${number} confirmed.${notify ? ' The customer was emailed.' : ''}`,
  },
  unreachable: {
    title: (number) => `Couldn't reach the customer of ${number}?`,
    description: 'The attempt is counted and the order stays in the queue to call again.',
    submit: "Save: couldn't reach",
    done: (number) => `Order ${number}: the attempt was saved. It stays in the queue.`,
  },
  cancelled: {
    title: (number) => `Cancel order ${number}?`,
    description: "The items go back into stock and the customer is emailed that the order was cancelled. This can't be undone.",
    submit: 'Cancel order',
    done: (number) => `Order ${number} cancelled; the items are back in stock and the customer was emailed.`,
  },
}
const CANCEL_REASONS = ['Customer cancelled on the phone', 'Wrong or fake order', 'Ordered twice', 'Out of the delivery area']

function ConfirmationDialog({ order, outcome, onDone, onCancel }) {
  const kind = KINDS[outcome]
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [otherReason, setOtherReason] = useState('')
  const [notify, setNotify] = useState(true)
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: (values) => recordConfirmation(order.number, values),
    onSuccess: (data) => onDone(kind.done(order.number, notify && outcome === 'confirmed'), data),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = {}
    const why = reason === 'other' ? otherReason.trim() : reason
    if (outcome === 'cancelled' && !why) found.reason = ['Choose or write the reason.']
    if (note.length > 500) found.note = ['Keep the note to 500 characters.']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate({
      outcome,
      ...(note.trim() && { note: note.trim() }),
      ...(outcome === 'cancelled' && { reason: why }),
      ...(outcome === 'confirmed' && { notifyCustomer: notify }),
    })
  }

  const other = save.error && (save.error.fieldErrors ? Object.entries(save.error.fieldErrors).find(([field]) => !['note', 'reason'].includes(field))?.[1]?.[0] : actionErrorMessage(save.error))
  return (
    <FormDialog
      isOpen
      title={kind.title(order.number)}
      description={kind.description}
      submitLabel={kind.submit}
      danger={outcome === 'cancelled'}
      busy={save.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {order.phone && (
        <p className="muted">
          {order.customerName ? `${order.customerName}, ` : ''}
          {formatBdMobile(order.phone)}
        </p>
      )}
      {outcome === 'cancelled' && (
        <>
          <Field label="Reason" error={errors.reason?.[0]} hint="Kept in the order's history and the confirmation log.">
            {(a11y) => (
              <select {...a11y} value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="">Choose…</option>
                {CANCEL_REASONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
                <option value="other">Another reason…</option>
              </select>
            )}
          </Field>
          {reason === 'other' && (
            <Field label="The reason" error={errors.reason?.[0]}>
              {(a11y) => <input {...a11y} value={otherReason} maxLength={200} onChange={(event) => setOtherReason(event.target.value)} />}
            </Field>
          )}
        </>
      )}
      <Field label="Note (optional)" error={errors.note?.[0]} hint="Only staff see it.">
        {(a11y) => <textarea {...a11y} rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      {outcome === 'confirmed' && (
        <label className="checkbox">
          <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
          Email the customer that the order is confirmed
        </label>
      )}
    </FormDialog>
  )
}

export default ConfirmationDialog
