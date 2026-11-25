import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LuMapPin } from 'react-icons/lu'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { areasQuery, deliveryEstimateQuery, districtsQuery, divisionsQuery } from '../../queries/placesQueries'
import { etaText, placeName, zoneName } from '../../utils/bangladesh'
import { clearDeliverTo, deliverToPlace, saveDeliverTo, useDeliverTo } from '../../utils/deliverTo'
import { formatPrice } from '../../utils/formatters'
import { cn } from '../../utils/classNames'
import { translate } from '../../i18n'
import './DeliverTo.css'

/**
 * Phase 17 "Deliver to" button (header). Its accessible name starts with the
 * visible text: "Deliver to: Banani, Dhaka" or "Deliver to: Choose your area".
 * Only rendered by the header when the store uses Bangladesh addresses.
 */
export function DeliverToButton({ onClick, isOpen = false, className }) {
  const { t } = useTranslation('common')
  const choice = useDeliverTo()
  const value = choice ? deliverToPlace(choice) : t('deliverTo.chooseArea')
  return (
    <button
      type="button"
      className={cn('deliver-to', className)}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-label={`${t('deliverTo.title')}: ${value}`}
    >
      <LuMapPin aria-hidden="true" className="deliver-to__icon" />
      <span className="deliver-to__text">
        <span className="deliver-to__label">{t('deliverTo.title')}</span>
        <span className="deliver-to__value">{value}</span>
      </span>
    </button>
  )
}

/**
 * The "Deliver to" dialog: Division → District → Area (the phase 14 place
 * lists), then the zone, delivery charges and days, and cash on delivery for
 * that area (GET /delivery/estimate). "Deliver here" remembers it in this
 * browser (it pre-fills the checkout's empty Bangladesh address); a saved
 * area opens as a summary with "Change" and "Clear".
 */
export function DeliverToDialog({ isOpen, onClose }) {
  const { t } = useTranslation('common')
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('deliverTo.title')}>
      {/* A fresh panel per opening: an unsaved draft doesn't come back. */}
      {isOpen && <DeliverToPanel onDone={onClose} />}
    </Modal>
  )
}

function DeliverToPanel({ onDone }) {
  const { t } = useTranslation('common')
  const choice = useDeliverTo()
  const [editing, setEditing] = useState(!choice)
  const [draft, setDraft] = useState(() => ({ divisionId: choice?.divisionId ?? '', districtId: choice?.districtId ?? '', areaId: choice?.areaId ?? '' }))
  const [status, setStatus] = useState('')
  const panelRef = useRef(null)
  const switched = useRef(false)

  // "Change" or "Clear" swap the buttons for the pickers: focus moves to the first one (not lost on the page).
  useEffect(() => {
    if (editing && switched.current) panelRef.current?.querySelector('select')?.focus()
  }, [editing])

  function startEditing() {
    switched.current = true
    setEditing(true)
  }

  const divisions = useQuery({ ...divisionsQuery(), enabled: editing })
  const districts = useQuery({ ...districtsQuery(draft.divisionId), enabled: editing && Boolean(draft.divisionId) })
  const areas = useQuery({ ...areasQuery(draft.districtId), enabled: editing && Boolean(draft.districtId) })

  const find = (list, id) => list?.find((place) => String(place.id) === String(id)) ?? null
  const division = find(divisions.data, draft.divisionId)
  const district = find(districts.data, draft.districtId)
  const area = find(areas.data, draft.areaId)

  function save() {
    if (!division || !district || !area) return
    const saved = saveDeliverTo({ ...draft, division, district, area })
    if (saved) onDone()
  }

  function clear() {
    clearDeliverTo()
    setDraft({ divisionId: '', districtId: '', areaId: '' })
    startEditing()
    setStatus(t('deliverTo.cleared'))
  }

  return (
    <div className="deliver-to-panel" ref={panelRef}>
      {editing ? (
        <>
          <p className="deliver-to-panel__intro">{t('deliverTo.intro')}</p>
          <div className="deliver-to-panel__fields">
            <PlacePicker
              label={t('bdAddress.division')}
              placeholder={t('bdAddress.chooseDivision')}
              request={divisions}
              value={draft.divisionId}
              onChange={(id) => setDraft({ divisionId: id, districtId: '', areaId: '' })}
            />
            <PlacePicker
              label={t('bdAddress.district')}
              placeholder={draft.divisionId ? t('bdAddress.chooseDistrict') : t('bdAddress.divisionFirst')}
              request={districts}
              disabled={!draft.divisionId}
              value={draft.districtId}
              onChange={(id) => setDraft((current) => ({ ...current, districtId: id, areaId: '' }))}
            />
            <PlacePicker
              label={t('bdAddress.area')}
              placeholder={draft.districtId ? t('bdAddress.chooseArea') : t('bdAddress.districtFirst')}
              request={areas}
              disabled={!draft.districtId}
              value={draft.areaId}
              onChange={(id) => setDraft((current) => ({ ...current, areaId: id }))}
            />
          </div>
          {area && <DeliveryEstimate areaId={draft.areaId} place={[placeName(area), placeName(district)].filter(Boolean).join(', ')} />}
          <div className="deliver-to-panel__actions">
            <Button onClick={save} disabled={!area}>
              {t('deliverTo.save')}
            </Button>
          </div>
          {area && <p className="deliver-to-panel__note">{t('deliverTo.checkoutNote')}</p>}
        </>
      ) : (
        <>
          <DeliveryEstimate areaId={choice.areaId} place={deliverToPlace(choice)} />
          <p className="deliver-to-panel__note">{t('deliverTo.checkoutNote')}</p>
          <div className="deliver-to-panel__actions">
            <Button onClick={startEditing}>{t('deliverTo.change')}</Button>
            <Button variant="outline" onClick={clear}>
              {t('deliverTo.clear')}
            </Button>
          </div>
        </>
      )}
      <p className="visually-hidden" role="status">
        {status}
      </p>
    </div>
  )
}

/** One <select> of places (null data while it loads; a failed list offers "Try again"). */
function PlacePicker({ label, placeholder, request, value, onChange, disabled = false }) {
  const { t } = useTranslation('common')
  const id = useId()
  const places = request.data ?? []
  const loading = !disabled && request.isPending && request.fetchStatus !== 'idle'
  return (
    <div className="form-field">
      <label htmlFor={id} className="form-field__label">
        {label}
      </label>
      <select id={id} className="form-field__input form-field__select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{loading ? t('bdAddress.loading') : placeholder}</option>
        {places.map((place) => (
          <option key={place.id} value={String(place.id)}>
            {placeName(place)}
          </option>
        ))}
      </select>
      {request.isError && (
        <div className="bd-address__failed" role="alert">
          <p>{t('bdAddress.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => request.refetch()}>
            {t('bdAddress.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** "Delivering to Banani, Dhaka": zone, each delivery option's charge and days, free delivery, cash on delivery. */
export function DeliveryEstimate({ areaId, place }) {
  const { t } = useTranslation('common')
  const request = useQuery(deliveryEstimateQuery(areaId))
  const headingId = useId()

  return (
    <section className="deliver-to-estimate" aria-labelledby={headingId}>
      <h3 id={headingId} className="deliver-to-estimate__title">
        {t('deliverTo.current', { place })}
      </h3>
      {request.isPending ? (
        <p role="status">{t('deliverTo.loading')}</p>
      ) : request.isError ? (
        <div role="alert" className="deliver-to-estimate__failed">
          <p>{request.error?.status === 422 && request.error.message ? request.error.message : t('deliverTo.failed')}</p>
          <Button variant="outline" size="sm" onClick={() => request.refetch()}>
            {t('bdAddress.retry')}
          </Button>
        </div>
      ) : (
        <EstimateDetails estimate={request.data} />
      )}
    </section>
  )
}

function EstimateDetails({ estimate }) {
  const { t } = useTranslation('common')
  const { zone, methods, freeShippingThreshold, cod } = estimate
  return (
    <>
      {zone && <p className="deliver-to-estimate__zone">{translate('checkout:delivery.zone', { zone: zoneName(zone) })}</p>}
      {methods.length > 0 && (
        <ul className="deliver-to-estimate__methods" aria-label={t('deliverTo.methods')}>
          {methods.map((method) => (
            <li key={method.id}>
              <span className="deliver-to-estimate__method">{method.label}</span>
              <span className="deliver-to-estimate__price">{method.price > 0 ? formatPrice(method.price) : t('deliverTo.free')}</span>
              {(etaText(method) ?? method.eta) && <span className="deliver-to-estimate__eta">{etaText(method) ?? method.eta}</span>}
            </li>
          ))}
        </ul>
      )}
      {freeShippingThreshold > 0 && methods.some((method) => method.freeOverThreshold) && (
        <p className="deliver-to-estimate__free">{t('deliverTo.freeOver', { amount: formatPrice(freeShippingThreshold) })}</p>
      )}
      <p className={cn('deliver-to-estimate__cod', !cod.available && 'deliver-to-estimate__cod--no')}>
        {cod.available ? (cod.fee > 0 ? t('deliverTo.codFee', { fee: formatPrice(cod.fee) }) : t('deliverTo.codYes')) : (cod.message ?? t('deliverTo.codNo'))}
      </p>
    </>
  )
}
