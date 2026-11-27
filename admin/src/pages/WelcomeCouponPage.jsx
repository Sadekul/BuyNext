import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuSearch } from 'react-icons/lu'
import { getWelcomeCodes, getWelcomeCoupon, phase19Keys, updateWelcomeCoupon } from '../api/phase19'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatTile from '../components/StatTile'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatMoney, storeCode } from '../utils/format'
import { EARNED_BY, WELCOME_CODE_STATUSES, WELCOME_TRIGGERS, WELCOME_TYPES, settingsToForm, toWelcomePayload, welcomeCodeStatus, welcomeErrors, welcomePreview } from '../utils/welcomeCoupon'

/*
 * Phase 19 §2, Marketing → Welcome coupon: a personal, one-time code emailed
 * to a new customer when they create an account and/or confirm the
 * newsletter. Off by default. The settings (coupons.edit to change them), a
 * live preview of the store's promise, the stats, and the codes issued.
 */

const LIMIT = 20

export default function WelcomeCouponPage() {
  const welcome = useQuery({
    queryKey: phase19Keys.welcome,
    queryFn: ({ signal }) => getWelcomeCoupon({ signal }),
  })
  // Kept here: the form is remade with the saved settings after a save.
  const [justSaved, setJustSaved] = useState(false)
  return (
    <>
      <title>Welcome coupon | BuyNest Admin</title>
      <PageHeader title="Welcome coupon" description="A personal, one-time discount code emailed to each new customer." />
      <p className="notice">
        Codes go only to confirmed email addresses (a verified account, or a newsletter subscription confirmed by its link), one per email address, ever. Each code works once, only for that email
        address. Changes apply to new codes only: codes already sent keep their terms.
      </p>
      {welcome.isPending && <Loading label="Loading the welcome coupon…" />}
      {welcome.error && <ErrorState error={welcome.error} onRetry={welcome.refetch} />}
      {welcome.data && (
        <div className="settings">
          <section aria-labelledby="welcome-stats">
            <h2 id="welcome-stats" className="visually-hidden">
              Codes so far
            </h2>
            <dl className="stats stats--four">
              <StatTile label="Issued" value={formatCount(welcome.data.stats.issued)} />
              <StatTile label="Used" value={formatCount(welcome.data.stats.used)} />
              <StatTile label="Active" value={formatCount(welcome.data.stats.active)} note="Sent, not used yet" />
              <StatTile label="Expired" value={formatCount(welcome.data.stats.expired)} />
            </dl>
          </section>
          {/* key: a fresh form once the saved settings change (after Save). */}
          <WelcomeForm key={JSON.stringify(welcome.data.settings)} saved={welcome.data.settings} justSaved={justSaved} onSaved={setJustSaved} />
          <WelcomeCodes />
        </div>
      )}
    </>
  )
}

function WelcomeForm({ saved, justSaved, onSaved }) {
  const { can } = useAdminAuth()
  const editable = can('coupons.edit')
  const queryClient = useQueryClient()
  const initial = settingsToForm(saved)
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const savedRef = useRef(null)
  const changed = JSON.stringify(form) !== JSON.stringify(initial)
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])
  // After a save, this form is new: the success notice takes the focus.
  useEffect(() => {
    if (justSaved) savedRef.current?.focus()
  }, [justSaved])

  const set = (key) => (event) => {
    onSaved(false)
    setForm((current) => ({
      ...current,
      [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }))
  }
  const toggleTrigger = (key) => (event) => {
    onSaved(false)
    setForm((current) => ({
      ...current,
      triggers: event.target.checked ? [...current.triggers, key] : current.triggers.filter((trigger) => trigger !== key),
    }))
  }

  const save = useMutation({
    mutationFn: (body) => updateWelcomeCoupon(body),
    onSuccess: (data) => {
      setErrors({})
      onSaved(true)
      // The settings, preview and stats as saved; the form is remade with them (its key).
      queryClient.setQueryData(phase19Keys.welcome, data)
      queryClient.invalidateQueries({ queryKey: ['welcome-coupon', 'codes'] })
    },
    onError: (error) => {
      setErrors(error.fieldErrors ?? {})
      setNotice({
        tone: 'error',
        text: error.fieldErrors ? 'Please check the highlighted fields.' : error.message,
      })
    },
  })

  function submit(event) {
    event.preventDefault()
    const found = welcomeErrors(form)
    setErrors(found)
    if (Object.keys(found).length > 0)
      return setNotice({
        tone: 'error',
        text: 'Please check the highlighted fields.',
      })
    setNotice(null)
    onSaved(false)
    save.mutate(toWelcomePayload(form))
  }

  const preview = welcomePreview(form, formatMoney)
  const currency = storeCode()
  return (
    <form className="panel form settings__group" aria-labelledby="welcome-settings" noValidate onSubmit={submit}>
      <h2 id="welcome-settings" className="panel__title">
        Settings
      </h2>
      <div role="status">
        {justSaved && (
          <p ref={savedRef} tabIndex={-1} className="notice notice--success">
            Welcome coupon saved.
          </p>
        )}
      </div>
      <div role={notice?.tone === 'error' ? 'alert' : undefined}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="form-error">
            {notice.text}
          </p>
        )}
      </div>
      <fieldset disabled={!editable} className="form__fieldset">
        <div className="welcome-switch">
          <label className="checkbox">
            <input type="checkbox" role="switch" checked={form.enabled} onChange={set('enabled')} aria-describedby="welcome-state" />
            Welcome coupon
          </label>
          <span id="welcome-state">
            <StatusBadge tone={form.enabled ? 'success' : 'neutral'} label={form.enabled ? 'On: new customers get a code' : 'Off'} />
          </span>
        </div>

        <fieldset className="scope-list" aria-describedby={errors.triggers ? 'welcome-triggers-error' : undefined}>
          <legend>How customers earn it</legend>
          {Object.entries(WELCOME_TRIGGERS).map(([key, label]) => (
            <label key={key} className="checkbox">
              <input type="checkbox" checked={form.triggers.includes(key)} onChange={toggleTrigger(key)} />
              {label}
            </label>
          ))}
          {errors.triggers && (
            <span id="welcome-triggers-error" className="field__error">
              {errors.triggers[0]}
            </span>
          )}
        </fieldset>

        <div className="form__grid">
          <Field label="Discount type" error={errors.type?.[0]}>
            {(a11y) => (
              <select {...a11y} value={form.type} onChange={set('type')}>
                {Object.entries(WELCOME_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={form.type === 'percent' ? 'Percent off' : `Amount off (${currency})`}
            error={errors.value?.[0]}
            hint={form.type === 'percent' ? 'A whole number from 1 to 90.' : `In ${currency}, at most 100,000.`}
          >
            {(a11y) => (
              <input
                {...a11y}
                type="number"
                inputMode="decimal"
                min={form.type === 'percent' ? 1 : 0.01}
                max={form.type === 'percent' ? 90 : 100000}
                step={form.type === 'percent' ? 1 : 0.01}
                value={form.value}
                onChange={set('value')}
              />
            )}
          </Field>
          <Field label={`Minimum order (${currency}, optional)`} error={errors.minSubtotal?.[0]} hint="Cart subtotal needed to use the code; empty for none.">
            {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0.01" step="0.01" value={form.minSubtotal} onChange={set('minSubtotal')} />}
          </Field>
          <Field label="Valid for (days)" error={errors.validDays?.[0]} hint="From the day the code is sent, 1 to 365.">
            {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="1" max="365" step="1" value={form.validDays} onChange={set('validDays')} />}
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.firstOrderOnly} onChange={set('firstOrderOnly')} />
          First order only
        </label>
        <p className="field__hint">With it, someone who already placed an order (one that wasn’t cancelled) can’t use the code.</p>
      </fieldset>

      <section className="welcome-preview" aria-labelledby="welcome-preview">
        <h3 id="welcome-preview" className="welcome-preview__heading">
          Preview: what shoppers see
        </h3>
        {preview ? (
          <div className="welcome-preview__card">
            <p className="welcome-preview__title">{preview.title}</p>
            {preview.newsletter && <p>{preview.newsletter}</p>}
            {preview.minimum && <p>{preview.minimum}</p>}
            {preview.signup && <p className="muted">On the sign-up page: “{preview.signup}”</p>}
          </div>
        ) : (
          <p className="muted">Enter a valid discount to see the preview.</p>
        )}
        <p className="field__hint">
          {form.enabled ? 'Shown in the store’s newsletter blocks and on the sign-up page, in English and Bangla.' : 'The store shows no offer while the welcome coupon is off.'}
        </p>
      </section>

      {editable ? (
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={save.isPending || !changed}>
            {save.isPending ? 'Saving…' : 'Save welcome coupon'}
          </button>
        </div>
      ) : (
        <p className="muted">Your role can view these settings but not change them.</p>
      )}
    </form>
  )
}

function WelcomeCodes() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const query = { q, status, skip, limit: LIMIT }
  const codes = useQuery({
    queryKey: phase19Keys.codes(query),
    queryFn: ({ signal }) => getWelcomeCodes(query, { signal }),
    placeholderData: keepPreviousData,
  })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(q || status)
  return (
    <section aria-labelledby="welcome-codes">
      <h2 id="welcome-codes" className="welcome-codes__title">
        Codes sent
      </h2>
      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="welcome-code-search" className="visually-hidden">
            Search welcome codes
          </label>
          <input id="welcome-code-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Code or email" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">All codes</option>
            {Object.entries(WELCOME_CODE_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {codes.isPending && <Loading label="Loading the codes…" />}
      {codes.error && <ErrorState error={codes.error} onRetry={codes.refetch} />}
      {codes.data && codes.data.codes.length === 0 && <Empty>{filtered ? 'No codes match.' : 'No welcome codes sent yet.'}</Empty>}
      {codes.data && codes.data.codes.length > 0 && (
        <div className="table-wrap" aria-busy={codes.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Welcome codes sent, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Email</th>
                <th scope="col">Earned by</th>
                <th scope="col">Issued</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
                <th scope="col">Order</th>
              </tr>
            </thead>
            <tbody>
              {codes.data.codes.map((entry) => (
                <tr key={entry.code}>
                  <td>
                    {entry.id ? (
                      <Link to={`/coupons/${entry.id}`}>
                        <code>{entry.code}</code>
                      </Link>
                    ) : (
                      <code>{entry.code}</code>
                    )}
                  </td>
                  <td>
                    {entry.email}
                    {entry.customer && (
                      <>
                        <br />
                        <Link to={`/customers/${entry.customer.id}`}>{entry.customer.name || `Customer #${entry.customer.id}`}</Link>
                      </>
                    )}
                  </td>
                  <td>{EARNED_BY[entry.trigger] ?? '—'}</td>
                  <td>{formatDate(entry.issuedAt)}</td>
                  <td>{formatDate(entry.expiresAt)}</td>
                  <td>
                    <StatusBadge {...welcomeCodeStatus(entry.status)} />
                  </td>
                  <td>{entry.usedOnOrder ? <Link to={`/orders/${encodeURIComponent(entry.usedOnOrder)}`}>{entry.usedOnOrder}</Link> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={codes.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </section>
  )
}
