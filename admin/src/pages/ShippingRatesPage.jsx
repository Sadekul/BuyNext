import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowDown, LuArrowLeft, LuArrowUp, LuDownload, LuPencil, LuPlus, LuTrash2, LuUpload } from 'react-icons/lu'
import {
  checkShippingRates,
  createShippingRate,
  deleteShippingRate,
  getShippingRates,
  importShippingRates,
  phase10Keys,
  reorderShippingRates,
  shippingRatesCsvUrl,
  updateShippingRate,
} from '../api/phase10'
import { adminKeys, getSettings } from '../api/admin'
import ConfirmDialog from '../components/ConfirmDialog'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import PageHeader from '../components/PageHeader'
import { ErrorState, Loading } from '../components/States'
import { formatCount, formatMoney } from '../utils/format'
import { SHIPPING_METHODS, csvRowProblems, describeRange, methodLabel, rateErrors, rateFormValues, rateName, toRateValues } from '../utils/shippingRates'

/*
 * Settings → Shipping → Table rates (docs/backend/PHASE10_CONTRACT.md §4),
 * settings.edit. Each method's rows are tried in order: the first row that
 * matches the cart's country (an exact country before "*"), weight, and
 * order value sets the price; when a method has rows and none matches, the
 * method isn't offered. Methods without rows keep their flat price.
 * Rows move with Move up / Move down buttons (no dragging), like phase 5's images.
 */
function ShippingRatesPage() {
  const rates = useQuery({ queryKey: phase10Keys.shippingRates, queryFn: ({ signal }) => getShippingRates({ signal }) })
  // Only for the country suggestions: the page works without it.
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: ({ signal }) => getSettings({ signal }), retry: false })
  const [notice, setNotice] = useState(null) // { tone, text }
  const noticeRef = useRef(null)
  const [editing, setEditing] = useState(null) // { rate } | { method } (new)
  const [toDelete, setToDelete] = useState(null)
  const openerRef = useRef(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const remove = useMutation({
    mutationFn: (rate) => deleteShippingRate(rate.id),
    onSuccess: (_, rate) => {
      setToDelete(null)
      queryClient.invalidateQueries({ queryKey: phase10Keys.shippingRates })
      setNotice({ tone: 'success', text: `${rateName(rate)} deleted.` })
    },
    onError: (error) => {
      setToDelete(null)
      setNotice({ tone: 'error', text: error.message })
    },
  })

  function openEditor(target, event) {
    openerRef.current = event.currentTarget
    setNotice(null)
    setEditing(target)
  }
  function closeEditor() {
    setEditing(null)
    openerRef.current?.focus()
  }

  return (
    <>
      <title>Shipping table rates | BuyNest Admin</title>
      <Link to="/settings" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Settings
      </Link>
      <PageHeader
        title="Shipping table rates"
        description="Prices by country, cart weight, and order value. A method with rows takes its price from the first row that matches; without rows it keeps its flat price from Settings → Shipping."
        actions={
          <a href={shippingRatesCsvUrl()} className="btn btn--outline" download>
            <LuDownload aria-hidden="true" /> Export CSV
          </a>
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>

      {rates.isPending && <Loading label="Loading the table rates…" />}
      {rates.error && <ErrorState error={rates.error} onRetry={rates.refetch} />}
      {rates.data && (
        <div className="rates">
          {SHIPPING_METHODS.map(({ id }) => (
            <MethodRates
              key={id}
              method={id}
              rates={rates.data.rates.filter((rate) => rate.method === id).sort((a, b) => a.position - b.position || a.id - b.id)}
              flatPrice={rates.data.methods?.find((method) => method.id === id)?.flatPrice ?? null}
              onAdd={(event) => openEditor({ method: id }, event)}
              onEdit={(rate, event) => openEditor({ rate }, event)}
              onDelete={(rate) => setToDelete(rate)}
              onNotice={setNotice}
            />
          ))}
          <CheckCart />
          <ImportRates onNotice={setNotice} />
        </div>
      )}
      {/* The countries the store ships to (Settings → Checkout), offered in the country fields. */}
      <datalist id="rate-countries">
        <option value="*">Any country</option>
        {(settings.data?.checkout?.allowedCountries ?? []).map((country) => (
          <option key={country} value={country} />
        ))}
      </datalist>

      {editing && (
        <RateDialog
          rate={editing.rate}
          method={editing.method}
          onDone={(message) => {
            setEditing(null)
            queryClient.invalidateQueries({ queryKey: phase10Keys.shippingRates })
            setNotice({ tone: 'success', text: message })
          }}
          onCancel={closeEditor}
        />
      )}
      <ConfirmDialog
        isOpen={toDelete !== null}
        title={`Delete ${toDelete ? rateName(toDelete) : 'this rate'}?`}
        message="Carts it matched take the next matching row. If no row of this method is left, the method goes back to its flat price."
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </>
  )
}

// "an express rate", "a standard rate".
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

/** One method's rows, in the order they are tried. */
function MethodRates({ method, rates, flatPrice, onAdd, onEdit, onDelete, onNotice }) {
  const queryClient = useQueryClient()
  const [order, setOrder] = useState(null) // ids while a move is being saved
  // Moves are announced here, politely, without taking focus from the button that moved the row.
  const [announcement, setAnnouncement] = useState('')
  const buttons = useRef(new Map())
  const label = methodLabel(method)
  const titleId = `rates-${method}`
  const shown = order ? order.map((id) => rates.find((rate) => rate.id === id)).filter(Boolean) : rates

  const reorder = useMutation({
    mutationFn: (ids) => reorderShippingRates(method, ids),
    onSuccess: (data) => {
      if (Array.isArray(data?.rates)) queryClient.setQueryData(phase10Keys.shippingRates, (current) => (current ? { ...current, rates: data.rates } : current))
      else queryClient.invalidateQueries({ queryKey: phase10Keys.shippingRates })
      setOrder(null)
    },
    onError: (error) => {
      setOrder(null)
      onNotice({ tone: 'error', text: `The new order wasn't saved: ${error.message}` })
    },
  })

  function move(index, step) {
    // While a move is saved, further presses wait (the buttons stay enabled, so focus is never lost).
    if (reorder.isPending) return
    const ids = shown.map((rate) => rate.id)
    const [id] = ids.splice(index, 1)
    const target = index + step
    ids.splice(target, 0, id)
    setOrder(ids)
    reorder.mutate(ids)
    setAnnouncement(`${label} rate moved to position ${target + 1} of ${ids.length}.`)
    // Keep focus on the same button, or on the other one once the row reaches an end.
    const atEnd = step < 0 ? target === 0 : target === ids.length - 1
    requestAnimationFrame(() => buttons.current.get(`${id}-${(step < 0) !== atEnd ? 'up' : 'down'}`)?.focus())
  }

  return (
    <section className="panel rates__method" aria-labelledby={titleId}>
      <div className="rates__head">
        <h2 id={titleId} className="panel__title">
          {label}
        </h2>
        <button type="button" className="btn btn--outline btn--sm" onClick={onAdd}>
          <LuPlus aria-hidden="true" /> Add {article(label)} {label.toLowerCase()} rate
        </button>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {shown.length === 0 ? (
        <p className="muted rates__empty">
          No table rates: {label} keeps its flat price{typeof flatPrice === 'number' ? ` of ${formatMoney(flatPrice)}` : ''} from Settings → Shipping.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table rates__table">
            <caption className="visually-hidden">{label} rates, in the order they are tried</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Country</th>
                <th scope="col">Weight</th>
                <th scope="col">Order value</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((rate, index) => (
                <tr key={rate.id}>
                  <td>{index + 1}</td>
                  <td>{rate.country === '*' ? 'Any country' : rate.country}</td>
                  <td>{describeRange(rate.minWeightGrams, rate.maxWeightGrams, (grams) => `${formatCount(grams)} g`)}</td>
                  <td>{describeRange(rate.minSubtotal, rate.maxSubtotal, formatMoney)}</td>
                  <td className="num">{rate.price === 0 ? 'Free' : formatMoney(rate.price)}</td>
                  <td className="table__actions">
                    <div className="rates__tools">
                      <button
                        type="button"
                        ref={(node) => buttons.current.set(`${rate.id}-up`, node)}
                        className="icon-button"
                        aria-label={`Move ${label.toLowerCase()} rate ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <LuArrowUp aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        ref={(node) => buttons.current.set(`${rate.id}-down`, node)}
                        className="icon-button"
                        aria-label={`Move ${label.toLowerCase()} rate ${index + 1} down`}
                        disabled={index === shown.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <LuArrowDown aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button" aria-label={`Edit ${label.toLowerCase()} rate ${index + 1}`} onClick={(event) => onEdit(rate, event)}>
                        <LuPencil aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button icon-button--danger" aria-label={`Delete ${label.toLowerCase()} rate ${index + 1}`} onClick={() => onDelete(rate)}>
                        <LuTrash2 aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Add (`method`) or edit (`rate`) one row. */
function RateDialog({ rate, method, onDone, onCancel }) {
  const [values, setValues] = useState(() => rateFormValues(rate ?? { method }))
  const [errors, setErrors] = useState({})
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.value })
  const save = useMutation({
    mutationFn: (sent) => (rate ? updateShippingRate(rate.id, sent) : createShippingRate(sent)),
    onSuccess: (data) => {
      const saved = data?.rate ?? { ...values, method: values.method }
      onDone(rate ? `${rateName(saved)} saved.` : `${rateName(saved)} added at the end of the ${methodLabel(saved.method).toLowerCase()} rates.`)
    },
    onError: (error) => setErrors(error.fieldErrors ?? {}),
  })

  function submit() {
    const found = rateErrors(values)
    setErrors(found)
    if (Object.keys(found).length === 0) save.mutate(toRateValues(values))
  }
  const error = (key) => errors[key]?.[0]
  const shown = ['method', 'country', 'minWeightGrams', 'maxWeightGrams', 'minSubtotal', 'maxSubtotal', 'price']
  const other = save.error && (save.error.fieldErrors ? Object.entries(save.error.fieldErrors).find(([field]) => !shown.includes(field))?.[1]?.[0] : save.error.message)

  return (
    <FormDialog
      isOpen
      wide
      title={rate ? `Edit ${rateName(rate)}` : `Add ${article(methodLabel(method))} ${methodLabel(method).toLowerCase()} rate`}
      description="A row matches from its minimum up to (not including) its maximum; an empty maximum means no limit. Weights in grams, amounts in USD; the order value is before cart discounts."
      submitLabel={rate ? 'Save rate' : 'Add rate'}
      busy={save.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      <div className="form__grid">
        <Field label="Method" error={error('method')}>
          {(a11y) => (
            <select {...a11y} value={values.method} onChange={set('method')}>
              {SHIPPING_METHODS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Country" error={error('country')} hint="As in Settings → Checkout (the shopper's address), or * for any country.">
          {(a11y) => <input {...a11y} value={values.country} maxLength={60} list="rate-countries" autoComplete="off" onChange={set('country')} />}
        </Field>
        <Field label="Weight from (g)" error={error('minWeightGrams')}>
          {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="0" step="1" value={values.minWeightGrams} onChange={set('minWeightGrams')} />}
        </Field>
        <Field label="Weight up to (g)" error={error('maxWeightGrams')} hint="Empty: no limit.">
          {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="0" step="1" value={values.maxWeightGrams} onChange={set('maxWeightGrams')} />}
        </Field>
        <Field label="Order value from (USD)" error={error('minSubtotal')}>
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" value={values.minSubtotal} onChange={set('minSubtotal')} />}
        </Field>
        <Field label="Order value up to (USD)" error={error('maxSubtotal')} hint="Empty: no limit.">
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" value={values.maxSubtotal} onChange={set('maxSubtotal')} />}
        </Field>
        <Field label="Price (USD)" error={error('price')} hint="0 = free with this row.">
          {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" value={values.price} onChange={set('price')} />}
        </Field>
      </div>
    </FormDialog>
  )
}

/** "Check a cart": what each method would cost for a country, weight, and order value. */
function CheckCart() {
  const [values, setValues] = useState({ country: '', weightGrams: '', subtotal: '' })
  const [errors, setErrors] = useState({})
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.value })
  const check = useMutation({ mutationFn: checkShippingRates, onError: (error) => setErrors(error.fieldErrors ?? {}) })

  function submit(event) {
    event.preventDefault()
    const found = {}
    const country = values.country.trim()
    const weight = Number(values.weightGrams)
    const subtotal = Number(values.subtotal)
    if (!country || country.length > 60) found.country = ['Enter the country, as in Settings → Checkout.']
    if (values.weightGrams.trim() === '' || !Number.isInteger(weight) || weight < 0) found.weightGrams = ['Enter the cart weight in whole grams.']
    if (values.subtotal.trim() === '' || !Number.isFinite(subtotal) || subtotal < 0 || Math.abs(subtotal * 100 - Math.round(subtotal * 100)) > 1e-6) found.subtotal = ['Enter an amount of 0 or more, with at most 2 decimals.']
    setErrors(found)
    if (Object.keys(found).length === 0) check.mutate({ country, weightGrams: weight, subtotal })
  }

  const result = check.data
  return (
    <section className="panel rates__check" aria-labelledby="rates-check">
      <h2 id="rates-check" className="panel__title">
        Check a cart
      </h2>
      <form className="form" noValidate onSubmit={submit}>
        <p className="field__hint">The price each enabled method would have, from the saved rates. Free-shipping rules aren't applied here.</p>
        <div className="form__grid">
          <Field label="Country" error={errors.country?.[0]}>
            {(a11y) => <input {...a11y} value={values.country} maxLength={60} list="rate-countries" autoComplete="off" onChange={set('country')} />}
          </Field>
          <Field label="Cart weight (g)" error={errors.weightGrams?.[0]}>
            {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="0" step="1" value={values.weightGrams} onChange={set('weightGrams')} />}
          </Field>
          <Field label="Order value (USD)" error={errors.subtotal?.[0]}>
            {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" value={values.subtotal} onChange={set('subtotal')} />}
          </Field>
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={check.isPending}>
            {check.isPending ? 'Checking…' : 'Check prices'}
          </button>
        </div>
      </form>
      {check.error && !check.error.fieldErrors && (
        <p className="form-error" role="alert">
          {check.error.message}
        </p>
      )}
      {/* Announced when the answer arrives. */}
      <div role="status" aria-live="polite">
        {result && (
          <table className="table">
            <caption>
              Shipping for {result.country ?? values.country.trim()}, {formatCount(result.weightGrams ?? Number(values.weightGrams))} g, {formatMoney(result.subtotal ?? Number(values.subtotal))}
            </caption>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">Price</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {result.methods.map((option) => (
                <tr key={option.method}>
                  <th scope="row">{option.label ?? methodLabel(option.method)}</th>
                  <td>{option.available ? (option.price === 0 ? 'Free' : formatMoney(option.price)) : 'Not offered'}</td>
                  <td className="muted">{checkReason(option)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

function checkReason(option) {
  if (!option.available) return 'No table rate matches this cart, so it isn\'t offered.'
  if (option.source === 'table') return 'From a table rate.'
  return 'Flat price (no table rates for this method).'
}

/** CSV import: replace the rows of the methods in the file (default), or add to them. All or nothing. */
function ImportRates({ onNotice }) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const [mode, setMode] = useState('replace')
  const [fileError, setFileError] = useState(null)
  const upload = useMutation({
    mutationFn: () => importShippingRates(file, { mode }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: phase10Keys.shippingRates })
      const replaced = result.replaced ? ` and replaced ${formatCount(result.replaced)} old ${result.replaced === 1 ? 'row' : 'rows'}` : ''
      onNotice({ tone: 'success', text: `Imported ${formatCount(result.imported ?? 0)} ${result.imported === 1 ? 'rate' : 'rates'}${replaced}.` })
    },
  })
  // A refused file: every bad row ("rows.3.price") with its message; nothing was saved.
  const problems = csvRowProblems(upload.error?.fieldErrors)
  const fileProblem = upload.error?.fieldErrors?.file?.[0] ?? upload.error?.fieldErrors?.mode?.[0]

  function submit(event) {
    event.preventDefault()
    if (!file) {
      setFileError('Choose a CSV file.')
      return
    }
    setFileError(null)
    upload.mutate()
  }

  return (
    <section className="panel rates__import" aria-labelledby="rates-import">
      <h2 id="rates-import" className="panel__title">
        Import from CSV
      </h2>
      <form className="form" noValidate onSubmit={submit}>
        <p className="field__hint">
          Columns: method (standard, express, nextDay), country (a name or *), min_weight_grams, max_weight_grams, min_subtotal, max_subtotal, price, position. Empty
          maximums mean no limit. Export first to get a file in the right shape. If any row has a problem, nothing is imported.
        </p>
        <Field label="CSV file" error={fileError ?? fileProblem}>
          {(a11y) => <input {...a11y} type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
        </Field>
        <fieldset className="form__fieldset choices">
          <legend>What to do with the current rates</legend>
          <label className="checkbox">
            <input type="radio" name="rates-import-mode" value="replace" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            Replace the rates of the methods in the file
          </label>
          <label className="checkbox">
            <input type="radio" name="rates-import-mode" value="append" checked={mode === 'append'} onChange={() => setMode('append')} />
            Keep them and add the file's rows after them
          </label>
        </fieldset>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={upload.isPending}>
            <LuUpload aria-hidden="true" /> {upload.isPending ? 'Importing…' : 'Import rates'}
          </button>
        </div>
      </form>
      {upload.error && !fileProblem && (
        <div className="import-errors" role="alert">
          <p className="form-error">{problems.length > 0 ? 'Nothing was imported: fix these rows and try again.' : upload.error.message}</p>
          {problems.length > 0 && (
            <ul>
              {problems.slice(0, 50).map((problem) => (
                <li key={problem.key}>
                  Row {problem.row}
                  {problem.column && ` (${problem.column})`}: {problem.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export default ShippingRatesPage
