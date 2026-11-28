import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { createCourierPayout, deleteCourierPayout, getCourierPayouts, phase21Keys, updateCourierPayout } from '../api/phase21'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { Empty, ErrorState, Loading } from '../components/States'
import { PAYOUT_COURIERS, courierName, emptyPayoutForm, payoutErrors, payoutToForm, toPayoutValues } from '../utils/cash'
import { formatMoney, storeCode } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'
import { formatDay, knownZone, todayIn } from '../utils/reportRange'

const PAGE = 20
const describe = (payout, courierFallback) => `${formatMoney(payout.amount, payout.currency ?? undefined)} from ${courierName(payout.carrier, payout.carrierLabel || courierFallback)}`

/**
 * Phase 21 §2: Reports → Courier payments. Each payment a courier made to the
 * shop (the cash it collected, minus its fees), recorded by staff so the Cash
 * on delivery balances are right. Reading needs reports.view; recording,
 * editing and deleting need cash.manage (Record courier payments). A payment
 * with the same courier, amount and date as one already recorded asks first.
 */
function CourierPaymentsPage() {
  const { can } = useAdminAuth()
  const editable = can('cash.manage')
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialCarrier = PAYOUT_COURIERS.some((courier) => courier.code === searchParams.get('carrier')) ? searchParams.get('carrier') : ''
  const [filters, setFilters] = useState({ carrier: initialCarrier, from: '', to: '' })
  const [draft, setDraft] = useState(filters)
  const [skip, setSkip] = useState(0)
  const [editing, setEditing] = useState(null) // a payment, or {} for a new one
  const [removing, setRemoving] = useState(null)
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const params = { ...filters, limit: PAGE, skip }
  const list = useQuery({ queryKey: phase21Keys.payouts(params), queryFn: ({ signal }) => getCourierPayouts(params, { signal }), placeholderData: keepPreviousData })

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const changed = (text) => {
    queryClient.invalidateQueries({ queryKey: ['courier-payouts'] })
    // The Cash on delivery balances change with every payment.
    queryClient.invalidateQueries({ queryKey: ['report', 'cod'] })
    setNotice(text)
  }
  const remove = useMutation({
    mutationFn: (payout) => deleteCourierPayout(payout.id),
    onSuccess: (_, payout) => {
      setRemoving(null)
      changed(`Payment of ${describe(payout)} deleted.`)
    },
  })

  function applyFilters(event) {
    event.preventDefault()
    setFilters(draft)
    setSkip(0)
  }

  return (
    <>
      <title>Courier payments | BuyNest Admin</title>
      <PageHeader
        title="Courier payments"
        description="Money couriers paid you: the cash they collected, minus their fees. Recording each one keeps the Cash on delivery balances right."
        actions={
          editable && (
            <button type="button" className="btn btn--primary" onClick={() => setEditing({})}>
              <LuPlus aria-hidden="true" /> Record a payment
            </button>
          )
        }
      />
      <div role="status">
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="notice notice--success">
            {notice}
          </p>
        )}
      </div>
      {!editable && <p className="muted page-note">Your role can see courier payments but not record them.</p>}

      <form className="toolbar" aria-label="Filter courier payments" noValidate onSubmit={applyFilters}>
        <label className="toolbar__select">
          <span>Courier</span>
          <select value={draft.carrier} onChange={(event) => setDraft({ ...draft, carrier: event.target.value })}>
            <option value="">All couriers</option>
            {PAYOUT_COURIERS.map((courier) => (
              <option key={courier.code} value={courier.code}>
                {courier.label}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Received from</span>
          <input type="date" value={draft.from} max={draft.to || undefined} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label className="toolbar__select">
          <span>Received to</span>
          <input type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </label>
        <button type="submit" className="btn btn--outline">
          Show
        </button>
      </form>

      {list.isPending && <Loading label="Loading courier payments…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && list.data.payouts.length === 0 && (
        <Empty>{filters.carrier || filters.from || filters.to ? 'No courier payments match these filters.' : 'No courier payments recorded yet.'}</Empty>
      )}
      {list.data && list.data.payouts.length > 0 && (
        <div className="table-wrap" aria-busy={list.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Courier payments, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Received</th>
                <th scope="col">Courier</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col" className="num">
                  Fees kept
                </th>
                <th scope="col">Reference</th>
                <th scope="col">Recorded by</th>
                {editable && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {list.data.payouts.map((payout) => (
                <tr key={payout.id}>
                  <th scope="row">{formatDay(payout.receivedOn)}</th>
                  <td>
                    {courierName(payout.carrier, payout.carrierLabel)}
                    {payout.note && <small className="muted cash-note"> {payout.note}</small>}
                  </td>
                  <td className="num">{formatMoney(payout.amount, payout.currency ?? undefined)}</td>
                  <td className="num">{payout.fees === null ? <span className="muted">—</span> : formatMoney(payout.fees, payout.currency ?? undefined)}</td>
                  <td>{payout.reference ? <code>{payout.reference}</code> : <span className="muted">—</span>}</td>
                  <td>{payout.adminName ?? <span className="muted">—</span>}</td>
                  {editable && (
                    <td className="table__actions">
                      <button type="button" className="icon-button" aria-label={`Edit the payment of ${describe(payout)} on ${formatDay(payout.receivedOn)}`} onClick={() => setEditing(payout)}>
                        <LuPencil aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button--danger"
                        aria-label={`Delete the payment of ${describe(payout)} on ${formatDay(payout.receivedOn)}`}
                        onClick={() => {
                          remove.reset()
                          setRemoving(payout)
                        }}
                      >
                        <LuTrash2 aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={list.data.total} limit={PAGE} skip={skip} onChange={setSkip} />
        </div>
      )}

      {editing && (
        <PayoutDialog
          payout={editing.id ? editing : null}
          defaultCarrier={filters.carrier}
          onDone={(text) => {
            setEditing(null)
            changed(text)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {removing && (
        <FormDialog
          isOpen
          danger
          title="Delete this payment?"
          description={`The payment of ${describe(removing)} on ${formatDay(removing.receivedOn)} is removed, and the courier's balance goes back up by that amount. The audit log keeps a record of it.`}
          submitLabel="Delete payment"
          busy={remove.isPending}
          error={remove.error ? actionErrorMessage(remove.error) : null}
          onSubmit={() => remove.mutate(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  )
}

/**
 * Record or edit a payment. Two steps: the form, then (when the API answers
 * 409 "already recorded") a confirmation naming the existing payment; "Record
 * it anyway" sends the same payment again with confirmDuplicate.
 */
function PayoutDialog({ payout, defaultCarrier, onDone, onCancel }) {
  const today = todayIn(knownZone())
  const [form, setForm] = useState(() => (payout ? payoutToForm(payout) : { ...emptyPayoutForm(today), carrier: defaultCarrier ?? '' }))
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState('form') // 'form' | 'duplicate'
  const [duplicate, setDuplicate] = useState(null)
  const save = useMutation({
    mutationFn: (values) => (payout ? updateCourierPayout(payout.id, values) : createCourierPayout(values)),
    onSuccess: ({ payout: saved }, values) => {
      const text = describe(saved?.amount !== undefined ? saved : values, courierName(values.carrier))
      onDone(payout ? `Payment of ${text} saved.` : `Payment of ${text} recorded.`)
    },
    onError: (error) => {
      if (error.status === 409 && error.duplicateOf) {
        setDuplicate(error.duplicateOf)
        setStep('duplicate')
        return
      }
      setStep('form')
      setErrors(error.fieldErrors ?? {})
    },
  })
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  function submit() {
    const found = payoutErrors(form, today)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate(toPayoutValues(form))
  }

  if (step === 'duplicate') {
    const values = toPayoutValues(form)
    const existing = duplicate?.amount !== undefined ? duplicate : { ...values, id: duplicate?.id }
    return (
      <FormDialog
        key="duplicate"
        isOpen
        title="This payment may already be recorded"
        description={`A payment of ${describe(existing, courierName(values.carrier))} received on ${formatDay(existing.receivedOn)} is already recorded${existing.reference ? ` (reference ${existing.reference})` : ''}. Record this one too only if ${courierName(values.carrier)} really paid you twice.`}
        submitLabel="Record it anyway"
        busy={save.isPending}
        error={save.error && save.error.status !== 409 ? actionErrorMessage(save.error) : null}
        onSubmit={() => save.mutate({ ...values, confirmDuplicate: true })}
        onCancel={() => {
          save.reset()
          setStep('form')
        }}
      />
    )
  }

  const other = save.error && !save.error.fieldErrors && save.error.status !== 409 ? actionErrorMessage(save.error) : null
  const code = storeCode()
  return (
    <FormDialog
      key="form"
      isOpen
      title={payout ? 'Edit courier payment' : 'Record a courier payment'}
      description="What arrived in your bank or mobile wallet from the courier, as on its payment statement."
      submitLabel={payout ? 'Save payment' : 'Record payment'}
      busy={save.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <Field label="Courier" error={errors.carrier?.[0]}>
        {(a11y) => (
          <select {...a11y} value={form.carrier} onChange={set('carrier')}>
            <option value="">Choose a courier</option>
            {PAYOUT_COURIERS.map((courier) => (
              <option key={courier.code} value={courier.code}>
                {courier.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="form__grid">
        <Field label={`Amount received (${code})`} error={errors.amount?.[0]} hint="After the courier's fees.">
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} />}
        </Field>
        <Field label={`Fees kept (${code}, optional)`} error={errors.fees?.[0]} hint="Only for couriers that don't report fees per parcel. Leave empty if unknown.">
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" value={form.fees} onChange={set('fees')} />}
        </Field>
      </div>
      <Field label="Date received" error={errors.receivedOn?.[0]}>
        {(a11y) => <input {...a11y} type="date" min="2020-01-01" max={today} value={form.receivedOn} onChange={set('receivedOn')} />}
      </Field>
      <Field label="Reference (optional)" error={errors.reference?.[0]} hint="The bank or bKash transaction ID.">
        {(a11y) => <input {...a11y} value={form.reference} maxLength={100} autoComplete="off" onChange={set('reference')} />}
      </Field>
      <Field label="Note (optional)" error={errors.note?.[0]}>
        {(a11y) => <textarea {...a11y} rows={2} value={form.note} maxLength={500} onChange={set('note')} />}
      </Field>
    </FormDialog>
  )
}

export default CourierPaymentsPage
