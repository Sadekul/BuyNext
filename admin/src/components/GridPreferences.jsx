import { useRef, useState } from 'react'
import { LuBookmark, LuColumns3, LuTrash2 } from 'react-icons/lu'
import Field from './Field'
import FormDialog from './FormDialog'
import { MAX_SAVED_FILTERS, PAGE_SIZES, filterKey } from '../utils/useGridPreferences'

/**
 * A grid's own settings bar (with useGridPreferences): which columns show,
 * rows per page, and named filter sets ("Saved views" in Magento). `current`
 * is the grid's active filters (no paging); `onApply(query)` puts a saved
 * set in the URL; `onPageSize()` (optional) goes back to the first page.
 * What happened is announced in one status line.
 */
function GridPreferences({ prefs, current, onApply, onPageSize, noun }) {
  const [message, setMessage] = useState(null)
  const [naming, setNaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  if (!prefs.enabled) return null

  const say = (text, tone = 'success') => setMessage({ text, tone })
  const saving = (promise, done) =>
    promise.then(
      () => say(done),
      (error) => say(`Couldn't save your grid settings: ${error.message}`, 'error'),
    )

  const toggleColumn = (id, shown) => {
    const columns = shown ? [...prefs.visible, id] : prefs.visible.filter((item) => item !== id)
    // Keep the grid's own order.
    const ordered = prefs.columns.map((column) => column.id).filter((item) => columns.includes(item))
    const label = prefs.columns.find((column) => column.id === id)?.label
    saving(prefs.update({ columns: ordered }), `${label} column ${shown ? 'shown' : 'hidden'}.`)
  }

  const currentKey = filterKey(current)
  const active = prefs.filters.find((filter) => filterKey(filter.query) === currentKey)
  const hasFilters = currentKey !== '[]'

  return (
    <div className="grid-prefs">
      {/* The checkboxes exist only while it's open; Escape closes it and returns to "Columns". */}
      <details
        className="grid-prefs__menu"
        ref={menuRef}
        open={menuOpen}
        onToggle={(event) => setMenuOpen(event.currentTarget.open)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !menuOpen) return
          event.preventDefault()
          setMenuOpen(false)
          menuRef.current?.querySelector('summary')?.focus()
        }}
      >
        <summary className="btn btn--outline btn--sm">
          <LuColumns3 aria-hidden="true" /> Columns
        </summary>
        {menuOpen && (
        <fieldset className="grid-prefs__panel">
          <legend>Columns to show</legend>
          {prefs.columns.map((column) => (
            <label key={column.id} className="checkbox">
              <input
                type="checkbox"
                checked={prefs.visible.includes(column.id)}
                disabled={column.required}
                onChange={(event) => toggleColumn(column.id, event.target.checked)}
              />
              {column.label}
              {column.required && <span className="muted"> (always shown)</span>}
            </label>
          ))}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              saving(prefs.update({ columns: null }), 'All columns shown.')
              menuRef.current?.querySelector('summary')?.focus()
            }}
          >
            Show all columns
          </button>
        </fieldset>
        )}
      </details>

      <label className="toolbar__select grid-prefs__size">
        <span>Rows per page</span>
        <select
          value={prefs.pageSize}
          onChange={(event) => {
            onPageSize?.()
            saving(prefs.update({ pageSize: Number(event.target.value) }), `Showing ${event.target.value} ${noun} per page.`)
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <label className="toolbar__select">
        <span>Saved filters</span>
        <select
          value={active?.name ?? ''}
          onChange={(event) => {
            const filter = prefs.filters.find((item) => item.name === event.target.value)
            onApply(filter ? filter.query : {})
            say(filter ? `Filters "${filter.name}" applied.` : 'Filters cleared.')
          }}
        >
          <option value="">{prefs.filters.length === 0 ? 'None saved yet' : active ? 'Clear filters' : 'Choose…'}</option>
          {prefs.filters.map((filter) => (
            <option key={filter.name} value={filter.name}>
              {filter.name}
            </option>
          ))}
        </select>
      </label>
      {active ? (
        <button
          type="button"
          className="btn btn--outline btn--sm"
          aria-label={`Delete saved filters ${active.name}`}
          onClick={() => saving(prefs.update({ filters: prefs.filters.filter((filter) => filter !== active) }), `Saved filters "${active.name}" deleted.`)}
        >
          <LuTrash2 aria-hidden="true" /> Delete saved
        </button>
      ) : (
        hasFilters && (
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setNaming(true)} disabled={prefs.filters.length >= MAX_SAVED_FILTERS}>
            <LuBookmark aria-hidden="true" /> Save filters
          </button>
        )
      )}

      <p role={message?.tone === 'error' ? 'alert' : 'status'} className={message?.tone === 'error' ? 'grid-prefs__message form-error' : 'grid-prefs__message muted'}>
        {message?.text}
      </p>

      {naming && (
        <SaveFilterDialog
          taken={prefs.filters.map((filter) => filter.name.toLowerCase())}
          onCancel={() => setNaming(false)}
          onSave={(name) =>
            prefs.update({ filters: [...prefs.filters, { name, query: current }] }).then(() => {
              setNaming(false)
              say(`Filters saved as "${name}".`)
            })
          }
        />
      )}
    </div>
  )
}

function SaveFilterDialog({ taken, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  function submit() {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 40) return setError('Enter a name of up to 40 characters.')
    if (taken.includes(trimmed.toLowerCase())) return setError('You already have saved filters with that name.')
    setError(null)
    setBusy(true)
    onSave(trimmed).catch((failure) => {
      setBusy(false)
      setError(`Couldn't save: ${failure.message}`)
    })
  }

  return (
    <FormDialog isOpen title="Save these filters" description="Only you see your saved filters." submitLabel="Save filters" busy={busy} onSubmit={submit} onCancel={onCancel}>
      <Field label="Name" error={error}>
        {(a11y) => <input {...a11y} value={name} maxLength={40} autoFocus onChange={(event) => setName(event.target.value)} />}
      </Field>
    </FormDialog>
  )
}

export default GridPreferences
