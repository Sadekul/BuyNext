import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { bulkOrders } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import { formatCount } from '../utils/format'
import { CARRIERS } from '../utils/orders'
import { actionErrorMessage } from '../utils/permissions'
import ConfirmDialog from './ConfirmDialog'
// Phase 14 §5: packing slips as one PDF, and the courier CSV.
import { downloadCourierCsv, downloadPackingSlips } from '../api/phase14'
// Phase 18 §2: book the selected orders with Steadfast (Pathao needs a city and zone per order).
import { bookCourierMany, getCouriers, phase18Keys } from '../api/phase18'

// The order grid's mass actions (docs/backend/PHASE6_CONTRACT.md §7) and the permission each needs.
const ACTIONS = [
  { id: 'invoice', label: 'Invoice', permission: 'invoices.create' },
  { id: 'ship', label: 'Ship…', permission: 'shipments.create' },
  { id: 'cancel', label: 'Cancel', permission: 'orders.edit' },
  { id: 'print-invoices', label: 'Print invoices', permission: 'orders.view' },
  { id: 'print-packing-slips', label: 'Print packing slips', permission: 'orders.view' },
  // Phase 14 §5: files to download (BuyNest's backend makes them).
  { id: 'packing-slips-pdf', label: 'Packing slips (PDF)', permission: 'orders.view' },
  { id: 'courier-csv', label: 'Courier CSV', permission: 'orders.view' },
  // Phase 18 §2: only once Steadfast is set up.
  { id: 'book-steadfast', label: 'Book with Steadfast', permission: 'shipments.create', courier: 'steadfast' },
]
const MAX_BOOKINGS = 50
const DOWNLOADS = {
  'packing-slips-pdf': { run: downloadPackingSlips, done: (name) => `Packing slips downloaded (${name}).` },
  'courier-csv': { run: downloadCourierCsv, done: (name) => `Courier CSV downloaded (${name}).` },
}
const DONE = { invoice: 'invoiced', ship: 'shipped', cancel: 'cancelled' }
const plural = (count) => `${formatCount(count)} ${count === 1 ? 'order' : 'orders'}`

/**
 * The bar above the order grid once orders are ticked. Invoice, ship, and
 * cancel go to the server, which handles each order on its own: some may be
 * done and others skipped (with the reason), passed to `onDone`. The print
 * actions open a print page for the selected orders.
 */
function OrderBulkActions({ selected, onDone, onClear, onDownloaded, onBooked }) {
  const { can } = useAdminAuth()
  const navigate = useNavigate()
  const id = useId()
  // Phase 18: which couriers are set up (the list is shared with the order page).
  const couriers = useQuery({ queryKey: phase18Keys.couriers, queryFn: ({ signal }) => getCouriers({ signal }), enabled: can('shipments.create'), staleTime: 60_000, retry: false })
  const configured = (key) => Boolean(couriers.data?.couriers?.some((courier) => courier.key === key && courier.configured))
  const actions = ACTIONS.filter((action) => can(action.permission) && (!action.courier || configured(action.courier)))
  const [action, setAction] = useState('')
  const [carrier, setCarrier] = useState('')
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(false)

  const download = useMutation({
    mutationFn: (id) => DOWNLOADS[id].run(selected),
    onSuccess: (file, id) => onDownloaded?.(DOWNLOADS[id].done(file.name)),
    onError: (failure) => setError(failure.fieldErrors ? { message: Object.values(failure.fieldErrors)[0][0] } : failure),
  })

  const run = useMutation({
    mutationFn: () => bulkOrders(selected, action, { ...(action === 'ship' && { carrier }), notifyCustomer: notify }),
    onSuccess: (result) => {
      setConfirming(false)
      onDone({ action, verb: DONE[action], done: result.done ?? [], skipped: result.skipped ?? [] })
      setAction('')
    },
    onError: (failure) => {
      setConfirming(false)
      setError(failure.fieldErrors ? { message: Object.values(failure.fieldErrors)[0][0] } : failure)
    },
  })

  const book = useMutation({
    mutationFn: () => bookCourierMany(selected, 'steadfast'),
    onSuccess: (result) => {
      setAction('')
      onBooked?.({ courier: 'Steadfast', booked: result.booked ?? [], failed: result.failed ?? [] })
    },
    onError: (failure) => setError(failure.fieldErrors ? { message: Object.values(failure.fieldErrors)[0][0] } : failure),
  })

  function apply(event) {
    event.preventDefault()
    setError(null)
    if (!action) return setError({ message: 'Choose an action.' })
    if (action.startsWith('print-')) return navigate(`/print/${action.slice(6)}?orders=${encodeURIComponent(selected.join(','))}`)
    if (DOWNLOADS[action]) return download.mutate(action)
    if (action === 'book-steadfast') return selected.length > MAX_BOOKINGS ? setError({ message: `Book at most ${MAX_BOOKINGS} orders at a time.` }) : book.mutate()
    if (action === 'ship' && !carrier) return setError({ message: 'Choose a carrier.' })
    if (action === 'cancel') return setConfirming(true)
    run.mutate()
  }

  const sendsEmail = ['invoice', 'ship', 'cancel'].includes(action)
  return (
    <form className="bulk-bar" aria-labelledby={`${id}-title`} onSubmit={apply} noValidate>
      <p id={`${id}-title`} className="bulk-bar__count">
        <strong>{formatCount(selected.length)}</strong> selected
      </p>
      <label className="toolbar__select">
        <span>Action</span>
        <select
          value={action}
          onChange={(event) => {
            setAction(event.target.value)
            setError(null)
          }}
        >
          <option value="">Choose…</option>
          {actions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {action === 'ship' && (
        <label className="toolbar__select">
          <span>Carrier</span>
          <select value={carrier} onChange={(event) => setCarrier(event.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(CARRIERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {sendsEmail && (
        <label className="checkbox bulk-bar__check">
          <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
          Email the customers
        </label>
      )}
      <button type="submit" className="btn btn--primary btn--sm" disabled={run.isPending || download.isPending || book.isPending}>
        {run.isPending ? 'Applying…' : download.isPending ? 'Preparing the file…' : book.isPending ? 'Booking with Steadfast…' : 'Apply'}
      </button>
      <button type="button" className="btn btn--outline btn--sm" onClick={onClear}>
        Clear selection
      </button>
      {action === 'ship' && <p className="field__hint bulk-bar__hint">Ships every item still to ship, without a tracking number. Add tracking on each order if you have it.</p>}
      {action === 'courier-csv' && (
        <p className="field__hint bulk-bar__hint">
          One row per order: invoice, recipient, mobile, address, district, area, cash to collect, weight, note. UTF-8, opens in Excel with Bangla.
        </p>
      )}
      {action === 'book-steadfast' && (
        <p className="field__hint bulk-bar__hint">
          Books each order with Steadfast on its own (up to {MAX_BOOKINGS}), with the cash to collect, weight, and note the order page would suggest; customers get the tracking details by email. Orders that can’t be booked (not
          confirmed by phone, no mobile number…) are listed with the reason; book those from their page.
        </p>
      )}
      <div role="alert" className="bulk-bar__error">
        {error && <p className="form-error">{actionErrorMessage(error)}</p>}
      </div>
      <ConfirmDialog
        isOpen={confirming}
        title={`Cancel ${plural(selected.length)}?`}
        message="Orders that can still be cancelled are cancelled and their items go back into stock; paid or shipped orders are skipped. This can't be undone."
        confirmLabel={`Cancel ${plural(selected.length)}`}
        busy={run.isPending}
        onConfirm={() => run.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </form>
  )
}

export default OrderBulkActions
