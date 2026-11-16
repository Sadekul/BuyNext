import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { bulkProducts } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import { withPaths } from '../utils/categories'
import { actionErrorMessage } from '../utils/permissions'
import { formatCount } from '../utils/format'
import ConfirmDialog from './ConfirmDialog'

// Each mass action (docs/backend/PHASE5_CONTRACT.md §4) and the permission it needs.
const BULK_ACTIONS = [
  { id: 'enable', label: 'Enable (Active)', permission: 'products.edit' },
  { id: 'disable', label: 'Disable (Draft)', permission: 'products.edit' },
  { id: 'archive', label: 'Archive', permission: 'products.edit' },
  { id: 'set_category', label: 'Move to category…', permission: 'products.edit' },
  { id: 'adjust_price', label: 'Change price…', permission: 'products.edit' },
  { id: 'set_stock', label: 'Set stock…', permission: 'products.edit' },
  { id: 'delete', label: 'Delete', permission: 'products.delete' },
]
const DONE = { enable: 'enabled', disable: 'set to draft', archive: 'archived', set_category: 'moved', adjust_price: 'repriced', set_stock: 'restocked', delete: 'deleted' }

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const plural = (count) => `${formatCount(count)} ${count === 1 ? 'product' : 'products'}`

/**
 * The bar above the product grid once products are ticked: how many are
 * selected, the action, its value, and Apply. Delete and price changes ask
 * first. All or nothing on the server; `onDone(summary)` gets
 * { action, updated, skipped } to show what happened.
 */
function ProductBulkActions({ selected, categories, onDone, onClear }) {
  const { can } = useAdminAuth()
  const id = useId()
  const actions = BULK_ACTIONS.filter((action) => can(action.permission))
  const [action, setAction] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [mode, setMode] = useState('percent')
  const [amount, setAmount] = useState('')
  const [stock, setStock] = useState('')
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(null) // { value, message }

  const run = useMutation({
    mutationFn: ({ value }) => bulkProducts(selected.map((product) => product.id), action, value),
    onSuccess: (result) => {
      setConfirming(null)
      onDone({ action, verb: DONE[action], updated: result.updated, skipped: result.skipped ?? [] })
      setAction('')
      setAmount('')
      setStock('')
    },
    onError: (failure) => {
      setConfirming(null)
      setError(failure)
    },
  })

  /** The action's value, or an error message. */
  function valueFor() {
    if (action === 'set_category') return categoryId ? { value: Number(categoryId) } : { problem: 'Choose a category.' }
    if (action === 'set_stock') {
      const units = Number(stock)
      return stock.trim() !== '' && Number.isInteger(units) && units >= 0 && units <= 100_000 ? { value: units } : { problem: 'Enter a whole number of units from 0 to 100,000.' }
    }
    if (action === 'adjust_price') {
      const change = Number(amount)
      if (amount.trim() === '' || !Number.isFinite(change) || change === 0 || !hasCents(change)) return { problem: 'Enter a change other than 0, with at most 2 decimals (negative lowers prices).' }
      if (mode === 'percent' && (change <= -100 || change > 1000)) return { problem: 'Enter a percentage above -100 and up to 1000.' }
      return { value: { mode, amount: change } }
    }
    return { value: undefined }
  }

  function apply(event) {
    event.preventDefault()
    setError(null)
    if (!action) return setError({ message: 'Choose an action.' })
    const { value, problem } = valueFor()
    if (problem) return setError({ message: problem })
    const count = plural(selected.length)
    if (action === 'delete') return setConfirming({ value, title: `Delete ${count}?`, message: `${count} will be removed from the store. Past orders keep their copy.`, label: `Delete ${count}` })
    if (action === 'adjust_price') {
      const change = mode === 'percent' ? `${value.amount > 0 ? '+' : ''}${value.amount}%` : `${value.amount > 0 ? '+' : '-'}$${Math.abs(value.amount).toFixed(2)}`
      return setConfirming({ value, title: `Change the price of ${count}?`, message: `Each price changes by ${change}, and so do variant prices set separately. If any price would go below $0.01, nothing changes.`, label: 'Change prices' })
    }
    run.mutate({ value })
  }

  const categoryOptions = withPaths(categories).filter((category) => category.id !== undefined)
  return (
    <form className="bulk-bar" aria-labelledby={`${id}-title`} onSubmit={apply} noValidate>
      <p id={`${id}-title`} className="bulk-bar__count">
        <strong>{formatCount(selected.length)}</strong> selected
      </p>
      <label className="toolbar__select">
        <span>Action</span>
        <select
          value={action}
          onChange={(event) => {
            setAction(event.target.value)
            setError(null)
          }}
        >
          <option value="">Choose…</option>
          {actions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {action === 'set_category' && (
        <label className="toolbar__select">
          <span>Category</span>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Choose…</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </select>
        </label>
      )}
      {action === 'adjust_price' && (
        <>
          <label className="toolbar__select">
            <span>Change by</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="percent">Percent</option>
              <option value="fixed">Fixed amount (USD)</option>
            </select>
          </label>
          <label className="toolbar__select">
            <span>{mode === 'percent' ? 'Percent (negative lowers)' : 'Amount (negative lowers)'}</span>
            <input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
        </>
      )}
      {action === 'set_stock' && (
        <label className="toolbar__select">
          <span>Units in stock</span>
          <input type="number" inputMode="numeric" min="0" step="1" value={stock} onChange={(event) => setStock(event.target.value)} />
        </label>
      )}
      <button type="submit" className="btn btn--primary btn--sm" disabled={run.isPending}>
        {run.isPending ? 'Applying…' : 'Apply'}
      </button>
      <button type="button" className="btn btn--outline btn--sm" onClick={onClear}>
        Clear selection
      </button>
      <div role="alert" className="bulk-bar__error">
        {error && <p className="form-error">{actionErrorMessage(error)}</p>}
      </div>
      <ConfirmDialog
        isOpen={confirming !== null}
        title={confirming?.title ?? ''}
        message={confirming?.message ?? ''}
        confirmLabel={confirming?.label ?? 'Apply'}
        busy={run.isPending}
        onConfirm={() => run.mutate({ value: confirming.value })}
        onCancel={() => setConfirming(null)}
      />
    </form>
  )
}

export default ProductBulkActions
