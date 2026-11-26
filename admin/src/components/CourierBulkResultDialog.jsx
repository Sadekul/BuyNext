import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router'
import { LuCircleCheck, LuCircleX } from 'react-icons/lu'
import { formatCount } from '../utils/format'

const orders = (count) => `${formatCount(count)} ${count === 1 ? 'order' : 'orders'}`

/**
 * Phase 18 §2: what "Book with Steadfast" did on the order grid: each order
 * booked (consignment and tracking code) and each one the courier or the
 * store refused, with the reason. A native modal <dialog>: focus stays
 * inside, Escape or Close ends it.
 */
function CourierBulkResultDialog({ courier = 'Steadfast', result, onClose }) {
  const ref = useRef(null)
  const titleId = useId()
  const summaryId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog.open) dialog.showModal()
  }, [])

  const { booked, failed } = result
  return (
    <dialog ref={ref} className="confirm form-dialog form-dialog--wide courier-results" aria-labelledby={titleId} aria-describedby={summaryId} onClose={onClose}>
      <h2 id={titleId}>{courier} booking results</h2>
      <p id={summaryId}>
        {orders(booked.length)} booked with {courier}
        {failed.length > 0 ? `; ${orders(failed.length)} not booked.` : '.'}
      </p>
      {booked.length > 0 && (
        <section aria-labelledby={`${titleId}-booked`}>
          <h3 id={`${titleId}-booked`} className="courier-results__title">
            <LuCircleCheck aria-hidden="true" /> Booked ({formatCount(booked.length)})
          </h3>
          <ul className="courier-results__list">
            {booked.map((entry) => (
              <li key={entry.number}>
                <Link to={`/orders/${entry.number}`}>{entry.number}</Link>
                {entry.consignmentId && <> · consignment {entry.consignmentId}</>}
                {entry.trackingCode && <> · tracking code {entry.trackingCode}</>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed.length > 0 && (
        <section aria-labelledby={`${titleId}-failed`}>
          <h3 id={`${titleId}-failed`} className="courier-results__title courier-results__title--failed">
            <LuCircleX aria-hidden="true" /> Not booked ({formatCount(failed.length)})
          </h3>
          <ul className="courier-results__list">
            {failed.map((entry) => (
              <li key={entry.number}>
                <Link to={`/orders/${entry.number}`}>{entry.number}</Link>: {entry.message}
              </li>
            ))}
          </ul>
          <p className="field__hint">Fix each one on its order page, then book it there (or ship it by hand).</p>
        </section>
      )}
      <div className="confirm__actions">
        <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </dialog>
  )
}

export default CourierBulkResultDialog
