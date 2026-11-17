import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminKeys, createCreditMemo, createInvoice, createReturn, createShipment, getRefundable, getSettings, updateOrder } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from './Field'
import FormDialog from './FormDialog'
import { ErrorState, Loading } from './States'
import { formatMoney } from '../utils/format'
import { CARRIERS, paidThroughStripe } from '../utils/orders'

/*
 * The actions on a real order, each in its own dialog with its own note and
 * "email the customer" choice (docs/backend/PHASE3_CONTRACT.md). Every
 * dialog calls `onDone(message)` after the server agreed, or `onCancel()`.
 * The server is the judge: its 422 messages appear on the fields they
 * concern, or above the buttons.
 */

const toCents = (value) => Math.round(value * 100)
const firstError = (error, field) => error?.fieldErrors?.[field]?.[0]
// A 422 without a field this form shows: the first message the server gave, else its summary.
const formError = (error, shownFields = []) => {
  if (!error) return null
  const other = Object.entries(error.fieldErrors ?? {}).find(([field]) => !shownFields.some((shown) => field === shown || field.startsWith(`${shown}.`)))
  if (other) return other[1][0]
  return error.fieldErrors ? null : error.message
}

function NoteAndEmail({ note, setNote, notify, setNotify, error, emailLabel = 'Email the customer', noteHint }) {
  return (
    <>
      <Field label="Note (optional)" error={error} hint={noteHint ?? 'Added to the order history, which the customer can see.'}>
        {(a11y) => <textarea {...a11y} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
        {emailLabel}
      </label>
    </>
  )
}

/** Invoice: records that the order total was paid (pending payment → processing). */
export function InvoiceDialog({ order, onDone, onCancel }) {
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const create = useMutation({
    mutationFn: () => createInvoice(order.number, { note: note.trim() || undefined, notifyCustomer: notify }),
    onSuccess: ({ invoice }) => {
      const moved = order.status === 'pending_payment' ? ' The order is now processing.' : ''
      onDone(`Invoice ${invoice.number} created: payment of ${formatMoney(invoice.amount)} recorded.${moved}${notify ? ' The customer was emailed.' : ''}`)
    },
  })
  return (
    <FormDialog
      isOpen
      title={`Invoice order ${order.number}`}
      description={
        order.payment?.canPay
          ? `Records a payment of ${formatMoney(order.totals.total)}, the order total. Card payments through Stripe are recorded by themselves when Stripe confirms them: invoice by hand only if the customer paid another way.`
          : `Records a payment of ${formatMoney(order.totals.total)}, the order total. No payment provider is connected yet: invoice once the money has arrived.`
      }
      submitLabel="Create invoice"
      busy={create.isPending}
      error={formError(create.error, ['note'])}
      onSubmit={() => create.mutate()}
      onCancel={onCancel}
    >
      <NoteAndEmail note={note} setNote={setNote} notify={notify} setNotify={setNotify} error={firstError(create.error, 'note')} emailLabel="Email the customer a payment receipt" />
    </FormDialog>
  )
}

/** Shipment: carrier and tracking number; the order becomes shipped. */
export function ShipDialog({ order, onDone, onCancel }) {
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [errors, setErrors] = useState({})
  const create = useMutation({
    mutationFn: () => createShipment(order.number, { carrier, trackingNumber: tracking.trim() || undefined, note: note.trim() || undefined, notifyCustomer: notify }),
    onSuccess: ({ shipment }) => {
      const tracked = shipment.trackingNumber ? ` with ${shipment.carrierLabel} tracking number ${shipment.trackingNumber}` : ` with ${shipment.carrierLabel}`
      onDone(`Shipment ${shipment.number} created${tracked}. The order is now shipped.${notify ? ' The customer was emailed.' : ''}`)
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = {}
    if (!carrier) found.carrier = ['Choose a carrier.']
    if (tracking.trim() && !/^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/.test(tracking.trim())) found.trackingNumber = ['Use up to 64 letters, digits, spaces, or dashes.']
    setErrors(found)
    if (Object.keys(found).length === 0) create.mutate()
  }

  return (
    <FormDialog
      isOpen
      title={`Ship order ${order.number}`}
      description="Ships every item in one parcel."
      submitLabel="Create shipment"
      busy={create.isPending}
      error={formError(create.error, ['carrier', 'trackingNumber', 'note'])}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Carrier" error={errors.carrier?.[0]}>
        {(a11y) => (
          <select {...a11y} value={carrier} onChange={(event) => setCarrier(event.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(CARRIERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Tracking number (optional)" error={errors.trackingNumber?.[0]} hint="DHL, FedEx, UPS, and USPS numbers become a tracking link in the customer's email and order page.">
        {(a11y) => <input {...a11y} value={tracking} maxLength={64} autoComplete="off" onChange={(event) => setTracking(event.target.value)} />}
      </Field>
      <NoteAndEmail note={note} setNote={setNote} notify={notify} setNotify={setNotify} error={errors.note?.[0]} emailLabel="Email the customer the tracking details" />
    </FormDialog>
  )
}

/** "Mark as delivered" or "Cancel order": plain status changes, with a note. */
export function StatusDialog({ order, status, onDone, onCancel }) {
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const cancelling = status === 'cancelled'
  const change = useMutation({
    mutationFn: () => updateOrder(order.number, { status, note: note.trim() || undefined, notifyCustomer: notify }),
    onSuccess: () => onDone(`${cancelling ? 'Order cancelled; the items are back in stock.' : 'Marked as delivered.'}${notify ? ' The customer was emailed.' : ''}`),
  })
  const statusError = firstError(change.error, 'status')
  return (
    <FormDialog
      isOpen
      title={cancelling ? `Cancel order ${order.number}?` : `Mark order ${order.number} as delivered?`}
      description={cancelling ? "The items go back into stock and the order can't be reopened." : undefined}
      submitLabel={cancelling ? 'Cancel order' : 'Mark as delivered'}
      danger={cancelling}
      busy={change.isPending}
      error={statusError ?? formError(change.error, ['note', 'status'])}
      onSubmit={() => change.mutate()}
      onCancel={onCancel}
    >
      <NoteAndEmail note={note} setNote={setNote} notify={notify} setNotify={setNotify} error={firstError(change.error, 'note')} />
    </FormDialog>
  )
}

/** Text field → number (empty = 0); NaN when it isn't a number. */
const amount = (text) => (text.trim() === '' ? 0 : Number(text))
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

const REFUND_DESCRIPTION = 'Records a refund (credit memo). No payment provider is connected yet: return the money yourself by the original payment method.'
// Phase 8: paid by card through Stripe, the API refunds the card itself before saving the memo.
const STRIPE_REFUND_DESCRIPTION = "Records a refund (credit memo). The refund goes back to the customer's card through Stripe; if Stripe refuses it, nothing is saved."

const refundDescription = (order) => (paidThroughStripe(order) ? STRIPE_REFUND_DESCRIPTION : REFUND_DESCRIPTION)

/**
 * Credit memo: per-item quantities (bounded by what is still refundable),
 * shipping, an adjustment, and restocking. The total updates as you type; the
 * server computes the exact amounts (each line's share of the coupon, to the cent).
 */
export function RefundDialog({ order, prefill, onDone, onCancel }) {
  const limits = useQuery({ queryKey: adminKeys.refundable(order.number), queryFn: ({ signal }) => getRefundable(order.number, { signal }), staleTime: 0 })
  if (limits.data) return <RefundForm order={order} limits={limits.data} prefill={prefill} onDone={onDone} onCancel={onCancel} />
  return (
    <FormDialog isOpen wide title={`Refund order ${order.number}`} description={refundDescription(order)} submitLabel="Refund" busy onSubmit={() => {}} onCancel={onCancel}>
      {limits.isPending ? <Loading label="Loading what can be refunded…" /> : <ErrorState error={limits.error} onRetry={limits.refetch} />}
    </FormDialog>
  )
}

// unit_refund is rounded down; the last unit of each line takes the leftover cents.
const ESTIMATE_NOTE = 'An estimate: the last unit of each line includes any leftover cents. The credit memo shows the exact amount.'

/**
 * `prefill` (phase 6, "Refund this return"): { returnNumber, quantities: { orderItemId: n }, restock }.
 * The credit memo then names the return, which becomes refunded; items the
 * return already put back into stock are not restocked twice (the API makes sure).
 */
function RefundForm({ order, limits, prefill, onDone, onCancel }) {
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(limits.items.map((item) => [item.orderItemId, prefill?.quantities?.[item.orderItemId] ? String(Math.min(prefill.quantities[item.orderItemId], item.refundable)) : ''])),
  )
  const [shipping, setShipping] = useState('')
  const [adjustment, setAdjustment] = useState('')
  const [restock, setRestock] = useState(prefill?.restock ?? false) // like the API: stock goes back only when asked
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [errors, setErrors] = useState({})

  const chosen = limits.items.map((item) => ({ item, quantity: amount(quantities[item.orderItemId]) }))
  const shippingValue = amount(shipping)
  const adjustmentValue = amount(adjustment)
  // Whole cents, so the total never shows floating-point noise.
  const totalCents =
    chosen.reduce((sum, { item, quantity }) => sum + (Number.isInteger(quantity) && quantity > 0 ? toCents(item.unitRefund) * quantity : 0), 0) +
    (Number.isFinite(shippingValue) ? toCents(shippingValue) : 0) +
    (Number.isFinite(adjustmentValue) ? toCents(adjustmentValue) : 0)

  const stripe = paidThroughStripe(order)
  const create = useMutation({
    mutationFn: (values) => createCreditMemo(order.number, values),
    onSuccess: ({ creditMemo }) => {
      const full = toCents(creditMemo.total) >= toCents(limits.maxTotal)
      onDone(
        `Credit memo ${creditMemo.number} created: ${formatMoney(creditMemo.total)} refunded${creditMemo.restocked ? ' and the items returned to stock' : ''}.${prefill?.returnNumber ? ` Return ${prefill.returnNumber} is now refunded.` : ''}${full ? ' The order is now closed.' : ''}${notify ? ' The customer was emailed.' : ''}${creditMemo.refundReference || stripe ? " Stripe is returning the money to the customer's card." : ' Return the money by the original payment method.'}`,
      )
    },
    onError: (error, sent) => {
      // The server numbers items by their place in what was sent: "items.0.quantity" → that order item's field.
      const mapped = {}
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        const match = /^items\.(\d+)\./.exec(field)
        const item = match && sent.items[Number(match[1])]
        if (item) mapped[`item-${item.orderItemId}`] = messages
        else mapped[field] = messages
      }
      setErrors(mapped)
    },
  })

  function submit() {
    const found = {}
    for (const { item, quantity } of chosen) {
      if (!Number.isInteger(quantity) || quantity < 0) found[`item-${item.orderItemId}`] = ['Enter a whole number.']
      else if (quantity > item.refundable) found[`item-${item.orderItemId}`] = [item.refundable === 0 ? 'Already refunded in full.' : `At most ${item.refundable} can be refunded.`]
    }
    if (!Number.isFinite(shippingValue) || shippingValue < 0 || !hasCents(shippingValue)) found.shippingRefund = ['Enter an amount of 0 or more, with at most 2 decimals.']
    else if (toCents(shippingValue) > toCents(limits.shippingRefundable)) found.shippingRefund = [`At most ${formatMoney(limits.shippingRefundable)} of shipping can be refunded.`]
    if (!Number.isFinite(adjustmentValue) || !hasCents(adjustmentValue)) found.adjustment = ['Enter an amount with at most 2 decimals.']
    if (Object.keys(found).length === 0) {
      if (totalCents <= 0) found.total = ['Choose something to refund: the total must be above $0.00.']
      else if (totalCents > toCents(limits.maxTotal)) found.total = [`The total can't be more than ${formatMoney(limits.maxTotal)}, what is left to refund.`]
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const items = chosen.filter(({ quantity }) => quantity > 0).map(({ item, quantity }) => ({ orderItemId: item.orderItemId, quantity }))
    create.mutate({
      items,
      shippingRefund: shippingValue,
      adjustment: adjustmentValue,
      restock,
      note: note.trim() || undefined,
      notifyCustomer: notify,
      ...(prefill?.returnNumber && { returnNumber: prefill.returnNumber }),
    })
  }

  const totalError = errors.total?.[0] ?? errors.items?.[0]
  return (
    <FormDialog
      isOpen
      wide
      title={prefill?.returnNumber ? `Refund return ${prefill.returnNumber}` : `Refund order ${order.number}`}
      description={prefill?.returnNumber ? `${refundDescription(order)} Filled in with the returned items of order ${order.number}.` : refundDescription(order)}
      submitLabel={`Refund ${formatMoney(Math.max(totalCents, 0) / 100)}`}
      busy={create.isPending}
      error={formError(create.error, ['items', 'shippingRefund', 'adjustment', 'restock', 'note', 'total'])}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <table className="table refund-table">
        <caption className="visually-hidden">Items to refund</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">
              Ordered
            </th>
            <th scope="col" className="num">
              Refunded
            </th>
            <th scope="col" className="num">
              Per unit
            </th>
            <th scope="col" className="num">
              Refund qty
            </th>
          </tr>
        </thead>
        <tbody>
          {limits.items.map((item) => {
            const key = `item-${item.orderItemId}`
            const error = errors[key]?.[0]
            const id = `refund-qty-${item.orderItemId}`
            return (
              <tr key={item.orderItemId}>
                <th scope="row">
                  {item.name}
                  {item.variantLabel && ` (${item.variantLabel})`}
                  {item.sku && <small className="muted"> · {item.sku}</small>}
                  {error && (
                    <span id={`${id}-error`} className="field__error">
                      {error}
                    </span>
                  )}
                </th>
                <td className="num">{item.ordered}</td>
                <td className="num">{item.refunded}</td>
                <td className="num">{formatMoney(item.unitRefund)}</td>
                <td className="num">
                  <label htmlFor={id} className="visually-hidden">
                    Quantity of {item.variantLabel ? `${item.name} (${item.variantLabel})` : item.name} to refund (up to {item.refundable})
                  </label>
                  <input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max={item.refundable}
                    step="1"
                    placeholder="0"
                    disabled={item.refundable === 0}
                    value={quantities[item.orderItemId]}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(event) => setQuantities((current) => ({ ...current, [item.orderItemId]: event.target.value }))}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="form__grid">
        <Field label="Shipping refund (USD)" error={errors.shippingRefund?.[0]} hint={`Up to ${formatMoney(limits.shippingRefundable)}.`}>
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" step="0.01" min="0" max={limits.shippingRefundable} placeholder="0.00" value={shipping} onChange={(event) => setShipping(event.target.value)} />}
        </Field>
        <Field label="Adjustment (USD)" error={errors.adjustment?.[0]} hint="Extra amount to refund; negative to keep a fee (e.g. -5.00).">
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={adjustment} onChange={(event) => setAdjustment(event.target.value)} />}
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={restock} onChange={(event) => setRestock(event.target.checked)} />
        Return the refunded items to stock
      </label>
      {prefill?.returnNumber && prefill.alreadyRestocked && <p className="field__hint">The return already put its items back into stock when it was received; they won't be added twice.</p>}
      <NoteAndEmail note={note} setNote={setNote} notify={notify} setNotify={setNotify} error={errors.note?.[0]} emailLabel="Email the customer about the refund" />
      {/* Live total: announced politely as it changes. */}
      <p className="refund-total" aria-live="polite">
        <span>Estimated total to refund</span>
        <span>
          {formatMoney(totalCents / 100)} <span className="muted">of {formatMoney(limits.maxTotal)} left</span>
        </span>
      </p>
      <p className="field__hint">{ESTIMATE_NOTE}</p>
      {totalError && (
        <p id="refund-total-error" className="field__error" role="alert">
          {totalError}
        </p>
      )}
    </FormDialog>
  )
}

const DEFAULT_REASONS = ['Damaged', 'Wrong item', 'Not as described', 'No longer needed', 'Other']

/**
 * Create a return for a customer (returns.manage), from the order: which
 * items and how many, the reason, and a comment. The store's rules apply
 * (shipped or delivered, quantities not already returned or refunded); an
 * admin may override the return window.
 */
export function CreateReturnDialog({ order, onDone, onCancel }) {
  const { can } = useAdminAuth()
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: ({ signal }) => getSettings({ signal }), enabled: can('settings.view'), staleTime: 60_000 })
  const eligibility = order.returnEligibility
  const reasons = eligibility?.reasons?.length ? eligibility.reasons : settings.data?.returns?.returnReasons?.length ? settings.data.returns.returnReasons : DEFAULT_REASONS
  // What the server says is still returnable per line (shipped, minus returned or refunded).
  const lines = (eligibility?.items ?? []).map((item) => ({ orderItemId: item.orderItemId, title: item.name, variantLabel: item.variantLabel, sku: item.sku, quantity: item.ordered, returnable: item.returnable }))
  const windowClosed = eligibility?.code === 'window_closed'
  const [quantities, setQuantities] = useState(() => Object.fromEntries(lines.map((line) => [line.orderItemId, ''])))
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [overrideWindow, setOverrideWindow] = useState(windowClosed)
  const [notify, setNotify] = useState(true)
  const [errors, setErrors] = useState({})
  const create = useMutation({
    mutationFn: (values) => createReturn(order.number, values),
    onSuccess: (result) => onDone(`${result.return?.number ? `Return ${result.return.number}` : 'A return'} created for order ${order.number}.${notify ? ' The customer was emailed.' : ''}`),
    onError: (error, sent) => {
      const mapped = {}
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        const match = /^items\.(\d+)\./.exec(field)
        const item = match && sent.items[Number(match[1])]
        mapped[item ? `item-${item.orderItemId}` : field] = messages
      }
      setErrors(mapped)
    },
  })

  function submit() {
    const found = {}
    const items = []
    for (const line of lines) {
      const text = quantities[line.orderItemId]
      if (text.trim() === '') continue
      const quantity = Number(text)
      if (!Number.isInteger(quantity) || quantity < 0) found[`item-${line.orderItemId}`] = ['Enter a whole number.']
      else if (quantity > line.returnable) found[`item-${line.orderItemId}`] = [line.returnable === 0 ? 'Nothing left to return.' : `At most ${line.returnable} can be returned.`]
      else if (quantity > 0) items.push({ orderItemId: line.orderItemId, quantity })
    }
    if (items.length === 0 && Object.keys(found).length === 0) found.items = ['Enter how many of at least one item come back.']
    if (!reason) found.reason = ['Choose a reason.']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    create.mutate({ items, reason, comment: comment.trim() || undefined, overrideWindow, notifyCustomer: notify })
  }

  return (
    <FormDialog
      isOpen
      wide
      title={`Create a return for order ${order.number}`}
      description={
        windowClosed && eligibility?.message
          ? `${eligibility.message} As staff you can still create it.`
          : 'Only shipped items can be returned, and not more than were shipped, already returned, or refunded.'
      }
      submitLabel="Create return"
      busy={create.isPending}
      error={formError(create.error, ['items', 'reason', 'comment', 'overrideWindow'])}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {lines.length === 0 ? (
        <p className="muted">{eligibility?.message ?? 'Nothing on this order can be returned.'}</p>
      ) : (
        <table className="table refund-table">
          <caption className="visually-hidden">Items to return</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Ordered
              </th>
              <th scope="col" className="num">
                Returnable
              </th>
              <th scope="col" className="num">
                Return qty
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const key = `item-${line.orderItemId}`
              const error = errors[key]?.[0]
              const id = `return-qty-${line.orderItemId}`
              const name = line.variantLabel ? `${line.title} (${line.variantLabel})` : line.title
              return (
                <tr key={line.orderItemId}>
                  <th scope="row">
                    {name}
                    {line.sku && <small className="muted"> · {line.sku}</small>}
                    {error && (
                      <span id={`${id}-error`} className="field__error">
                        {error}
                      </span>
                    )}
                  </th>
                  <td className="num">{line.quantity}</td>
                  <td className="num">{line.returnable}</td>
                  <td className="num">
                    <label htmlFor={id} className="visually-hidden">
                      Quantity of {name} to return (up to {line.returnable})
                    </label>
                    <input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={line.returnable}
                      step="1"
                      placeholder="0"
                      disabled={line.returnable === 0}
                      value={quantities[line.orderItemId]}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                      onChange={(event) => setQuantities((current) => ({ ...current, [line.orderItemId]: event.target.value }))}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {errors.items && (
        <p className="field__error" role="alert">
          {errors.items[0]}
        </p>
      )}
      <Field label="Reason" error={errors.reason?.[0]}>
        {(a11y) => (
          <select {...a11y} value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="">Choose…</option>
            {reasons.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Comment (optional)" error={errors.comment?.[0]} hint="What the customer said; they can see it.">
        {(a11y) => <textarea {...a11y} rows={2} maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} />}
      </Field>
      {windowClosed && (
        <label className="checkbox">
          <input type="checkbox" checked={overrideWindow} onChange={(event) => setOverrideWindow(event.target.checked)} />
          Allow it although the return window has passed
        </label>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
        Email the customer about the return
      </label>
    </FormDialog>
  )
}
