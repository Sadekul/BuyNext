import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { bookCourier, getBookingDefaults, getPathaoPlaces, phase18Keys } from '../api/phase18'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from './Field'
import FormDialog from './FormDialog'
import { ErrorState, Loading } from './States'
import { formatMoney, fullName, storeCode } from '../utils/format'
import { awaitsConfirmation, confirmationOf, confirmationStatus } from '../utils/bangladesh'
import { bookingErrors, courierLabel, toBookingValues } from '../utils/couriers'

/*
 * Phase 18 §2: "Book courier" on the order page. The API hands the dialog its
 * defaults (the configured couriers, the cash to collect, the weight, the
 * note, the recipient's mobile and one-line address, and the Pathao city,
 * zone and area that match the order's district and area). Staff pick the
 * courier, check the amounts, and for Pathao the City → Zone → Area. The
 * courier is called by the API: on failure nothing is saved and its own
 * reason is shown here.
 */

// Fields this dialog shows next to their control; anything else the API says goes above the buttons.
const FIELD_ERRORS = ['codAmount', 'weightKg', 'note', 'pathaoCityId', 'pathaoZoneId', 'pathaoAreaId', 'confirmationOverride']

export function CourierBookingDialog({ order, onDone, onCancel }) {
  const defaults = useQuery({ queryKey: phase18Keys.booking(order.number), queryFn: ({ signal }) => getBookingDefaults(order.number, { signal }), staleTime: 0 })
  if (defaults.data?.booking) return <BookingForm order={order} booking={defaults.data.booking} onDone={onDone} onCancel={onCancel} />
  return (
    <FormDialog isOpen wide title={`Book a courier for order ${order.number}`} submitLabel="Book courier" busy onSubmit={() => {}} onCancel={onCancel}>
      {defaults.isPending ? <Loading label="Loading the booking details…" /> : <ErrorState error={defaults.error} onRetry={defaults.refetch} />}
    </FormDialog>
  )
}

const text = (value) => (value === null || value === undefined ? '' : String(value))

function BookingForm({ order, booking, onDone, onCancel }) {
  const { can } = useAdminAuth()
  // The API knows best (awaits_confirmation); the order's own fields otherwise.
  const unconfirmed = booking.awaitsConfirmation || awaitsConfirmation(order)
  const couriers = booking.couriers
  const first = couriers.some((entry) => entry.key === booking.defaultCourier) ? booking.defaultCourier : couriers.length === 1 ? couriers[0].key : ''
  const [form, setForm] = useState({
    courier: first,
    codAmount: text(booking.codAmount),
    weightKg: text(booking.weightKg),
    note: booking.note ?? '',
    notify: true,
    override: false,
    overrideReason: '',
    pathaoCityId: text(booking.pathaoMatch?.cityId),
    pathaoZoneId: text(booking.pathaoMatch?.zoneId),
    pathaoAreaId: text(booking.pathaoMatch?.areaId),
  })
  const [errors, setErrors] = useState({})
  const set = (changes) => setForm((current) => ({ ...current, ...changes }))
  const currency = order.currency ?? storeCode()
  const chosenLabel = form.courier ? (couriers.find((entry) => entry.key === form.courier)?.label ?? courierLabel(form.courier)) : null

  const book = useMutation({
    mutationFn: (values) => bookCourier(order.number, values),
    onSuccess: ({ shipment }) => {
      const courier = shipment?.courier
      const ids = [courier?.consignmentId && `consignment ${courier.consignmentId}`, (courier?.trackingCode ?? shipment?.trackingNumber) && `tracking code ${courier?.trackingCode ?? shipment.trackingNumber}`].filter(Boolean).join(', ')
      const created = shipment?.number ? `Shipment ${shipment.number} created` : 'A shipment was created'
      onDone(`Booked with ${courier?.label ?? chosenLabel}${ids ? ` (${ids})` : ''}. ${created} and the order is now shipped.${form.notify ? ' The customer was emailed.' : ''}`)
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = bookingErrors(form, { maxCod: order.totals?.total, unconfirmed })
    setErrors(found)
    if (Object.keys(found).length === 0) book.mutate(toBookingValues(form, { unconfirmed }))
  }

  // The courier's own reason (422 `courier`, `order`, `phone`…) or a 502 goes above the buttons.
  const formError = (() => {
    const error = book.error
    if (!error) return null
    const other = Object.entries(error.fieldErrors ?? {}).find(([field]) => !FIELD_ERRORS.includes(field))
    if (other) return other[1][0]
    return error.fieldErrors ? null : error.message
  })()

  // The name the courier gets: the shipping address's (the account's name only when the address has none).
  const customerName = [order.shippingAddress?.firstName, order.shippingAddress?.lastName].filter(Boolean).join(' ') || fullName(order.customer) || '—'
  return (
    <FormDialog
      isOpen
      wide
      title={`Book a courier for order ${order.number}`}
      description="The courier gets the parcel's details now. The tracking number is saved on a new shipment and the order is marked shipped."
      submitLabel={chosenLabel ? `Book with ${chosenLabel}` : 'Book courier'}
      busy={book.isPending}
      disabled={Boolean(booking.problem)}
      error={formError}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {/* The API's reason this order can't be booked now (store currency, already booked…): the courier would refuse it too. */}
      {booking.problem && (
        <p className="courier-callout" role="note">
          {booking.problem}
        </p>
      )}
      {couriers.length === 0 ? (
        <p className="field__error">No courier is set up yet. Add a courier's keys in backend/.env (Settings → Couriers explains how).</p>
      ) : (
        <fieldset className="form__fieldset courier-choice" aria-describedby={errors.courier ? 'courier-choice-error' : undefined}>
          <legend>Courier</legend>
          <div className="courier-choice__options">
            {couriers.map((entry) => (
              <label key={entry.key} className={`courier-choice__card${form.courier === entry.key ? ' is-chosen' : ''}`}>
                <input type="radio" name="courier" value={entry.key} checked={form.courier === entry.key} aria-invalid={errors.courier ? true : undefined} onChange={() => set({ courier: entry.key })} />
                <span className="courier-choice__name">{entry.label ?? courierLabel(entry.key)}</span>
                <span className="courier-choice__meta">
                  {entry.key === 'pathao' ? 'Needs the city and zone' : 'Address as written'}
                  {entry.mode === 'sandbox' && ' · sandbox (test bookings)'}
                </span>
              </label>
            ))}
          </div>
          {errors.courier && (
            <span id="courier-choice-error" className="field__error">
              {errors.courier[0]}
            </span>
          )}
        </fieldset>
      )}

      <section className="courier-recipient" aria-labelledby="courier-recipient-title">
        <h3 id="courier-recipient-title">Recipient</h3>
        <dl className="details">
          <dt>Name</dt>
          <dd>{customerName}</dd>
          <dt>Mobile</dt>
          <dd>{booking.phone ?? <span className="field__error">No Bangladeshi mobile number: a courier needs one.</span>}</dd>
          <dt>Address</dt>
          <dd>{booking.addressLine ?? <span className="field__error">No delivery address.</span>}</dd>
        </dl>
        <p className="field__hint">
          The courier gets the address and mobile as the order has them.{' '}
          {order.customer?.id && can('customers.view') ? (
            <>
              Wrong? <Link to={`/customers/${order.customer.id}`}>Edit the customer's addresses</Link>, then ask them which address this order should go to.
            </>
          ) : (
            'Wrong? Call the customer and ship by hand with the right address instead.'
          )}
        </p>
      </section>

      {unconfirmed && (
        <fieldset className="form__fieldset ship-override">
          <legend>Not confirmed by phone</legend>
          <p className="field__hint">
            This cash on delivery order is {confirmationOf(order) ? `“${confirmationStatus(confirmationOf(order)).label.toLowerCase()}”` : 'not confirmed by phone'}. Orders are booked once the customer confirms; to book it anyway, say
            why (it is kept in the audit log).
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.override}
              aria-invalid={errors.overrideConfirmation ? true : undefined}
              aria-describedby={errors.overrideConfirmation ? 'courier-override-error' : undefined}
              onChange={(event) => set({ override: event.target.checked })}
            />
            Book without confirmation
          </label>
          {errors.overrideConfirmation && (
            <span id="courier-override-error" className="field__error">
              {errors.overrideConfirmation[0]}
            </span>
          )}
          {form.override && (
            <Field label="Reason" error={errors.confirmationOverride?.[0]}>
              {(a11y) => <input {...a11y} value={form.overrideReason} maxLength={500} onChange={(event) => set({ overrideReason: event.target.value })} />}
            </Field>
          )}
        </fieldset>
      )}

      {form.courier === 'pathao' && <PathaoPlaces form={form} set={set} errors={errors} matched={booking.pathaoMatch} />}

      <div className="form__grid">
        <Field
          label={`Cash to collect (${currency})`}
          error={errors.codAmount?.[0]}
          hint={order.paymentMethod === 'cod' ? `The cash still due. 0 if nothing is collected; at most ${formatMoney(order.totals?.total ?? 0, order.currency)}.` : 'Paid already: 0 unless the courier should collect something.'}
        >
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" value={form.codAmount} onChange={(event) => set({ codAmount: event.target.value })} />}
        </Field>
        <Field label="Weight (kg)" error={errors.weightKg?.[0]} hint={form.courier === 'pathao' ? 'Pathao takes 0.5 to 10 kg.' : 'From the products’ weights.'}>
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" value={form.weightKg} onChange={(event) => set({ weightKg: event.target.value })} />}
        </Field>
      </div>
      <Field label="Note for the courier (optional)" error={errors.note?.[0]} hint="Printed for the rider, e.g. “Handle with care”. Up to 200 characters.">
        {(a11y) => <textarea {...a11y} rows={2} maxLength={200} value={form.note} onChange={(event) => set({ note: event.target.value })} />}
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={form.notify} onChange={(event) => set({ notify: event.target.checked })} />
        Email the customer the tracking details
      </label>
    </FormDialog>
  )
}

/**
 * Pathao's City → Zone → Area, loaded from the API as each is chosen. The
 * order's district and area pre-select them when the names match; nothing is
 * guessed otherwise.
 */
function PathaoPlaces({ form, set, errors, matched }) {
  const cities = useQuery({ queryKey: phase18Keys.pathao('cities'), queryFn: ({ signal }) => getPathaoPlaces('cities', null, { signal }), staleTime: 60 * 60_000 })
  const zones = useQuery({
    queryKey: phase18Keys.pathao('zones', form.pathaoCityId),
    queryFn: ({ signal }) => getPathaoPlaces('zones', form.pathaoCityId, { signal }),
    enabled: Boolean(form.pathaoCityId),
    staleTime: 60 * 60_000,
  })
  const areas = useQuery({
    queryKey: phase18Keys.pathao('areas', form.pathaoZoneId),
    queryFn: ({ signal }) => getPathaoPlaces('areas', form.pathaoZoneId, { signal }),
    enabled: Boolean(form.pathaoZoneId),
    staleTime: 60 * 60_000,
  })
  const loadError = cities.error ?? zones.error ?? areas.error

  const select = (query, value, onChange, placeholder, a11y, disabled) => (
    <select {...a11y} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">{query.isFetching && !query.data ? 'Loading…' : placeholder}</option>
      {(query.data?.options ?? []).map((option) => (
        <option key={option.id} value={String(option.id)}>
          {option.name}
          {option.homeDelivery === false ? ' (no home delivery)' : ''}
        </option>
      ))}
    </select>
  )

  return (
    <fieldset className="form__fieldset pathao-places">
      <legend>Pathao delivery area</legend>
      {!matched?.cityId && <p className="field__hint">Choose the city: none of Pathao's cities matched the order's district.</p>}
      {loadError && (
        <p className="field__error" role="alert">
          {loadError.message}
        </p>
      )}
      <div className="form__grid">
        <Field label="City" error={errors.pathaoCityId?.[0]}>
          {(a11y) => select(cities, form.pathaoCityId, (value) => set({ pathaoCityId: value, pathaoZoneId: '', pathaoAreaId: '' }), 'Choose the city…', a11y, false)}
        </Field>
        <Field label="Zone" error={errors.pathaoZoneId?.[0]} hint={!form.pathaoCityId ? 'Choose the city first.' : matched?.cityId && !matched?.zoneId && form.pathaoCityId === String(matched.cityId) ? 'No zone matched the order’s area: choose it.' : undefined}>
          {(a11y) => select(zones, form.pathaoZoneId, (value) => set({ pathaoZoneId: value, pathaoAreaId: '' }), 'Choose the zone…', a11y, !form.pathaoCityId)}
        </Field>
        <Field label="Area (optional)" error={errors.pathaoAreaId?.[0]} hint={!form.pathaoZoneId ? 'Choose the zone first.' : undefined}>
          {(a11y) => select(areas, form.pathaoAreaId, (value) => set({ pathaoAreaId: value }), 'Any area of the zone', a11y, !form.pathaoZoneId)}
        </Field>
      </div>
    </fieldset>
  )
}
