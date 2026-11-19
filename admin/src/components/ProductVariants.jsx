import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LuPlus, LuTrash2, LuWand } from 'react-icons/lu'
import { adminKeys, generateVariants, saveProductOptions, updateVariant } from '../api/admin'
import { formatMoney, storeCode } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'

const MAX_OPTIONS = 3
const MAX_VALUES = 20

let rowKey = 0
const withKey = (option) => ({ ...option, key: `option-${rowKey++}` })
const toRows = (options) => options.map((option) => withKey({ name: option.name, values: option.values.map((value) => value.value).join(', ') }))
const splitValues = (text) => text.split(',').map((value) => value.trim()).filter(Boolean)
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

/** "Size: M / Color: Red" from the variant's option value ids. */
function variantLabel(variant, options) {
  if (variant.label) return variant.label
  const parts = options.map((option) => {
    const value = option.values.find((item) => variant.optionValueIds.includes(item.id))
    return value ? `${option.name}: ${value.value}` : null
  })
  return parts.filter(Boolean).join(' / ') || variant.sku
}

/** The option rows' problems by row key ({ name, values }), or none. */
function checkOptions(rows) {
  const errors = {}
  const names = new Set()
  for (const row of rows) {
    const name = row.name.trim()
    const values = splitValues(row.values)
    const problem = {}
    if (!name || name.length > 40) problem.name = 'Name the option (up to 40 characters).'
    else if (names.has(name.toLowerCase())) problem.name = 'Each option needs its own name.'
    names.add(name.toLowerCase())
    if (values.length === 0 || values.length > MAX_VALUES) problem.values = `Give 1 to ${MAX_VALUES} values, separated by commas.`
    else if (values.some((value) => value.length > 40)) problem.values = 'Keep each value to 40 characters or fewer.'
    else if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) problem.values = 'Each value can appear once.'
    if (Object.keys(problem).length > 0) errors[row.key] = problem
  }
  return errors
}

/**
 * Product form → Options and variants (Magento's configurable product):
 * define up to 3 options (Size, Color…) with their values, generate every
 * combination, then set each variant's SKU, price, stock, and whether it's
 * sold. A product with variants sells only through them.
 */
function ProductVariants({ productId, product, editable }) {
  const queryClient = useQueryClient()
  const id = useId()
  const [rows, setRows] = useState(() => toRows(product.options))
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  // Changed since the last save (compared as the server stores them: trimmed, split).
  const dirty = JSON.stringify(rows.map((row) => [row.name.trim(), splitValues(row.values)])) !== JSON.stringify(product.options.map((option) => [option.name, option.values.map((value) => value.value)]))

  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.product(productId) })
  const fail = (error) => setMessage({ tone: 'error', text: error.fieldErrors ? 'The server refused the options: check the messages below.' : actionErrorMessage(error) })

  const saveOptions = useMutation({
    mutationFn: () => saveProductOptions(productId, rows.map((row) => ({ name: row.name.trim(), values: splitValues(row.values) }))),
    onSuccess: async () => {
      await refresh()
      setErrors({})
      setMessage({ tone: 'success', text: 'Options saved. Variants whose values were removed are no longer sold. Generate combinations to add the new ones.' })
    },
    onError: (error) => {
      // Server errors come as options.0.name / options.0.values.
      const found = {}
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        const match = /^options\.(\d+)\.(name|values)/.exec(field)
        const row = match && rows[Number(match[1])]
        if (row) found[row.key] = { ...found[row.key], [match[2]]: messages[0] }
      }
      setErrors(found)
      fail(error)
    },
  })

  const generate = useMutation({
    mutationFn: () => generateVariants(productId),
    onSuccess: async (result) => {
      const before = product.variants.length
      await refresh()
      const created = result?.created ?? Math.max(0, (result?.variants?.length ?? before) - before)
      setMessage({ tone: 'success', text: created > 0 ? `${created} new ${created === 1 ? 'variant' : 'variants'} added, inactive with 0 in stock: set their stock and turn them on.` : 'Every combination already exists.' })
    },
    onError: fail,
  })

  function submitOptions(event) {
    event.preventDefault()
    const found = checkOptions(rows)
    setErrors(found)
    if (Object.keys(found).length > 0) return setMessage({ tone: 'error', text: 'Please check the highlighted options.' })
    setMessage(null)
    saveOptions.mutate()
  }
  function addOption() {
    const row = withKey({ name: '', values: '' })
    setRows([...rows, row])
    setAnnouncement('Option added.')
    requestAnimationFrame(() => document.getElementById(`${id}-${row.key}-name`)?.focus())
  }
  function removeOption(index) {
    setAnnouncement(`Option ${rows[index].name || index + 1} removed. Save the options to apply it.`)
    setRows(rows.filter((_, position) => position !== index))
  }
  const setRow = (index, change) => setRows(rows.map((row, position) => (position === index ? { ...row, ...change } : row)))

  return (
    <section className="panel panel--padded product-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="panel__title">
        Options and variants
      </h2>
      <p className="field__hint">
        For products sold in several versions, like sizes or colors. With variants, the product is sold only through them: each has its own SKU and stock, and
        the price is the product&apos;s unless set. The discount applies to every variant.
      </p>
      <div role={message?.tone === 'error' ? 'alert' : 'status'}>{message && <p className={message.tone === 'error' ? 'form-error' : 'notice notice--success'}>{message.text}</p>}</div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      <form onSubmit={submitOptions} noValidate>
        <fieldset className="form__fieldset" disabled={!editable}>
          <legend>Options</legend>
          {rows.length === 0 && <p className="muted">No options: the product is sold as one item.</p>}
          {rows.map((row, index) => {
            const rowErrors = errors[row.key] ?? {}
            const nameId = `${id}-${row.key}-name`
            const valuesId = `${id}-${row.key}-values`
            return (
              <div key={row.key} className="option-row">
                <div className="field">
                  <label htmlFor={nameId}>Option {index + 1} name</label>
                  <input
                    id={nameId}
                    value={row.name}
                    maxLength={40}
                    placeholder="Size"
                    aria-invalid={rowErrors.name ? true : undefined}
                    aria-describedby={rowErrors.name ? `${nameId}-error` : undefined}
                    onChange={(event) => setRow(index, { name: event.target.value })}
                  />
                  {rowErrors.name && (
                    <span id={`${nameId}-error`} className="field__error">
                      {rowErrors.name}
                    </span>
                  )}
                </div>
                <div className="field option-row__values">
                  <label htmlFor={valuesId}>Option {index + 1} values</label>
                  <input
                    id={valuesId}
                    value={row.values}
                    placeholder="S, M, L"
                    aria-invalid={rowErrors.values ? true : undefined}
                    aria-describedby={`${valuesId}-hint${rowErrors.values ? ` ${valuesId}-error` : ''}`}
                    onChange={(event) => setRow(index, { values: event.target.value })}
                  />
                  <span id={`${valuesId}-hint`} className="field__hint">
                    Separate the values with commas.
                  </span>
                  {rowErrors.values && (
                    <span id={`${valuesId}-error`} className="field__error">
                      {rowErrors.values}
                    </span>
                  )}
                </div>
                {editable && (
                  <button type="button" className="icon-button icon-button--danger" aria-label={`Remove option ${row.name || index + 1}`} onClick={() => removeOption(index)}>
                    <LuTrash2 aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })}
        </fieldset>
        {editable && (
          <div className="form__actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={addOption} disabled={rows.length >= MAX_OPTIONS}>
              <LuPlus aria-hidden="true" /> Add option
            </button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={!dirty || saveOptions.isPending}>
              {saveOptions.isPending ? 'Saving…' : 'Save options'}
            </button>
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={dirty || product.options.length === 0 || generate.isPending}
              onClick={() => {
                setMessage(null)
                generate.mutate()
              }}
            >
              <LuWand aria-hidden="true" /> {generate.isPending ? 'Generating…' : 'Generate combinations'}
            </button>
            {dirty && <span className="muted">Save the options before generating combinations.</span>}
          </div>
        )}
      </form>

      {product.variants.length > 0 && (
        <div className="table-wrap variant-table">
          <table className="table">
            <caption>Variants</caption>
            <thead>
              <tr>
                <th scope="col">Variant</th>
                <th scope="col">SKU</th>
                <th scope="col">Price ({storeCode()})</th>
                <th scope="col">Stock</th>
                <th scope="col">Sold</th>
                <th scope="col">
                  <span className="visually-hidden">Save</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((variant) => (
                <VariantRow key={variant.id} productId={productId} variant={variant} label={variantLabel(variant, product.options)} productPrice={product.price} editable={editable} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const toForm = (variant) => ({ sku: variant.sku, price: variant.price === null ? '' : String(variant.price), stock: String(variant.stock), isActive: variant.isActive })

/** One variant: its own small form (saved on its own). */
function VariantRow({ productId, variant, label, productPrice, editable }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState(() => toForm(variant))
  const [errors, setErrors] = useState({})
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(values) !== JSON.stringify(toForm(variant))
  const base = `variant-${variant.id}`

  const save = useMutation({
    mutationFn: (body) => updateVariant(productId, variant.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.product(productId) })
      setSaved(true)
    },
    onError: (error) => setErrors(error.fieldErrors ?? { form: [actionErrorMessage(error)] }),
  })

  function submit() {
    const found = {}
    const price = values.price.trim() === '' ? null : Number(values.price)
    const stock = Number(values.stock)
    if (!/^[A-Za-z0-9-]{1,64}$/.test(values.sku.trim())) found.sku = ['Use up to 64 letters, digits, and dashes.']
    if (price !== null && (!Number.isFinite(price) || price < 0.01 || price > 1_000_000 || !hasCents(price))) found.price = ['Enter a price from 0.01 with at most 2 decimals, or leave it empty.']
    if (values.stock.trim() === '' || !Number.isInteger(stock) || stock < 0 || stock > 100_000) found.stock = ['Enter a whole number from 0 to 100,000.']
    setErrors(found)
    setSaved(false)
    if (Object.keys(found).length > 0) return
    save.mutate({ sku: values.sku.trim(), price, stock, isActive: values.isActive })
  }

  const set = (key) => (event) => {
    setSaved(false)
    setValues({ ...values, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
  }
  const input = (key, props) => {
    const error = errors[key]?.[0] ?? errors[key === 'stock' ? 'stockQuantity' : key]?.[0]
    return (
      <>
        <input
          id={`${base}-${key}`}
          aria-label={`${props.label} for ${label}`}
          value={values[key]}
          disabled={!editable}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${base}-${key}-error` : undefined}
          onChange={set(key)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          {...props.attrs}
        />
        {error && (
          <span id={`${base}-${key}-error`} className="field__error">
            {error}
          </span>
        )}
      </>
    )
  }

  return (
    <tr className={variant.isActive ? undefined : 'is-muted'}>
      <th scope="row">{label}</th>
      <td>{input('sku', { label: 'SKU', attrs: { maxLength: 64 } })}</td>
      <td>{input('price', { label: 'Price', attrs: { type: 'number', inputMode: 'decimal', min: '0.01', step: '0.01', placeholder: formatMoney(productPrice ?? 0) } })}</td>
      <td>{input('stock', { label: 'Units in stock', attrs: { type: 'number', inputMode: 'numeric', min: '0', step: '1' } })}</td>
      <td>
        <label className="checkbox">
          {/* A variant whose option value was removed can't be sold again (the server refuses too). */}
          <input
            type="checkbox"
            checked={values.isActive}
            disabled={!editable || (variant.isCurrent === false && !values.isActive)}
            aria-describedby={variant.isCurrent === false ? `${base}-stale` : undefined}
            onChange={set('isActive')}
          />
          <span className="visually-hidden">Sell {label}</span>
          <span aria-hidden="true">{values.isActive ? 'Yes' : 'No'}</span>
        </label>
        {variant.isCurrent === false && (
          <span id={`${base}-stale`} className="field__hint">
            Uses a removed option value
          </span>
        )}
      </td>
      <td className="table__actions">
        {editable && (
          <button type="button" className="btn btn--outline btn--sm" disabled={!dirty || save.isPending} onClick={submit} aria-label={`Save ${label}`}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
        <span role="status" className="variant-status">
          {saved && !dirty ? 'Saved' : ''}
          {errors.form && <span className="field__error">{errors.form[0]}</span>}
        </span>
      </td>
    </tr>
  )
}

export default ProductVariants
