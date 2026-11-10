import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuSearch } from 'react-icons/lu'
import { adminKeys, getAdmins, getAudit } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDateTime } from '../utils/format'

const LIMIT = 30
const FILTERS = ['adminId', 'action', 'from', 'to']

/** A logged value as plain text: objects as JSON, empty as a dash. Never HTML. */
function shown(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * Audit log (System → Audit log): who changed what, when, from where.
 * Filters live in the URL. Needs audit.view; the admin filter also needs
 * admins.manage (it lists the admin users).
 */
function AuditLogPage() {
  const { can } = useAdminAuth()
  const [params, setParams] = useSearchParams()
  const filters = Object.fromEntries(FILTERS.map((key) => [key, params.get(key) ?? '']))
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(filters)

  const entries = useQuery({
    queryKey: adminKeys.audit({ ...filters, skip }),
    queryFn: ({ signal }) => getAudit({ ...filters, limit: LIMIT, skip }, { signal }),
    placeholderData: keepPreviousData,
  })
  const admins = useQuery({ queryKey: adminKeys.admins({ all: true }), queryFn: ({ signal }) => getAdmins({ limit: 100 }, { signal }), enabled: can('admins.manage') })

  function apply(event) {
    event.preventDefault()
    const next = { ...draft, action: draft.action.trim().toLowerCase() }
    setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)))
  }
  function clear() {
    setDraft(Object.fromEntries(FILTERS.map((key) => [key, ''])))
    setParams({})
  }
  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }))
  const filtered = FILTERS.some((key) => filters[key])

  return (
    <>
      <title>Audit log | BuyNest Admin</title>
      <PageHeader title="Audit log" description={entries.data ? `${formatCount(entries.data.total)} ${filtered ? 'matching entries' : 'entries'}, newest first` : 'Every admin change and sign-in'} />

      <form className="toolbar" role="search" aria-label="Filter the audit log" onSubmit={apply}>
        {can('admins.manage') && (
          <label className="toolbar__select">
            <span>Admin</span>
            <select value={draft.adminId} onChange={set('adminId')}>
              <option value="">Everyone</option>
              {(admins.data?.admins ?? []).map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="toolbar__select">
          <span>Action</span>
          <input value={draft.action} onChange={set('action')} placeholder="e.g. product.updated" maxLength={81} />
        </label>
        <label className="toolbar__select">
          <span>From</span>
          <input type="date" value={draft.from} max={draft.to || undefined} onChange={set('from')} />
        </label>
        <label className="toolbar__select">
          <span>To</span>
          <input type="date" value={draft.to} min={draft.from || undefined} onChange={set('to')} />
        </label>
        <button type="submit" className="btn btn--outline">
          <LuSearch aria-hidden="true" /> Filter
        </button>
        {filtered && (
          <button type="button" className="link-button" onClick={clear}>
            Clear filters
          </button>
        )}
      </form>

      {entries.isPending && <Loading label="Loading the audit log…" />}
      {entries.error && <ErrorState error={entries.error} onRetry={entries.refetch} />}
      {entries.data && entries.data.entries.length === 0 && <Empty>{filtered ? 'Nothing matches these filters.' : 'Nothing has been logged yet.'}</Empty>}
      {entries.data && entries.data.entries.length > 0 && (
        <div className="table-wrap" aria-busy={entries.isFetching}>
          <table className="table audit-table">
            <caption className="visually-hidden">Audit log entries</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Admin</th>
                <th scope="col">Action</th>
                <th scope="col">What happened</th>
                <th scope="col">IP address</th>
              </tr>
            </thead>
            <tbody>
              {entries.data.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>{entry.adminName ?? <span className="muted">No admin (sign-in attempt)</span>}</td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td>
                    {entry.summary}
                    {entry.changes.length > 0 && (
                      <details className="audit-changes">
                        <summary>
                          {entry.changes.length === 1 ? '1 field changed' : `${entry.changes.length} fields changed`}
                        </summary>
                        <table className="table">
                          <caption className="visually-hidden">Changes: before and after</caption>
                          <thead>
                            <tr>
                              <th scope="col">Field</th>
                              <th scope="col">Before</th>
                              <th scope="col">After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.changes.map((change) => (
                              <tr key={change.field}>
                                <th scope="row">{change.field}</th>
                                <td>{shown(change.before)}</td>
                                <td>{shown(change.after)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    )}
                  </td>
                  <td>{entry.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            total={entries.data.total}
            limit={LIMIT}
            skip={skip}
            onChange={(next) => setParams(Object.fromEntries(Object.entries({ ...filters, skip: next || '' }).filter(([, value]) => value)))}
          />
        </div>
      )}
    </>
  )
}

export default AuditLogPage
