import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowDown, LuArrowUp, LuPencil, LuPlus, LuTriangleAlert } from 'react-icons/lu'
import { createCurrency, getCurrencies, phase11Keys, reorderCurrencies, updateCurrency } from '../api/phase11'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from './Field'
import FormDialog from './FormDialog'
import StatusBadge from './StatusBadge'
import { ErrorState, Loading } from './States'
import { formatDate } from '../utils/format'
import { STALE_DAYS, ageLabel, currencyErrors, currencyFormValues, isStale, rateAgeDays, rateExample, toCurrencyValues } from '../utils/currencies'
import { actionErrorMessage } from '../utils/permissions'

/**
 * Settings → Currencies (phase 11 §5): the currencies shoppers may choose to
 * see prices in. The store keeps charging in USD; staff type the rates in
 * (no paid rate service). Add, edit, turn off or on, and reorder with
 * buttons (no dragging). Rates older than 30 days get a warning. There is no
 * delete: a currency is turned off instead. Read with settings.view, change
 * with settings.edit (the API refuses the same).
 */
function CurrenciesEditor() {
  const { can } = useAdminAuth()
  const editable = can('settings.edit')
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: phase11Keys.currencies, queryFn: ({ signal }) => getCurrencies({ signal }) })
  const [editing, setEditing] = useState(null) // a currency, or {} for a new one
  const [notice, setNotice] = useState(null)
  const [order, setOrder] = useState(null) // ids while a move is being saved
  const [announcement, setAnnouncement] = useState('')
  const noticeRef = useRef(null)
  const openerRef = useRef(null)
  const buttons = useRef(new Map())

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const toggle = useMutation({
    mutationFn: (currency) => updateCurrency(currency.id, { enabled: !currency.enabled }),
    onSuccess: ({ currency }) => {
      queryClient.invalidateQueries({ queryKey: phase11Keys.currencies })
      setNotice({ tone: 'success', text: currency.enabled ? `${currency.code} is shown to shoppers.` : `${currency.code} is turned off: shoppers can no longer choose it.` })
    },
    // e.g. "Enter a rate before turning this currency on." (errors.rate).
    onError: (error) => setNotice({ tone: 'error', text: error.fieldErrors ? Object.values(error.fieldErrors)[0][0] : actionErrorMessage(error) }),
  })
  const reorder = useMutation({
    mutationFn: (ids) => reorderCurrencies(ids),
    onSuccess: (data) => {
      if (Array.isArray(data?.currencies)) queryClient.setQueryData(phase11Keys.currencies, data)
      else queryClient.invalidateQueries({ queryKey: phase11Keys.currencies })
      setOrder(null)
    },
    onError: (error) => {
      setOrder(null)
      setNotice({ tone: 'error', text: `The new order wasn't saved: ${actionErrorMessage(error)}` })
    },
  })

  // An API without display currencies (before phase 11): no panel.
  if (list.error?.status === 404) return null
  const currencies = list.data?.currencies ?? []
  const shown = order ? order.map((id) => currencies.find((currency) => currency.id === id)).filter(Boolean) : currencies
  const stale = shown.filter((currency) => isStale(currency))

  function move(index, step) {
    // While a move is saved, further presses wait (the buttons stay enabled, so focus is never lost).
    if (reorder.isPending) return
    const ids = shown.map((currency) => currency.id)
    const [id] = ids.splice(index, 1)
    const target = index + step
    ids.splice(target, 0, id)
    setOrder(ids)
    reorder.mutate(ids)
    setAnnouncement(`${shown[index].code} moved to position ${target + 1} of ${ids.length}.`)
    const atEnd = step < 0 ? target === 0 : target === ids.length - 1
    requestAnimationFrame(() => buttons.current.get(`${id}-${(step < 0) !== atEnd ? 'up' : 'down'}`)?.focus())
  }
  function open(currency, event) {
    openerRef.current = event.currentTarget
    setNotice(null)
    setEditing(currency)
  }

  return (
    <section className="panel settings__group currencies" aria-labelledby="settings-currencies">
      <div className="rates__head currencies__head">
        <h2 id="settings-currencies" className="panel__title">
          Currencies
        </h2>
        {editable && list.data && (
          <button type="button" className="btn btn--outline btn--sm" onClick={(event) => open({}, event)}>
            <LuPlus aria-hidden="true" /> Add currency
          </button>
        )}
      </div>
      <p className="field__hint">
        The store charges in {list.data?.base ?? 'USD'}. Shoppers can choose to see prices in these currencies instead, in this order; the rates are typed in here. A currency is offered only when it is on
        and its rate is above 0. The admin always shows {list.data?.base ?? 'USD'}.
      </p>
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
      {list.isPending && <Loading label="Loading currencies…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {stale.length > 0 && (
        <p className="notice currencies__stale">
          <LuTriangleAlert aria-hidden="true" />
          <span>
            {stale.length === 1 ? `The ${stale[0].code} rate is` : `The ${stale.map((currency) => currency.code).join(', ')} rates are`} more than {STALE_DAYS} days old. Check{' '}
            {stale.length === 1 ? 'it is' : 'they are'} still right: shoppers see prices converted with {stale.length === 1 ? 'it' : 'them'}.
          </span>
        </p>
      )}
      {list.data && shown.length === 0 && <p className="muted">No display currencies yet. Shoppers see prices in {list.data.base ?? 'USD'} only.</p>}
      {shown.length > 0 && (
        // Focusable, so keyboard users can scroll it sideways on a phone.
        <div className="table-wrap" role="region" aria-label="Display currencies" tabIndex={0}>
          <table className="table currencies__table">
            <thead>
              <tr>
                <th scope="col">Currency</th>
                <th scope="col">Rate</th>
                <th scope="col" className="num">
                  Decimals
                </th>
                <th scope="col">Shoppers</th>
                <th scope="col">Last updated</th>
                {editable && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((currency, index) => {
                const days = rateAgeDays(currency.updatedAt)
                const old = isStale(currency)
                return (
                  <tr key={currency.id}>
                    <th scope="row">
                      {currency.code} <span className="muted">{currency.symbol}</span>
                    </th>
                    <td>{currency.rate > 0 ? rateExample(currency) : <span className="muted">No rate yet</span>}</td>
                    <td className="num">{currency.decimals}</td>
                    <td>
                      {currency.enabled && currency.rate > 0 ? (
                        <StatusBadge tone="success" label="Offered" />
                      ) : currency.enabled ? (
                        <StatusBadge tone="warning" label="On, but no rate" />
                      ) : (
                        <StatusBadge tone="neutral" label="Off" />
                      )}
                    </td>
                    <td>
                      {formatDate(currency.updatedAt)} <small className="muted">({ageLabel(days)})</small>
                      {old && <StatusBadge tone="warning" label={`Older than ${STALE_DAYS} days`} />}
                    </td>
                    {editable && (
                      <td className="table__actions">
                        <div className="rates__tools">
                          <button
                            type="button"
                            ref={(node) => buttons.current.set(`${currency.id}-up`, node)}
                            className="icon-button"
                            aria-label={`Move ${currency.code} up`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <LuArrowUp aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            ref={(node) => buttons.current.set(`${currency.id}-down`, node)}
                            className="icon-button"
                            aria-label={`Move ${currency.code} down`}
                            disabled={index === shown.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <LuArrowDown aria-hidden="true" />
                          </button>
                          <button type="button" className="icon-button" aria-label={`Edit ${currency.code}`} onClick={(event) => open(currency, event)}>
                            <LuPencil aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            aria-label={`${currency.enabled ? 'Turn off' : 'Turn on'} ${currency.code}`}
                            disabled={toggle.isPending}
                            onClick={() => toggle.mutate(currency)}
                          >
                            {currency.enabled ? 'Turn off' : 'Turn on'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CurrencyDialog
          currency={editing.id ? editing : null}
          codes={currencies.map((currency) => currency.code)}
          onDone={(text) => {
            setEditing(null)
            queryClient.invalidateQueries({ queryKey: phase11Keys.currencies })
            setNotice({ tone: 'success', text })
          }}
          onCancel={() => {
            setEditing(null)
            openerRef.current?.focus()
          }}
        />
      )}
    </section>
  )
}

function CurrencyDialog({ currency, codes, onDone, onCancel }) {
  const [values, setValues] = useState(() => currencyFormValues(currency))
  const [errors, setErrors] = useState({})
  const save = useMutation({
    mutationFn: (sent) => (currency ? updateCurrency(currency.id, sent) : createCurrency(sent)),
    onSuccess: (data) => {
      const saved = data?.currency ?? {}
      const code = saved.code || currency?.code || values.code.trim().toUpperCase()
      onDone(currency ? `${code} saved.` : `${code} added${saved.enabled ?? values.enabled ? ' and shown to shoppers' : '. Turn it on when the rate is right'}.`)
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })

  function submit() {
    const found = currencyErrors(values, { isNew: !currency, codes })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const sent = toCurrencyValues(values, currency)
    if (Object.keys(sent).length === 0) return onDone(`Nothing to save: ${currency.code} has no changes.`)
    save.mutate(sent)
  }
  const preview = Number(values.rate)
  const other = save.error && (save.error.fieldErrors ? Object.entries(save.error.fieldErrors).find(([field]) => !['code', 'symbol', 'rate', 'decimals', 'enabled'].includes(field))?.[1]?.[0] : actionErrorMessage(save.error))
  return (
    <FormDialog
      isOpen
      title={currency ? `Edit ${currency.code}` : 'Add a display currency'}
      description="Rates are units of this currency per 1 USD, typed in by staff. Saving a new rate updates its “last updated” date."
      submitLabel={currency ? 'Save currency' : 'Add currency'}
      busy={save.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {!currency && (
        <Field label="Code" error={errors.code?.[0]} hint="The 3-letter ISO 4217 code, like BDT or EUR. It can't change later.">
          {(a11y) => <input {...a11y} value={values.code} maxLength={3} autoComplete="off" spellCheck={false} style={{ textTransform: 'uppercase' }} onChange={set('code')} />}
        </Field>
      )}
      <Field label="Symbol" error={errors.symbol?.[0]} hint="Up to 5 characters, like ৳ or €.">
        {(a11y) => <input {...a11y} value={values.symbol} maxLength={5} autoComplete="off" onChange={set('symbol')} />}
      </Field>
      <Field label="Rate (units per 1 USD)" error={errors.rate?.[0]} hint="For example 110.5 for BDT. Up to 8 decimals.">
        {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="any" value={values.rate} onChange={set('rate')} />}
      </Field>
      <Field label="Decimals shown" error={errors.decimals?.[0]}>
        {(a11y) => (
          <select {...a11y} value={values.decimals} onChange={set('decimals')}>
            {[0, 1, 2, 3].map((places) => (
              <option key={places} value={String(places)}>
                {places}
              </option>
            ))}
          </select>
        )}
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={values.enabled} onChange={set('enabled')} />
        Shoppers can choose it
      </label>
      <p className="field__hint" aria-live="polite">
        {values.rate.trim() !== '' && Number.isFinite(preview) && preview > 0 && values.symbol.trim()
          ? `${rateExample({ symbol: values.symbol.trim(), rate: preview, decimals: Number(values.decimals) })}. A $10.00 product shows as about ${values.symbol.trim()} ${(10 * preview).toFixed(Number(values.decimals))}.`
          : ''}
      </p>
    </FormDialog>
  )
}

export default CurrenciesEditor
