import { useState } from 'react'
import { LuBan, LuCheck, LuCopy, LuExternalLink, LuTriangleAlert, LuTruck, LuUndo2 } from 'react-icons/lu'
import Button from '../ui/Button'
import { cn } from '../../utils/classNames'
import { formatDate, formatDateTime } from '../../utils/formatters'
import { DELIVERY_STEPS, DELIVERY_STOPPED, deliveryStatusLabel, deliveryStepIndex, isCourierShipment } from '../../utils/delivery'
import './DeliveryTracker.css'
import { useTranslation } from 'react-i18next'

/*
 * Phase 18 (docs/backend/PHASE18_CONTRACT.md §3): a courier shipment's delivery
 * progress on the order page and the guest order lookup.
 *
 *   Booked → Picked up → On the way → Out for delivery → Delivered
 *
 * An ordered list with aria-current="step" on where the parcel is now (on
 * hold: the last step it reached, with the notice below); each
 * step also says "done" in words and shows a tick, so colour is never the only
 * signal. On hold, partly delivered, returned and cancelled are not steps: they
 * show as a notice (returned and cancelled without the steps, since the parcel
 * is no longer on its way). Manual shipments (`shipped`, or no delivery status
 * from older answers) look as before: carrier, tracking number and the
 * carrier's tracking link.
 */

const NOTICE_ICONS = { on_hold: LuTriangleAlert, partly_delivered: LuTriangleAlert, returned: LuUndo2, cancelled: LuBan }

function Steps({ shipment }) {
  const { t } = useTranslation('orders')
  const current = deliveryStepIndex(shipment)
  return (
    <ol className="delivery-tracker__steps" aria-label={t('delivery.progress')}>
      {DELIVERY_STEPS.map((step, index) => {
        // Delivered is the end: its step is done too. Elsewhere the current step is "now", earlier ones are done.
        const isDone = index < current || (index === current && step === 'delivered')
        const isCurrent = index === current
        return (
          <li
            key={step}
            className={cn('delivery-tracker__step', isDone && 'delivery-tracker__step--done', isCurrent && 'delivery-tracker__step--current')}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className="delivery-tracker__dot" aria-hidden="true">
              {isDone ? <LuCheck /> : isCurrent ? <LuTruck /> : null}
            </span>
            <span className="delivery-tracker__step-label">
              {t(`delivery.steps.${step}`)}
              {isDone && !isCurrent && <span className="visually-hidden">{t('delivery.stepDone')}</span>}
              {isCurrent && step !== 'delivered' && <span className="delivery-tracker__now">{t('delivery.now')}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Notice({ status }) {
  const { t } = useTranslation('orders')
  const Icon = NOTICE_ICONS[status]
  if (!Icon) return null
  return (
    <div className={cn('delivery-tracker__notice', DELIVERY_STOPPED.includes(status) && 'delivery-tracker__notice--stopped')}>
      <Icon aria-hidden="true" />
      <p>
        <strong>{t(`delivery.statuses.${status}`)}</strong> {t(`delivery.notice.${status}`)}
      </p>
    </div>
  )
}

/** The tracking code with a Copy button (falls back to selecting the code when the clipboard is unavailable). */
function TrackingCode({ code }) {
  const { t } = useTranslation('orders')
  const [message, setMessage] = useState('')
  async function copy(event) {
    const codeElement = event.currentTarget.closest('.delivery-tracker__code')?.querySelector('code')
    try {
      await navigator.clipboard.writeText(code)
      setMessage(t('delivery.copied'))
    } catch {
      if (codeElement) window.getSelection()?.selectAllChildren(codeElement)
      setMessage(t('delivery.copyFailed'))
    }
  }
  return (
    <div className="delivery-tracker__code">
      <p>
        {t('delivery.trackingCode')}{' '}
        <code translate="no">{code}</code>
      </p>
      <Button variant="outline" size="sm" onClick={copy}>
        <LuCopy aria-hidden="true" /> {t('delivery.copy')}
      </Button>
      <span className="delivery-tracker__copied" role="status">
        {message}
      </span>
    </div>
  )
}

/** The courier's updates, newest first, each with its localised date and time. */
function Updates({ events }) {
  const { t } = useTranslation('orders')
  const newestFirst = [...(events ?? [])].reverse()
  return (
    <>
      <h4 className="delivery-tracker__subheading">{t('delivery.updates')}</h4>
      {newestFirst.length === 0 ? (
        <p className="order-view__muted">{t('delivery.noUpdates')}</p>
      ) : (
        <ul className="delivery-tracker__events">
          {newestFirst.map((event, index) => (
            <li key={`${event.occurredAt}-${index}`}>
              <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
              <span>
                <strong>{deliveryStatusLabel(event.deliveryStatus, event.label)}</strong>
                {event.message && <> · {event.message}</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** One shipment: a courier's tracker, or the manual shipment as before. */
function DeliveryTracker({ shipment }) {
  const { t } = useTranslation('orders')

  if (!isCourierShipment(shipment)) {
    return (
      <>
        <p>
          <strong>{shipment.carrierLabel}</strong>
          {shipment.trackingNumber ? t('view.tracking', { number: shipment.trackingNumber }) : t('view.noTracking')}
        </p>
        <p className="order-view__muted">{t('view.shippedOn', { date: formatDate(shipment.createdAt) })}</p>
        {shipment.trackingUrl && (
          // noopener: the carrier's page can't reach back into this tab.
          <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="order-view__link">
            {t('view.trackWith', { carrier: shipment.carrierLabel })} <LuExternalLink aria-hidden="true" />
            <span className="visually-hidden">{t('view.newTab')}</span>
          </a>
        )}
      </>
    )
  }

  const status = shipment.deliveryStatus
  return (
    <div className="delivery-tracker">
      <p className="order-view__row">
        <strong>{t('delivery.courier', { courier: shipment.carrierLabel })}</strong>
        <span className={cn('delivery-tracker__status', `delivery-tracker__status--${status}`)}>{t('delivery.status', { status: deliveryStatusLabel(status, shipment.deliveryStatusLabel) })}</span>
      </p>
      {!DELIVERY_STOPPED.includes(status) && <Steps shipment={shipment} />}
      <Notice status={status} />
      {shipment.trackingNumber && <TrackingCode code={shipment.trackingNumber} />}
      {shipment.trackingUrl && (
        // External courier page: noopener so it can't reach back into this tab.
        <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="order-view__link">
          {t('delivery.trackOn', { courier: shipment.carrierLabel })} <LuExternalLink aria-hidden="true" />
          <span className="visually-hidden">{t('view.newTab')}</span>
        </a>
      )}
      <Updates events={shipment.events} />
    </div>
  )
}

export default DeliveryTracker
