import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowDown, LuArrowLeft, LuArrowUp, LuPencil, LuPlus, LuTable2, LuTrash2, LuX } from 'react-icons/lu'
import { createDeliveryZone, deleteDeliveryZone, getDeliveryZones, phase14Keys, reorderDeliveryZones, updateDeliveryZone } from '../api/phase14'
import BdPlaceFields from '../components/BdPlaceFields'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount } from '../utils/format'
import { isZoneCode, placeText } from '../utils/bangladesh'
import { useAdminAuth } from '../auth/useAdminAuth'

/*
 * Settings → Shipping → Delivery zones (docs/backend/PHASE14_CONTRACT.md §3),
 * read with settings.view, changed with settings.edit. A Bangladesh address
 * belongs to the active zone that lists its area; otherwise to the active
 * zone that lists its district; otherwise to the fallback zone ("Outside
 * Dhaka" as seeded). Each place is in at most one zone. Zones carry no prices: their charges and
 * delivery times are table rate rows with the zone's code.
 */

const placeKey = (place) => (place.areaId ? `area-${place.areaId}` : `district-${place.districtId}`)

function DeliveryZonesPage() {
  const { can } = useAdminAuth()
  const editable = can('settings.edit')
  const zones = useQuery({ queryKey: phase14Keys.zones, queryFn: ({ signal }) => getDeliveryZones({ signal }) })
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState(null) // { tone, text }
  const noticeRef = useRef(null)
  const [editing, setEditing] = useState(null) // a zone, or {} for a new one
  const [removing, setRemoving] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const openerRef = useRef(null)
  const buttons = useRef(new Map())

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const list = [...(zones.data?.zones ?? [])].sort((a, b) => a.position - b.position || a.id - b.id)
  const refresh = () => queryClient.invalidateQueries({ queryKey: phase14Keys.zones })

  const reorder = useMutation({
    mutationFn: (ids) => reorderDeliveryZones(ids),
    onSuccess: (data) => (Array.isArray(data?.zones) ? queryClient.setQueryData(phase14Keys.zones, (current) => ({ ...current, zones: data.zones })) : refresh()),
    onError: (error) => {
      refresh()
      setNotice({ tone: 'error', text: `The new order wasn't saved: ${error.message}` })
    },
  })
  const remove = useMutation({
    mutationFn: (zone) => deleteDeliveryZone(zone.id),
    onSuccess: (_, zone) => {
      setRemoving(null)
      refresh()
      setNotice({ tone: 'success', text: `${zone.name} deleted.` })
    },
    onError: (error) => {
      setRemoving(null)
      setNotice({ tone: 'error', text: error.fieldErrors ? Object.values(error.fieldErrors)[0][0] : error.message })
    },
  })

  function move(index, step) {
    if (reorder.isPending) return
    const ids = list.map((zone) => zone.id)
    const [id] = ids.splice(index, 1)
    const target = index + step
    ids.splice(target, 0, id)
    // Shown at once; the server's answer follows.
    queryClient.setQueryData(phase14Keys.zones, (current) => ({ ...current, zones: ids.map((zoneId, position) => ({ ...list.find((zone) => zone.id === zoneId), position })) }))
    reorder.mutate(ids)
    setAnnouncement(`${list[index].name} moved to position ${target + 1} of ${ids.length}.`)
    const atEnd = step < 0 ? target === 0 : target === ids.length - 1
    requestAnimationFrame(() => buttons.current.get(`${id}-${(step < 0) !== atEnd ? 'up' : 'down'}`)?.focus())
  }

  function open(zone, event) {
    openerRef.current = event.currentTarget
    setNotice(null)
    setEditing(zone)
  }

  return (
    <>
      <title>Delivery zones | BuyNest Admin</title>
      <Link to="/settings" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Settings
      </Link>
      <PageHeader
        title="Delivery zones"
        description="Where a Bangladesh address is: an area listed in a zone counts first, then a listed district; every other place belongs to the fallback zone. Prices and delivery times are table rate rows for each zone."
        actions={
          <>
            <Link to="/settings/shipping-rates" className="btn btn--outline">
              <LuTable2 aria-hidden="true" /> Table rates
            </Link>
            {editable && (
              <button type="button" className="btn btn--primary" onClick={(event) => open({}, event)}>
                <LuPlus aria-hidden="true" /> Add zone
              </button>
            )}
          </>
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {zones.isPending && <Loading label="Loading the delivery zones…" />}
      {zones.error && <ErrorState error={zones.error} onRetry={zones.refetch} />}
      {zones.data && list.length === 0 && <Empty>No delivery zones yet: every Bangladesh address uses the table rates for Bangladesh or any country.</Empty>}
      {list.length > 0 && (
        <ol className="zones" aria-label="Delivery zones, in order">
          {list.map((zone, index) => {
            const fallback = zone.isFallback === true
            return (
              <li key={zone.id} className="panel zone" aria-labelledby={`zone-${zone.id}`}>
                <div className="zone__head">
                  <h2 id={`zone-${zone.id}`} className="panel__title">
                    {zone.name}
                    {zone.nameBn && (
                      <small lang="bn" className="muted">
                        {' '}
                        · {zone.nameBn}
                      </small>
                    )}
                  </h2>
                  <p className="zone__badges">
                    <code>{zone.code}</code>
                    <StatusBadge tone={zone.isActive ? 'success' : 'neutral'} label={zone.isActive ? 'Active' : 'Off'} />
                    {fallback && <StatusBadge tone="info" label="Fallback: every other place" />}
                  </p>
                  {editable && (
                    <div className="rates__tools zone__tools">
                      <button type="button" ref={(node) => buttons.current.set(`${zone.id}-up`, node)} className="icon-button" aria-label={`Move ${zone.name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                        <LuArrowUp aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        ref={(node) => buttons.current.set(`${zone.id}-down`, node)}
                        className="icon-button"
                        aria-label={`Move ${zone.name} down`}
                        disabled={index === list.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <LuArrowDown aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button" aria-label={`Edit ${zone.name}`} onClick={(event) => open(zone, event)}>
                        <LuPencil aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button icon-button--danger" aria-label={`Delete ${zone.name}`} onClick={() => setRemoving(zone)}>
                        <LuTrash2 aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
                {zone.places.length === 0 ? (
                  <p className="muted zone__places">{fallback ? 'Bangladesh addresses that no other zone lists come here.' : 'No places yet: no address falls in this zone.'}</p>
                ) : (
                  <ul className="zone__places chips" aria-label={`Places in ${zone.name}`}>
                    {zone.places.map((place) => (
                      <li key={placeKey(place)} className="chip">
                        {placeText(place)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted zone__count">
                  {formatCount(zone.places.filter((place) => place.districtId && !place.areaId).length)} districts, {formatCount(zone.places.filter((place) => place.areaId).length)} areas
                  {Number.isInteger(zone.rateCount) && ` · ${formatCount(zone.rateCount)} table ${zone.rateCount === 1 ? 'rate' : 'rates'}`}
                </p>
              </li>
            )
          })}
        </ol>
      )}

      {editing && (
        <ZoneDialog
          zone={editing.id ? editing : null}
          onDone={(text) => {
            setEditing(null)
            refresh()
            setNotice({ tone: 'success', text })
          }}
          onCancel={() => {
            setEditing(null)
            openerRef.current?.focus()
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          isOpen
          title={`Delete ${removing.name}?`}
          message="Its places go back to the fallback zone. Table rates for this zone stop matching; orders keep the zone they were placed with."
          confirmLabel="Delete zone"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  )
}

/** Add or edit a zone: code (fixed once made: rates use it), names, active, and its places. */
function ZoneDialog({ zone, onDone, onCancel }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState(() => ({ code: zone?.code ?? '', name: zone?.name ?? '', nameBn: zone?.nameBn ?? '', isActive: zone?.isActive ?? true, isFallback: zone?.isFallback === true }))
  const [places, setPlaces] = useState(() => zone?.places ?? [])
  const [picker, setPicker] = useState({ divisionId: '', districtId: '', areaId: '', postalCode: '' })
  const [pickerError, setPickerError] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: (sent) => (zone ? updateDeliveryZone(zone.id, sent) : createDeliveryZone(sent)),
    onSuccess: (data) => onDone(`${data?.zone?.name ?? values.name.trim()} ${zone ? 'saved' : 'added'}.`),
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.value })

  function addPlace() {
    setPickerError(null)
    if (!picker.districtId) return setPickerError('Choose a district (and an area, or the whole district).')
    const districts = queryClient.getQueryData(phase14Keys.districts(picker.divisionId))?.places ?? []
    const district = districts.find((item) => String(item.id) === String(picker.districtId))
    const areas = queryClient.getQueryData(phase14Keys.areas(picker.districtId))?.places ?? []
    const area = picker.areaId ? areas.find((item) => String(item.id) === String(picker.areaId)) : null
    const place = area
      ? { areaId: area.id, districtId: null, name: area.name, kind: area.kind, districtName: district?.name ?? null }
      : { districtId: Number(picker.districtId), areaId: null, name: district?.name ?? null }
    if (places.some((item) => placeKey(item) === placeKey(place))) return setPickerError(`${placeText(place)} is already in this zone.`)
    setPlaces([...places, place])
    setAnnouncement(`${placeText(place)} added.`)
    setPicker({ ...picker, areaId: '' })
  }

  function submit() {
    const found = {}
    const code = values.code.trim()
    if (!zone && !isZoneCode(code)) found.code = ['Use 2 to 40 lower-case letters, digits, and underscores, starting with a letter (like inside_dhaka).']
    if (!values.name.trim() || values.name.trim().length > 60) found.name = ['Enter a name of up to 60 characters.']
    if (values.nameBn.trim().length > 60) found.nameBn = ['Keep the Bangla name to 60 characters.']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate({
      ...(!zone && { code }),
      name: values.name.trim(),
      nameBn: values.nameBn.trim() || null,
      isActive: values.isActive,
      ...((values.isFallback || zone?.isFallback) && { isFallback: values.isFallback }),
      places: places.map((place) => (place.areaId ? { areaId: place.areaId } : { districtId: place.districtId })),
    })
  }

  const shown = ['code', 'name', 'nameBn', 'isActive', 'isFallback', 'places']
  const other = save.error && (save.error.fieldErrors ? Object.entries(save.error.fieldErrors).find(([field]) => !shown.some((key) => field === key || field.startsWith(`${key}.`)))?.[1]?.[0] : save.error.message)
  const placesError = errors.places?.[0] ?? Object.entries(errors).find(([field]) => field.startsWith('places.'))?.[1]?.[0]
  return (
    <FormDialog
      isOpen
      wide
      title={zone ? `Edit ${zone.name}` : 'Add a delivery zone'}
      description="An area listed here beats its district listed in another zone. Each district or area can be in one zone only."
      submitLabel={zone ? 'Save zone' : 'Add zone'}
      busy={save.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <div className="form__grid">
        <Field label="Code" error={errors.code?.[0]} hint={zone ? 'Fixed: table rates and orders use it.' : 'Table rates use it. It cannot be changed later.'}>
          {(a11y) => <input {...a11y} value={values.code} maxLength={40} readOnly={Boolean(zone)} autoComplete="off" spellCheck="false" onChange={set('code')} />}
        </Field>
        <Field label="Name" error={errors.name?.[0]} hint="Shown to shoppers in English.">
          {(a11y) => <input {...a11y} value={values.name} maxLength={60} autoComplete="off" onChange={set('name')} />}
        </Field>
        <Field label="Name in Bangla (optional)" error={errors.nameBn?.[0]} hint="Shown to shoppers in Bangla; empty: the English name.">
          {(a11y) => <input {...a11y} lang="bn" value={values.nameBn} maxLength={60} autoComplete="off" onChange={set('nameBn')} />}
        </Field>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={values.isActive} onChange={(event) => setValues({ ...values, isActive: event.target.checked })} />
        Active (off: its places go to the fallback zone)
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={values.isFallback} onChange={(event) => setValues({ ...values, isFallback: event.target.checked })} />
        Fallback zone: every Bangladesh place that no other zone lists (only one zone can be it)
      </label>

      <fieldset className="form__fieldset zone-places">
        <legend>Places in this zone</legend>
        {places.length === 0 ? (
          <p className="field__hint">{values.isFallback ? 'None needed: the fallback zone takes every place no other zone lists.' : 'None yet: add districts or areas below.'}</p>
        ) : (
          <ul className="chips">
            {places.map((place) => (
              <li key={placeKey(place)} className="chip">
                {placeText(place)}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`Remove ${placeText(place)}`}
                  onClick={() => {
                    setPlaces(places.filter((item) => placeKey(item) !== placeKey(place)))
                    setAnnouncement(`${placeText(place)} removed.`)
                  }}
                >
                  <LuX aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {placesError && <p className="field__error">{placesError}</p>}
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
      </fieldset>
      <fieldset className="form__fieldset zone-places">
        <legend>Add a place</legend>
        <p className="field__hint">Leave the area empty to add the whole district.</p>
        <div className="form__grid">
          <BdPlaceFields value={picker} onChange={(next) => setPicker({ ...next, postalCode: '' })} areaOptional />
        </div>
        {pickerError && (
          <p className="field__error" role="alert">
            {pickerError}
          </p>
        )}
        <button type="button" className="btn btn--outline btn--sm" onClick={addPlace}>
          <LuPlus aria-hidden="true" /> {picker.areaId ? 'Add the area' : 'Add the whole district'}
        </button>
      </fieldset>
    </FormDialog>
  )
}

export default DeliveryZonesPage
