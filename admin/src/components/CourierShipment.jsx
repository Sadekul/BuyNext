import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { LuExternalLink, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu'
import { syncShipment } from '../api/phase18'
import CopyButton from './CopyButton'
import StatusBadge from './StatusBadge'
import { formatDateTime, formatMoney } from '../utils/format'
import { NEXT_STEPS, deliveryStatus } from '../utils/couriers'
import { actionErrorMessage } from '../utils/permissions'

/*
 * Phase 18 §2: a parcel booked with a courier, on the order page: the
 * courier, consignment and tracking code (Copy, the courier's tracking page),
 * the delivery status (icon + words), the cash to collect, the courier's fee
 * and the cash it collected, when it last changed, "Refresh status" (asks
 * the courier now), and the timeline, newest first. A returned, cancelled,
 * partly delivered or held parcel gets a callout with what to do next.
 */

const SOURCES = { booking: 'booked from the admin', webhook: 'reported by the courier', sync: 'checked with the courier', staff: 'recorded by staff' }
const newestFirst = (events) => [...events].sort((a, b) => String(b.occurredAt ?? '').localeCompare(String(a.occurredAt ?? '')))
const amount = (value, currency) => (typeof value === 'number' ? formatMoney(value, currency) : '—')

function CourierShipment({ order, shipment, canRefresh, onRefreshed }) {
  const courier = shipment.courier
  const [announcement, setAnnouncement] = useState('')
  const status = courier.deliveryStatus ?? shipment.deliveryStatus
  const badge = deliveryStatus(status, courier.deliveryStatusLabel ?? shipment.deliveryStatusLabel)
  const refresh = useMutation({
    mutationFn: () => syncShipment(shipment.number),
    onSuccess: ({ shipment: fresh }) => {
      const next = fresh?.courier ? deliveryStatus(fresh.courier.deliveryStatus, fresh.courier.deliveryStatusLabel) : badge
      setAnnouncement(`${courier.label} says: ${next.label}.`)
      onRefreshed?.()
    },
    onError: () => setAnnouncement(''),
  })
  const titleId = `courier-${shipment.number}`
  const trackingCode = courier.trackingCode ?? shipment.trackingNumber
  const events = newestFirst(shipment.events ?? [])
  const callout = NEXT_STEPS[status]

  return (
    <section className="panel courier-shipment" aria-labelledby={titleId}>
      <h2 id={titleId} className="panel__title">
        {courier.label} parcel <span className="muted">· {shipment.number}</span>
      </h2>
      <div className="courier-shipment__body">
        <p className="courier-shipment__status">
          <StatusBadge {...badge} />
          {courier.courierStatus && <span className="muted"> {courier.label}: “{courier.courierStatus}”</span>}
        </p>
        {callout && (
          <div className="courier-callout" role="note" aria-label={`${badge.label}: what to do next`}>
            <LuTriangleAlert aria-hidden="true" />
            <p>
              <strong>{badge.label}.</strong> {callout}
            </p>
          </div>
        )}
        <dl className="details courier-shipment__details">
          {courier.consignmentId && (
            <>
              <dt>Consignment</dt>
              <dd className="courier-shipment__code">
                <code>{courier.consignmentId}</code>
                <CopyButton value={courier.consignmentId} name={`consignment ID ${courier.consignmentId}`} />
              </dd>
            </>
          )}
          {trackingCode && (
            <>
              <dt>Tracking code</dt>
              <dd className="courier-shipment__code">
                <code>{trackingCode}</code>
                <CopyButton value={trackingCode} name={`tracking code ${trackingCode}`} />
                {shipment.trackingUrl && (
                  <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="external-link">
                    Track on {courier.label} <LuExternalLink aria-hidden="true" />
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                )}
              </dd>
            </>
          )}
          <dt>Cash to collect</dt>
          <dd>{amount(courier.codAmount, order.currency)}</dd>
          <dt>Courier fee</dt>
          <dd>{typeof courier.courierFee === 'number' ? formatMoney(courier.courierFee, order.currency) : <span className="muted">Not reported yet</span>}</dd>
          <dt>Collected</dt>
          <dd>{typeof courier.collected === 'number' ? formatMoney(courier.collected, order.currency) : <span className="muted">Nothing reported yet</span>}</dd>
          <dt>Last update</dt>
          <dd>
            {courier.statusUpdatedAt ? <time dateTime={courier.statusUpdatedAt}>{formatDateTime(courier.statusUpdatedAt)}</time> : '—'}
            {courier.lastSyncedAt && (
              <span className="muted">
                {' '}
                · checked <time dateTime={courier.lastSyncedAt}>{formatDateTime(courier.lastSyncedAt)}</time>
              </span>
            )}
          </dd>
        </dl>
        <div className="courier-shipment__actions">
          {canRefresh && courier.bookedViaApi && (
            <button
              type="button"
              className="btn btn--outline btn--sm"
              aria-label={refresh.isPending ? undefined : `Refresh status of ${shipment.number}`}
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              <LuRefreshCw aria-hidden="true" /> {refresh.isPending ? 'Asking the courier…' : 'Refresh status'}
            </button>
          )}
          <Link to={`/shipments/${shipment.number}`} className="btn btn--outline btn--sm" aria-label={`Shipment page ${shipment.number}`}>
            Shipment page
          </Link>
        </div>
        <p role="status" className="field__hint courier-shipment__announce">
          {announcement}
        </p>
        {refresh.error && (
          <p className="field__error" role="alert">
            {refresh.error.fieldErrors ? Object.values(refresh.error.fieldErrors)[0][0] : actionErrorMessage(refresh.error)}
          </p>
        )}
        <h3 className="courier-shipment__subtitle" id={`${titleId}-events`}>
          Tracking history
        </h3>
        {events.length > 0 ? (
          <ol className="history courier-timeline" aria-labelledby={`${titleId}-events`}>
            {events.map((event, index) => (
              <li key={`${event.occurredAt}-${index}`}>
                <div className="history__head">
                  <StatusBadge {...deliveryStatus(event.deliveryStatus, event.label)} />
                </div>
                <p className="muted">
                  {event.occurredAt && <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>}
                  {SOURCES[event.source] && ` · ${SOURCES[event.source]}`}
                  {event.courierStatus && ` · “${event.courierStatus}”`}
                </p>
                {event.message && <p>{event.message}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No updates from the courier yet.</p>
        )}
      </div>
    </section>
  )
}

export default CourierShipment
