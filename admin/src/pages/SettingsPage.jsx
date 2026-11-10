import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import { adminKeys, getSettings, updateSettings } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import { ErrorState, Loading } from '../components/States'

const SHIPPING_METHODS = [
  { id: 'standard', label: 'Standard' },
  { id: 'express', label: 'Express' },
  { id: 'nextDay', label: 'Next day' },
]
const PAYMENT_METHODS = [
  { id: 'card', label: 'Credit or debit card' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'cod', label: 'Cash on delivery' },
]
const KNOWN_COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Australia', 'Germany', 'Bangladesh', 'India']
const MONEY_FIELDS = ['standardPrice', 'freeShippingThreshold', 'expressPrice', 'nextDayPrice']

const toText = (value) => (value === null || value === undefined ? '' : String(value))
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const isMoneyText = (text) => text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) >= 0 && hasCents(Number(text))

/**
 * Store settings, one form per group (General, Shipping, Tax, Checkout,
 * Inventory), each saved on its own. The server applies these rules to
 * every cart and order. Needs settings.view; saving settings.edit.
 */
function SettingsPage() {
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: ({ signal }) => getSettings({ signal }) })
  return (
    <>
      <title>Settings | BuyNest Admin</title>
      <PageHeader title="Settings" description="The rules the store and the server apply to every cart and order." />
      {settings.isPending && <Loading label="Loading settings…" />}
      {settings.error && <ErrorState error={settings.error} onRetry={settings.refetch} />}
      {settings.data && (
        <div className="settings">
          <GeneralForm saved={settings.data.general} />
          <ShippingForm saved={settings.data.shipping} />
          <TaxForm saved={settings.data.tax} />
          <CheckoutForm saved={settings.data.checkout} />
          <InventoryForm saved={settings.data.inventory} />
        </div>
      )}
    </>
  )
}

/**
 * One settings group's panel: its own Save, its own message, server errors
 * ("shipping.standardPrice") shown on the fields. `toValues()` returns the
 * changes or { errors } from the checks done here first.
 */
function SettingsGroup({ group, title, description, toValues, setErrors, children }) {
  const queryClient = useQueryClient()
  const { can } = useAdminAuth()
  const editable = can('settings.edit')
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const save = useMutation({
    mutationFn: (values) => updateSettings({ [group]: values }),
    onSuccess: (data) => {
      queryClient.setQueryData(adminKeys.settings, data)
      setErrors({})
      setNotice({ tone: 'success', text: `${title} saved.` })
      requestAnimationFrame(() => noticeRef.current?.focus())
    },
    onError: (error) => {
      const prefix = `${group}.`
      setErrors(Object.fromEntries(Object.entries(error.fieldErrors ?? {}).filter(([field]) => field.startsWith(prefix)).map(([field, messages]) => [field.slice(prefix.length), messages])))
      setNotice({ tone: 'error', text: error.fieldErrors ? 'Please check the highlighted fields.' : error.message })
      requestAnimationFrame(() => noticeRef.current?.focus())
    },
  })

  function submit(event) {
    event.preventDefault()
    const result = toValues()
    if (result.errors) {
      setErrors(result.errors)
      setNotice({ tone: 'error', text: 'Please check the highlighted fields.' })
      return
    }
    setErrors({})
    save.mutate(result.values)
  }

  const titleId = `settings-${group}`
  return (
    <form className="panel form settings__group" aria-labelledby={titleId} noValidate onSubmit={submit}>
      <h2 id={titleId} className="panel__title">
        {title}
      </h2>
      {description && <p className="field__hint">{description}</p>}
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>
      <fieldset disabled={!editable} className="form__fieldset">
        {children}
      </fieldset>
      {editable && (
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : `Save ${title.toLowerCase()}`}
          </button>
        </div>
      )}
    </form>
  )
}

const err = (errors, key) => errors[key]?.[0]

function GeneralForm({ saved }) {
  const [values, setValues] = useState({ storeName: toText(saved.storeName), supportEmail: toText(saved.supportEmail), supportPhone: toText(saved.supportPhone), address: toText(saved.address) })
  const [errors, setErrors] = useState({})
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.value })
  function toValues() {
    const found = {}
    if (!values.storeName.trim()) found.storeName = ['Enter the store name.']
    if (values.supportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.supportEmail.trim())) found.supportEmail = ['Enter a valid email address.']
    return Object.keys(found).length > 0 ? { errors: found } : { values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])) }
  }
  return (
    <SettingsGroup group="general" title="General" description="Shown to shoppers in the footer, emails, and on the contact page." toValues={toValues} errors={errors} setErrors={setErrors}>
      <div className="form__grid">
        <Field label="Store name" error={err(errors, 'storeName')}>
          {(a11y) => <input {...a11y} value={values.storeName} maxLength={100} onChange={set('storeName')} />}
        </Field>
        <Field label="Support email" error={err(errors, 'supportEmail')}>
          {(a11y) => <input {...a11y} type="email" value={values.supportEmail} maxLength={255} onChange={set('supportEmail')} />}
        </Field>
        <Field label="Support phone" error={err(errors, 'supportPhone')}>
          {(a11y) => <input {...a11y} type="tel" value={values.supportPhone} maxLength={40} onChange={set('supportPhone')} />}
        </Field>
      </div>
      <Field label="Address" error={err(errors, 'address')}>
        {(a11y) => <textarea {...a11y} rows={3} value={values.address} maxLength={500} onChange={set('address')} />}
      </Field>
    </SettingsGroup>
  )
}

/** Checkbox list → the chosen ids, in the list's order. */
function Choices({ legend, options, chosen, onChange, error, hint }) {
  return (
    <fieldset className="form__fieldset choices">
      <legend>{legend}</legend>
      {hint && <p className="field__hint">{hint}</p>}
      {options.map((option) => (
        <label key={option.id} className="checkbox">
          <input
            type="checkbox"
            checked={chosen.includes(option.id)}
            onChange={(event) => onChange(options.map((item) => item.id).filter((id) => (id === option.id ? event.target.checked : chosen.includes(id))))}
          />
          {option.label}
        </label>
      ))}
      {error && <p className="field__error">{error}</p>}
    </fieldset>
  )
}

function ShippingForm({ saved }) {
  const [values, setValues] = useState(() => ({ ...Object.fromEntries(MONEY_FIELDS.map((key) => [key, toText(saved[key])])), enabledMethods: saved.enabledMethods ?? [] }))
  const [errors, setErrors] = useState({})
  const set = (key) => (event) => setValues({ ...values, [key]: event.target.value })
  function toValues() {
    const found = {}
    for (const key of MONEY_FIELDS) if (!isMoneyText(values[key])) found[key] = ['Enter an amount of 0 or more, with at most 2 decimals.']
    if (values.enabledMethods.length === 0) found.enabledMethods = ['Keep at least one shipping method.']
    if (Object.keys(found).length > 0) return { errors: found }
    return { values: { ...Object.fromEntries(MONEY_FIELDS.map((key) => [key, Number(values[key])])), enabledMethods: values.enabledMethods } }
  }
  const money = (key, label, hint) => (
    <Field label={label} error={err(errors, key)} hint={hint}>
      {(a11y) => <input {...a11y} type="number" inputMode="decimal" min="0" step="0.01" value={values[key]} onChange={set(key)} />}
    </Field>
  )
  return (
    <SettingsGroup group="shipping" title="Shipping" description="Prices in USD." toValues={toValues} errors={errors} setErrors={setErrors}>
      <div className="form__grid">
        {money('standardPrice', 'Standard shipping price')}
        {money('freeShippingThreshold', 'Free standard shipping from', 'Order value after discounts.')}
        {money('expressPrice', 'Express price')}
        {money('nextDayPrice', 'Next-day price')}
      </div>
      <Choices legend="Shipping methods offered" options={SHIPPING_METHODS} chosen={values.enabledMethods} onChange={(enabledMethods) => setValues({ ...values, enabledMethods })} error={err(errors, 'enabledMethods')} />
    </SettingsGroup>
  )
}

let rowKey = 0
const withRowKey = (rate) => ({ ...rate, key: `rate-${rowKey++}` })

function TaxForm({ saved }) {
  const [enabled, setEnabled] = useState(saved.taxEnabled === true)
  const [includes, setIncludes] = useState(saved.pricesIncludeTax === true)
  const [rates, setRates] = useState(() => (saved.taxRates ?? []).map((rate) => withRowKey({ country: rate.country, rate: toText(rate.rate) })))
  const [errors, setErrors] = useState({})
  const [announcement, setAnnouncement] = useState('')

  function addRate() {
    const row = withRowKey({ country: '', rate: '' })
    setRates([...rates, row])
    setAnnouncement('Tax rate row added.')
    requestAnimationFrame(() => document.getElementById(`${row.key}-country`)?.focus())
  }
  function removeRate(index) {
    setAnnouncement(`Tax rate for ${rates[index].country || 'the empty row'} removed.`)
    setRates(rates.filter((_, position) => position !== index))
  }
  const setRate = (index, change) => setRates(rates.map((rate, position) => (position === index ? { ...rate, ...change } : rate)))

  function toValues() {
    const found = {}
    const countries = new Set()
    rates.forEach((rate, index) => {
      const value = Number(rate.rate)
      if (!rate.country.trim()) found[`taxRates.${index}.country`] = ['Enter a country.']
      else if (countries.has(rate.country.trim())) found[`taxRates.${index}.country`] = ['This country already has a rate.']
      countries.add(rate.country.trim())
      if (rate.rate.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100 || !hasCents(value)) found[`taxRates.${index}.rate`] = ['Enter a percentage from 0 to 100 (2 decimals).']
    })
    if (Object.keys(found).length > 0) return { errors: found }
    return { values: { taxEnabled: enabled, pricesIncludeTax: includes, taxRates: rates.map((rate) => ({ country: rate.country.trim(), rate: Number(rate.rate) })) } }
  }

  return (
    <SettingsGroup
      group="tax"
      title="Tax"
      description="When on, tax = the shipping country's rate × (items after discount + shipping), to the cent. Countries without a rate pay no tax."
      toValues={toValues}
      errors={errors}
      setErrors={setErrors}
    >
      <label className="checkbox">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Charge tax
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={includes} onChange={(event) => setIncludes(event.target.checked)} />
        Product prices already include tax
      </label>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <table className="table tax-table">
        <caption>Tax rates by country</caption>
        <thead>
          <tr>
            <th scope="col">Country</th>
            <th scope="col">Rate (%)</th>
            <th scope="col">
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rates.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No rates: no tax is charged anywhere.
              </td>
            </tr>
          )}
          {rates.map((rate, index) => {
            const countryError = err(errors, `taxRates.${index}.country`)
            const rateError = err(errors, `taxRates.${index}.rate`)
            return (
              <tr key={rate.key}>
                <td>
                  <label htmlFor={`${rate.key}-country`} className="visually-hidden">
                    Country, row {index + 1}
                  </label>
                  <input
                    id={`${rate.key}-country`}
                    value={rate.country}
                    maxLength={60}
                    list="known-countries"
                    aria-invalid={countryError ? true : undefined}
                    aria-describedby={countryError ? `${rate.key}-country-error` : undefined}
                    onChange={(event) => setRate(index, { country: event.target.value })}
                  />
                  {countryError && (
                    <span id={`${rate.key}-country-error`} className="field__error">
                      {countryError}
                    </span>
                  )}
                </td>
                <td>
                  <label htmlFor={`${rate.key}-rate`} className="visually-hidden">
                    Rate in percent for {rate.country || `row ${index + 1}`}
                  </label>
                  <input
                    id={`${rate.key}-rate`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    value={rate.rate}
                    aria-invalid={rateError ? true : undefined}
                    aria-describedby={rateError ? `${rate.key}-rate-error` : undefined}
                    onChange={(event) => setRate(index, { rate: event.target.value })}
                  />
                  {rateError && (
                    <span id={`${rate.key}-rate-error`} className="field__error">
                      {rateError}
                    </span>
                  )}
                </td>
                <td className="table__actions">
                  <button type="button" className="icon-button icon-button--danger" aria-label={`Remove the rate for ${rate.country || `row ${index + 1}`}`} onClick={() => removeRate(index)}>
                    <LuTrash2 aria-hidden="true" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {err(errors, 'taxRates') && <p className="field__error">{err(errors, 'taxRates')}</p>}
      <datalist id="known-countries">
        {KNOWN_COUNTRIES.map((country) => (
          <option key={country} value={country} />
        ))}
      </datalist>
      <button type="button" className="btn btn--outline btn--sm" onClick={addRate}>
        <LuPlus aria-hidden="true" /> Add a rate
      </button>
    </SettingsGroup>
  )
}

function CheckoutForm({ saved }) {
  const [countries, setCountries] = useState(saved.allowedCountries ?? [])
  const [options, setOptions] = useState(() => [...new Set([...KNOWN_COUNTRIES, ...(saved.allowedCountries ?? [])])])
  const [newCountry, setNewCountry] = useState('')
  const [guest, setGuest] = useState(saved.guestCheckout !== false)
  const [payments, setPayments] = useState(saved.enabledPaymentMethods ?? [])
  const [errors, setErrors] = useState({})

  function addCountry() {
    const name = newCountry.trim()
    if (!name) return
    if (!options.includes(name)) setOptions([...options, name])
    if (!countries.includes(name)) setCountries([...countries, name])
    setNewCountry('')
  }
  function toValues() {
    const found = {}
    if (countries.length === 0) found.allowedCountries = ['Keep at least one country.']
    if (payments.length === 0) found.enabledPaymentMethods = ['Keep at least one payment method.']
    return Object.keys(found).length > 0 ? { errors: found } : { values: { allowedCountries: countries, guestCheckout: guest, enabledPaymentMethods: payments } }
  }
  return (
    <SettingsGroup group="checkout" title="Checkout" toValues={toValues} errors={errors} setErrors={setErrors}>
      <Choices
        legend="Countries the store ships to"
        options={options.map((name) => ({ id: name, label: name }))}
        chosen={countries}
        onChange={setCountries}
        error={err(errors, 'allowedCountries')}
      />
      <div className="toolbar">
        <label className="toolbar__select">
          <span>Add a country</span>
          <input
            value={newCountry}
            maxLength={60}
            onChange={(event) => setNewCountry(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault() // add, don't save the form
              addCountry()
            }}
          />
        </label>
        <button type="button" className="btn btn--outline btn--sm" onClick={addCountry}>
          <LuPlus aria-hidden="true" /> Add
        </button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={guest} onChange={(event) => setGuest(event.target.checked)} />
        Guests can check out without an account
      </label>
      <Choices legend="Payment methods offered" options={PAYMENT_METHODS} chosen={payments} onChange={setPayments} error={err(errors, 'enabledPaymentMethods')} />
    </SettingsGroup>
  )
}

function InventoryForm({ saved }) {
  const [threshold, setThreshold] = useState(toText(saved.lowStockThreshold))
  const [errors, setErrors] = useState({})
  function toValues() {
    const value = Number(threshold)
    if (threshold.trim() === '' || !Number.isInteger(value) || value < 0 || value > 100_000) return { errors: { lowStockThreshold: ['Enter a whole number from 0 to 100,000.'] } }
    return { values: { lowStockThreshold: value } }
  }
  return (
    <SettingsGroup group="inventory" title="Inventory" toValues={toValues} errors={errors} setErrors={setErrors}>
      <Field label="Low-stock threshold" error={err(errors, 'lowStockThreshold')} hint="Products with fewer units than this show as low stock in the dashboard and reports.">
        {(a11y) => <input {...a11y} type="number" inputMode="numeric" min="0" step="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} />}
      </Field>
    </SettingsGroup>
  )
}

export default SettingsPage
