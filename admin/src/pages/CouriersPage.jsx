import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuCircleCheck, LuTriangleAlert, LuWallet } from 'react-icons/lu'
import { getCouriers, phase18Keys, updateCourierSettings } from '../api/phase18'
import { useAdminAuth } from '../auth/useAdminAuth'
import CopyButton from '../components/CopyButton'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { COURIERS, COURIER_ENV, PATHAO_DELIVERY_TYPES, PATHAO_ITEM_TYPES } from '../utils/couriers'

/*
 * Phase 18 §2, Settings → Couriers: Steadfast and Pathao. Each courier's
 * card says whether it is set up (its keys are in backend/.env: this page
 * lists the variable names, never a value, and has no field for one), its
 * mode, the webhook URL to paste in the courier's panel, and Steadfast's
 * balance. Below, the booking defaults (settings.edit to change them).
 */

const SETUP_STEPS = {
  steadfast: [
    'In the Steadfast (Packzy) merchant panel, open API settings and create an API key and secret key.',
    'Choose a webhook token (any long random text): it proves the updates come from Steadfast.',
    'Paste the webhook URL below into the panel’s webhook settings, with the token as the Bearer token.',
  ],
  pathao: [
    'In the Pathao merchant panel, open Developers API and copy the client id and client secret; note your store id.',
    'Use your merchant login (email and password) as the username and password; start with sandbox mode.',
    'Paste the webhook URL below into the webhook settings, with a secret of your choice as the webhook secret.',
  ],
}

export default function CouriersPage() {
  const couriers = useQuery({ queryKey: phase18Keys.couriers, queryFn: ({ signal }) => getCouriers({ signal }) })
  return (
    <>
      <title>Couriers | BuyNest Admin</title>
      <Link to="/settings" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Settings
      </Link>
      <PageHeader
        title="Couriers"
        description="Book Steadfast or Pathao from an order: the tracking number is saved, customers follow the parcel, and a delivered cash on delivery parcel records the cash and marks the order paid. RedX, Paperfly, and Sundarban are in the Ship dialog with a tracking number you type."
      />
      {couriers.isPending && <Loading label="Loading the couriers…" />}
      {couriers.error && <ErrorState error={couriers.error} onRetry={couriers.refetch} />}
      {couriers.data && (
        <div className="settings">
          <div className="courier-cards">
            {couriers.data.couriers.map((courier) => (
              <CourierCard key={courier.key} courier={courier} />
            ))}
          </div>
          <CourierSettingsForm saved={couriers.data.settings} couriers={couriers.data.couriers} />
        </div>
      )}
    </>
  )
}

function CourierCard({ courier }) {
  const titleId = `courier-${courier.key}`
  const balance = useMutation({ mutationFn: () => getCouriers({ balance: true }) })
  const checked = balance.data?.couriers?.find((entry) => entry.key === courier.key)
  const env = COURIER_ENV[courier.key] ?? []
  return (
    <section className="panel courier-card" aria-labelledby={titleId}>
      <div className="courier-card__head">
        <h2 id={titleId} className="panel__title">
          {courier.label}
        </h2>
        <p className="courier-card__badges">
          {courier.configured ? <StatusBadge tone="success" icon={LuCircleCheck} label="Set up" /> : <StatusBadge tone="warning" icon={LuTriangleAlert} label="Not set up" />}
          {courier.mode && <StatusBadge tone={courier.mode === 'live' ? 'info' : 'neutral'} label={courier.mode === 'live' ? 'Live' : 'Sandbox (test bookings)'} />}
        </p>
      </div>
      <div className="courier-card__body">
        {courier.webhookUrl && (
          <div className="field">
            <label htmlFor={`${titleId}-webhook`}>Webhook URL</label>
            <div className="payment-link__row">
              <input id={`${titleId}-webhook`} type="text" readOnly value={courier.webhookUrl} onFocus={(event) => event.target.select()} aria-describedby={`${titleId}-webhook-hint`} />
              <CopyButton value={courier.webhookUrl} name={`webhook URL for ${courier.label}`} />
            </div>
            <span id={`${titleId}-webhook-hint`} className="field__hint">
              {courier.label} sends each status change here. It goes straight to the API, not through this admin.
            </span>
          </div>
        )}
        {courier.key === 'steadfast' && courier.configured && (
          <div className="courier-card__balance">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => balance.mutate()} disabled={balance.isPending}>
              <LuWallet aria-hidden="true" /> {balance.isPending ? 'Asking Steadfast…' : 'Check balance'}
            </button>
            <p role="status" className="courier-card__balance-value">
              {checked && (checked.balance ? `Balance: ${checked.balance}` : `${courier.label} didn't say.`)}
            </p>
            {balance.error && (
              <p className="field__error" role="alert">
                {balance.error.message}
              </p>
            )}
          </div>
        )}
        <details className="courier-card__setup" open={!courier.configured}>
          <summary>How to set up {courier.label}</summary>
          <ol>
            {(SETUP_STEPS[courier.key] ?? []).map((step) => (
              <li key={step}>{step}</li>
            ))}
            <li>
              Put them in <code>backend/.env</code> (never in this admin or in git), under these names:
              <ul className="courier-card__env">
                {env.map((name) => (
                  <li key={name}>
                    <code>{name.split(' ')[0]}</code>
                    {name.includes(' ') && <span className="muted"> {name.slice(name.indexOf(' ') + 1)}</span>}
                  </li>
                ))}
              </ul>
            </li>
            <li>Restart the API so it reads them, then come back here: the card says “Set up”.</li>
            <li>Book a test order in sandbox mode and check its status updates before going live.</li>
          </ol>
        </details>
      </div>
    </section>
  )
}

function CourierSettingsForm({ saved, couriers }) {
  const { can } = useAdminAuth()
  const editable = can('settings.edit')
  const queryClient = useQueryClient()
  const [values, setValues] = useState({
    defaultCourier: saved.defaultCourier ?? '',
    autoSync: saved.autoSync !== false,
    noteTemplate: saved.noteTemplate ?? '',
    pathaoItemType: saved.pathaoItemType ?? 'parcel',
    pathaoDeliveryType: saved.pathaoDeliveryType ?? 'normal',
  })
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  const save = useMutation({
    mutationFn: (body) => updateCourierSettings(body),
    onSuccess: () => {
      setErrors({})
      setNotice({ tone: 'success', text: 'Courier settings saved.' })
      queryClient.invalidateQueries({ queryKey: phase18Keys.couriers })
    },
    onError: (error) => {
      setErrors(error.fieldErrors ?? {})
      setNotice({ tone: 'error', text: error.fieldErrors ? 'Please check the highlighted fields.' : error.message })
    },
  })

  function submit(event) {
    event.preventDefault()
    const found = {}
    if (values.noteTemplate.trim().length > 200) found.noteTemplate = ['Keep the note to 200 characters.']
    setErrors(found)
    if (Object.keys(found).length > 0) return setNotice({ tone: 'error', text: 'Please check the highlighted fields.' })
    save.mutate({ ...values, defaultCourier: values.defaultCourier || null, noteTemplate: values.noteTemplate.trim() || null })
  }

  const label = (key) => couriers.find((courier) => courier.key === key)?.label ?? COURIERS[key]?.label ?? key
  return (
    <form className="panel form settings__group" aria-labelledby="courier-settings" noValidate onSubmit={submit}>
      <h2 id="courier-settings" className="panel__title">
        Booking defaults
      </h2>
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>
      <fieldset disabled={!editable} className="form__fieldset">
        <div className="form__grid">
          <Field label="Default courier" error={errors.defaultCourier?.[0]} hint="Chosen first in the Book courier dialog.">
            {(a11y) => (
              <select {...a11y} value={values.defaultCourier} onChange={set('defaultCourier')}>
                <option value="">No default</option>
                {Object.keys(COURIERS).map((key) => (
                  <option key={key} value={key}>
                    {label(key)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Default note for the courier (optional)" error={errors.noteTemplate?.[0]} hint="For example “Handle with care”. Up to 200 characters; staff can change it per order.">
            {(a11y) => <input {...a11y} value={values.noteTemplate} maxLength={200} onChange={set('noteTemplate')} />}
          </Field>
          <Field label="Pathao item type" error={errors.pathaoItemType?.[0]}>
            {(a11y) => (
              <select {...a11y} value={values.pathaoItemType} onChange={set('pathaoItemType')}>
                {Object.entries(PATHAO_ITEM_TYPES).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Pathao delivery type" error={errors.pathaoDeliveryType?.[0]} hint="On-demand is faster and costs more.">
            {(a11y) => (
              <select {...a11y} value={values.pathaoDeliveryType} onChange={set('pathaoDeliveryType')}>
                {Object.entries(PATHAO_DELIVERY_TYPES).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={values.autoSync} onChange={set('autoSync')} />
          Check booked parcels with the courier every 30 minutes
        </label>
        <p className="field__hint">Webhooks bring most updates at once; the check catches any the courier didn't send. The weight of products without one is under Settings → Shipping.</p>
      </fieldset>
      {editable ? (
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save courier settings'}
          </button>
        </div>
      ) : (
        <p className="muted">Your role can view these settings but not change them.</p>
      )}
    </form>
  )
}
