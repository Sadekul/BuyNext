import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuRotateCcw, LuSearch, LuSettings } from 'react-icons/lu'
import { adminKeys } from '../api/admin'
import { getSmsMessages, phase20Keys, retrySms } from '../api/phase20'
import { useAdminAuth } from '../auth/useAdminAuth'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatDateTime } from '../utils/format'
import { actionErrorMessage } from '../utils/permissions'
import { SMS_EVENTS, SMS_STATUSES, retryErrorText, retryResult, smsEventLabel, smsStatus } from '../utils/sms'

/*
 * Phase 20 §2, Sales → SMS log: every text the store sent (or tried to),
 * newest first, with filters by status and text, and a search by phone or
 * order number. A failed text can be sent again (orders.edit; at most 5
 * attempts, the API's rule). orders.view to open.
 */

const LIMIT = 20

export default function SmsLogPage() {
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const event = params.get('event') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const query = { q, status, event, skip, limit: LIMIT }
  const messages = useQuery({
    queryKey: phase20Keys.messages(query),
    queryFn: ({ signal }) => getSmsMessages(query, { signal }),
    placeholderData: keepPreviousData,
  })
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const retry = useMutation({
    mutationFn: (id) => retrySms(id),
    onSuccess: (data) => {
      setNotice(retryResult(data.message))
      queryClient.invalidateQueries({ queryKey: ['sms'] })
      if (data.message.order?.number) queryClient.invalidateQueries({ queryKey: adminKeys.order(data.message.order.number) })
    },
    onError: (error) => setNotice({ tone: 'error', text: retryErrorText(error, actionErrorMessage) }),
  })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const canRetry = can('orders.edit')
  const filtered = Boolean(q || status || event)
  return (
    <>
      <title>SMS log | BuyNest Admin</title>
      <PageHeader
        title="SMS log"
        description="Every order text the store sent or tried to send, newest first. Failed texts are tried again every 10 minutes for a day; Retry sends one now."
        actions={
          can('settings.view') ? (
            <Link to="/settings/sms" className="btn btn--outline">
              <LuSettings aria-hidden="true" /> SMS settings
            </Link>
          ) : null
        }
      />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>
      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(change) => {
            change.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="sms-search" className="visually-hidden">
            Search texts
          </label>
          <input id="sms-search" type="search" value={draft} onChange={(change) => setDraft(change.target.value)} placeholder="Phone or order number" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(change) => update({ status: change.target.value, skip: 0 })}>
            <option value="">All statuses</option>
            {Object.entries(SMS_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Text</span>
          <select value={event} onChange={(change) => update({ event: change.target.value, skip: 0 })}>
            <option value="">All texts</option>
            {Object.entries(SMS_EVENTS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="test">Test messages</option>
          </select>
        </label>
      </div>
      {messages.isPending && <Loading label="Loading the texts…" />}
      {messages.error && <ErrorState error={messages.error} onRetry={messages.refetch} />}
      {messages.data && messages.data.messages.length === 0 && <Empty>{filtered ? 'No texts match.' : 'No texts sent yet. Turn SMS on under Settings → SMS.'}</Empty>}
      {messages.data && messages.data.messages.length > 0 && (
        <div className="table-wrap" aria-busy={messages.isFetching}>
          <table className="table sms-log">
            <caption className="visually-hidden">Texts, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Phone</th>
                <th scope="col">Order</th>
                <th scope="col">Text</th>
                <th scope="col">Status</th>
                <th scope="col">Parts</th>
                <th scope="col">Error</th>
                {canRetry && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {messages.data.messages.map((message) => (
                <tr key={message.id}>
                  <td>
                    <time dateTime={message.sentAt ?? message.createdAt}>{formatDateTime(message.sentAt ?? message.createdAt)}</time>
                  </td>
                  <td className="sms-log__phone">{message.to}</td>
                  <td>{message.order ? <Link to={`/orders/${encodeURIComponent(message.order.number)}`}>{message.order.number}</Link> : <span className="muted">—</span>}</td>
                  <td>
                    <strong>{smsEventLabel(message.event)}</strong>
                    <span className="sms-log__body" lang={message.locale}>
                      {message.body}
                    </span>
                  </td>
                  <td>
                    <StatusBadge {...smsStatus(message.status)} />
                    {message.attempts > 1 && <span className="muted sms-log__attempts">{message.attempts} attempts</span>}
                  </td>
                  <td>
                    {message.segments}
                    {message.encoding === 'unicode' && <span className="muted"> · Unicode</span>}
                  </td>
                  <td>{message.error ? <span className="sms-log__error">{message.error}</span> : <span className="muted">—</span>}</td>
                  {canRetry && (
                    <td>
                      {message.status === 'failed' && (
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          aria-label={`Retry the ${smsEventLabel(message.event)} text to ${message.to}`}
                          disabled={retry.isPending}
                          onClick={() => {
                            setNotice(null)
                            retry.mutate(message.id)
                          }}
                        >
                          <LuRotateCcw aria-hidden="true" /> Retry
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={messages.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </>
  )
}
