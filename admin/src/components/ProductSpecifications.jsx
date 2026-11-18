import { useId, useRef, useState } from 'react'
import { LuArrowDown, LuArrowUp, LuPlus, LuTrash2 } from 'react-icons/lu'
import { MAX_SPECIFICATIONS, moved, specRow } from '../utils/productLinks'

/**
 * Phase 11 §2: the product's specifications ("Material: Cotton"), an ordered
 * list of label/value rows. Rows are added, removed, and moved with buttons
 * (no dragging); focus stays on the moved row's button, a new row's label
 * takes focus, and every change is announced politely. Saved with the product.
 */
function ProductSpecifications({ rows, onChange, errors = {}, disabled = false }) {
  const [announcement, setAnnouncement] = useState('')
  const refs = useRef(new Map())
  const addRef = useRef(null)
  const hintId = useId()
  const listErrorId = useId()
  const full = rows.length >= MAX_SPECIFICATIONS
  const name = (row, index) => (row.label.trim() ? `“${row.label.trim()}”` : `row ${index + 1}`)
  const focusLater = (key) => requestAnimationFrame(() => (key ? refs.current.get(key) : addRef.current)?.focus())

  function add() {
    const row = specRow()
    onChange([...rows, row])
    setAnnouncement(`Row ${rows.length + 1} added.`)
    focusLater(`${row.key}-label`)
  }
  function remove(index) {
    const next = rows.filter((_, at) => at !== index)
    setAnnouncement(`${name(rows[index], index)} removed.`)
    onChange(next)
    // Focus the row that took its place, else the one before, else "Add a row".
    const neighbour = next[index] ?? next[index - 1]
    focusLater(neighbour ? `${neighbour.key}-label` : null)
  }
  function move(index, step) {
    const row = rows[index]
    const target = index + step
    onChange(moved(rows, index, step))
    setAnnouncement(`${name(row, index)} moved to position ${target + 1} of ${rows.length}.`)
    const atEnd = step < 0 ? target === 0 : target === rows.length - 1
    focusLater(`${row.key}-${(step < 0) !== atEnd ? 'up' : 'down'}`)
  }
  const set = (index, field) => (event) => onChange(rows.map((row, at) => (at === index ? { ...row, [field]: event.target.value } : row)))

  return (
    <fieldset className="form__fieldset product-extra" aria-describedby={[hintId, errors.list && listErrorId].filter(Boolean).join(' ')}>
      <legend>Specifications</legend>
      <p id={hintId} className="field__hint">
        Shown on the product page as a table and on the compare page. Up to {MAX_SPECIFICATIONS} rows; each label once. Empty rows are left out when you save.
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {rows.length > 0 && (
        <ol className="spec-rows">
          {rows.map((row, index) => {
            const rowErrors = errors.rows?.[index] ?? {}
            const labelId = `${row.key}-label`
            const valueId = `${row.key}-value`
            return (
              <li key={row.key} className="spec-row">
                <div className="spec-row__fields">
                  <div className="field">
                    <label htmlFor={labelId}>Label {index + 1}</label>
                    <input
                      id={labelId}
                      ref={(node) => refs.current.set(labelId, node)}
                      value={row.label}
                      maxLength={60}
                      autoComplete="off"
                      placeholder="Material"
                      disabled={disabled}
                      aria-invalid={rowErrors.label ? true : undefined}
                      aria-describedby={rowErrors.label ? `${labelId}-error` : undefined}
                      onChange={set(index, 'label')}
                    />
                    {rowErrors.label && (
                      <span id={`${labelId}-error`} className="field__error">
                        {rowErrors.label}
                      </span>
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor={valueId}>Value {index + 1}</label>
                    <input
                      id={valueId}
                      value={row.value}
                      maxLength={255}
                      autoComplete="off"
                      placeholder="100% cotton"
                      disabled={disabled}
                      aria-invalid={rowErrors.value ? true : undefined}
                      aria-describedby={rowErrors.value ? `${valueId}-error` : undefined}
                      onChange={set(index, 'value')}
                    />
                    {rowErrors.value && (
                      <span id={`${valueId}-error`} className="field__error">
                        {rowErrors.value}
                      </span>
                    )}
                  </div>
                </div>
                {!disabled && (
                  <div className="picker-list__tools">
                    <button
                      type="button"
                      ref={(node) => refs.current.set(`${row.key}-up`, node)}
                      className="icon-button"
                      aria-label={`Move ${name(row, index)} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <LuArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      ref={(node) => refs.current.set(`${row.key}-down`, node)}
                      className="icon-button"
                      aria-label={`Move ${name(row, index)} down`}
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <LuArrowDown aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-button icon-button--danger" aria-label={`Remove ${name(row, index)}`} onClick={() => remove(index)}>
                      <LuTrash2 aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {rows.length === 0 && <p className="muted">No specifications yet.</p>}
      {!disabled && (
        <p>
          <button type="button" ref={addRef} className="btn btn--outline btn--sm" disabled={full} onClick={add}>
            <LuPlus aria-hidden="true" /> Add a row
          </button>
          {full && <span className="field__hint"> The list is full ({MAX_SPECIFICATIONS} rows).</span>}
        </p>
      )}
      {errors.list && (
        <p id={listErrorId} className="field__error" role="alert">
          {errors.list}
        </p>
      )}
    </fieldset>
  )
}

export default ProductSpecifications
