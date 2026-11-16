import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft, LuSearch } from 'react-icons/lu'
import { adminKeys, getReturn, getReturns, updateReturn } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from '../components/Field'
import FormDialog from '../components/FormDialog'
import { RefundDialog } from '../components/OrderActionDialogs'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatDateTime } from '../utils/format'
import { RETURN_CONDITIONS, RETURN_MOVES, RETURN_RESOLUTIONS, RETURN_STATUSES, returnStatus } from '../utils/orders'
import { actionErrorMessage } from '../utils/permissions'

/*
 * Sales → Returns (RMA, docs/backend/PHASE6_CONTRACT.md §6). Customers
 * request returns from their orders; staff (or staff for them, from an
 * order) move them along: approve or reject, mark received (with each item's
 * condition and whether it goes back into stock), refund with a credit memo,
 * or close. Every change emails the customer if asked and is noted on the
 * order. Reading needs returns.view, changing returns.manage, refunding
 * credit_memos.create.
 */

const LIMIT = 20

export function ReturnsPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const query = { q, status, skip, limit: LIMIT }
  const list = useQuery({ queryKey: adminKeys.returns(query), queryFn: ({ signal }) => getReturns(query, { signal }), placeholderData: keepPreviousData })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(q || status)
  return (
    <>
      <title>Returns | BuyNest Admin</title>
      <PageHeader title="Returns" description={list.data ? `${formatCount(list.data.total)} ${filtered ? 'matching returns' : 'returns'}` : 'Items customers send back'} />
      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="return-search" className="visually-hidden">
            Search returns
          </label>
          <input id="return-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Return or order number, email, or name" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">All statuses</option>
            {Object.entries(RETURN_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isPending && <Loading label="Loading returns…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && list.data.returns.length === 0 && <Empty>{filtered ? 'No returns match.' : 'No returns yet.'}</Empty>}
      {list.data && list.data.returns.length > 0 && (
        <div className="table-wrap" aria-busy={list.isFetching}>
          <table className="table">
            <caption className="visually-hidden">Returns</caption>
            <thead>
              <tr>
                <th scope="col">Return</th>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Requested</th>
                <th scope="col">Reason</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.returns.map((item) => (
                <tr key={item.number}>
                  <td>
                    <Link to={`/returns/${item.number}`}>{item.number}</Link>
                  </td>
                  <td>{item.orderNumber && <Link to={`/orders/${item.orderNumber}`}>{item.orderNumber}</Link>}</td>
                  <td>{item.customer?.name || item.email || '—'}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.reason}</td>
                  <td>
                    <StatusBadge {...returnStatus(item.status)} />
                  </td>
                  <td className="num">{formatCount(item.itemCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={list.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </>
  )
}

const MOVE_LABELS = { approved: 'Approve', rejected: 'Reject', received: 'Mark as received', closed: 'Close' }
const MOVE_DONE = { approved: 'approved', rejected: 'rejected', received: 'marked as received', closed: 'closed' }

export function ReturnDetailPage() {
  const { number } = useParams()
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const rma = useQuery({ queryKey: adminKeys.return(number), queryFn: ({ signal }) => getReturn(number, { signal }) })
  const [dialog, setDialog] = useState(null) // a status, or 'refund'
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  if (rma.isPending) return <Loading label="Loading the return…" />
  if (rma.error) return <ErrorState error={rma.error} onRetry={rma.refetch} />

  const data = rma.data
  // The server says which moves are allowed from here; a received return is refunded with a credit memo (which sets it to refunded).
  const moves = can('returns.manage') ? (data.allowedTransitions ?? RETURN_MOVES[data.status] ?? []).filter((move) => MOVE_LABELS[move]) : []
  const refundable = can('credit_memos.create') && (data.allowedTransitions ? data.canRefund : data.status === 'received') && data.orderNumber
  function open(name, event) {
    openerRef.current = event.currentTarget
    setNotice(null)
    setDialog(name)
  }
  function cancel() {
    setDialog(null)
    openerRef.current?.focus()
  }
  function done(text) {
    setDialog(null)
    for (const key of [adminKeys.return(number), ['returns'], ['order'], ['orders'], ['credit-memos'], ['products'], ['product']]) queryClient.invalidateQueries({ queryKey: key })
    if (data.orderNumber) queryClient.invalidateQueries({ queryKey: adminKeys.refundable(data.orderNumber) })
    setNotice(text)
  }

  const prefill = {
    returnNumber: data.number,
    quantities: Object.fromEntries(data.items.filter((item) => item.orderItemId).map((item) => [item.orderItemId, item.quantity])),
    restock: false,
    alreadyRestocked: data.restocked,
  }
  return (
    <>
      <title>{`Return ${data.number} | BuyNest Admin`}</title>
      <Link to="/returns" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Returns
      </Link>
      <PageHeader
        title={`Return ${data.number}`}
        description={`Requested ${formatDate(data.createdAt)}${data.orderNumber ? ` · order ${data.orderNumber}` : ''}`}
        actions={<StatusBadge {...returnStatus(data.status)} />}
      />
      <div role="status">
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="notice notice--success">
            {notice}
          </p>
        )}
      </div>

      <div className="panels">
        <section className="panel panel--wide" aria-labelledby="return-items">
          <h2 id="return-items" className="panel__title">
            Items
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col">Condition</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name}
                    {item.variantLabel && <small className="muted"> · {item.variantLabel}</small>}
                    {item.sku && <small className="muted"> · {item.sku}</small>}
                  </td>
                  <td className="num">{formatCount(item.quantity)}</td>
                  <td>{item.condition ? RETURN_CONDITIONS[item.condition] : <span className="muted">Not received yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel" aria-labelledby="return-manage">
          <h2 id="return-manage" className="panel__title">
            Manage return
          </h2>
          <div className="order-actions">
            {moves.length === 0 && !refundable ? (
              <p className="muted">{RETURN_MOVES[data.status] ? 'Your role can view this return but not change it.' : `Nothing left to do: this return is ${returnStatus(data.status).label.toLowerCase()}.`}</p>
            ) : (
              <div className="order-actions__buttons">
                {moves.map((move) => (
                  <button key={move} type="button" className={`btn ${move === 'rejected' ? 'btn--danger' : move === 'closed' ? 'btn--outline' : 'btn--primary'}`} onClick={(event) => open(move, event)}>
                    {MOVE_LABELS[move]}
                  </button>
                ))}
                {refundable && (
                  <button type="button" className="btn btn--outline" onClick={(event) => open('refund', event)}>
                    Refund this return
                  </button>
                )}
              </div>
            )}
            {data.creditMemoNumber && (
              <p>
                Refunded with <Link to={`/credit-memos/${data.creditMemoNumber}`}>{data.creditMemoNumber}</Link>.
              </p>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="return-details">
          <h2 id="return-details" className="panel__title">
            Details
          </h2>
          <dl className="details">
            <dt>Order</dt>
            <dd>{data.orderNumber ? <Link to={`/orders/${data.orderNumber}`}>{data.orderNumber}</Link> : '—'}</dd>
            <dt>Customer</dt>
            <dd>
              {data.customer ? <Link to={`/customers/${data.customer.id}`}>{data.customer.name || data.customer.email}</Link> : 'Guest'}
              {data.email && <span className="muted"> · {data.email}</span>}
            </dd>
            <dt>Reason</dt>
            <dd>{data.reason}</dd>
            {data.comment && (
              <>
                <dt>Customer's comment</dt>
                <dd className="note-body">{data.comment}</dd>
              </>
            )}
            {data.resolution && (
              <>
                <dt>Resolution</dt>
                <dd>{RETURN_RESOLUTIONS[data.resolution] ?? data.resolution}</dd>
              </>
            )}
            {data.adminNote && (
              <>
                <dt>Staff note</dt>
                <dd className="note-body">{data.adminNote}</dd>
              </>
            )}
            {data.status === 'received' || data.status === 'refunded' || data.status === 'closed' ? (
              <>
                <dt>Back in stock</dt>
                <dd>{data.restocked ? 'Yes' : 'No'}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {data.history?.length > 0 && (
          <section className="panel" aria-labelledby="return-history">
            <h2 id="return-history" className="panel__title">
              History
            </h2>
            <ol className="history">
              {data.history.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`}>
                  <div className="history__head">
                    <StatusBadge {...returnStatus(entry.status)} />
                  </div>
                  <p className="muted">
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    {entry.adminName && ` · by ${entry.adminName}`}
                  </p>
                  {entry.note && <p>{entry.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {dialog && dialog !== 'refund' && <ReturnStatusDialog rma={data} status={dialog} onDone={(text) => done(text)} onCancel={cancel} />}
      {dialog === 'refund' && <RefundDialog order={{ number: data.orderNumber }} prefill={prefill} onDone={done} onCancel={cancel} />}
    </>
  )
}

/** Approve, reject, receive (conditions and restock), or close a return. */
function ReturnStatusDialog({ rma, status, onDone, onCancel }) {
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [conditions, setConditions] = useState(() => Object.fromEntries(rma.items.map((item) => [item.id, ''])))
  const [restock, setRestock] = useState(true)
  const [errors, setErrors] = useState({})
  const receiving = status === 'received'
  const change = useMutation({
    mutationFn: (values) => updateReturn(rma.number, values),
    onSuccess: () => onDone(`Return ${rma.number} ${MOVE_DONE[status]}.${receiving && restock ? ' The items are back in stock.' : ''}${notify ? ' The customer was emailed.' : ''}`),
    onError: (error) => {
      const mapped = {}
      for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
        const match = /^items\.(\d+)\./.exec(field)
        const item = match && rma.items[Number(match[1])]
        mapped[item ? `item-${item.id}` : field] = messages
      }
      setErrors(mapped)
    },
  })

  function submit() {
    const found = {}
    if (status === 'rejected' && !note.trim()) found.adminNote = ['Say why the return is rejected; the customer sees it.']
    if (receiving) for (const item of rma.items) if (!conditions[item.id]) found[`item-${item.id}`] = ['Choose the condition.']
    setErrors(found)
    if (Object.keys(found).length > 0) return
    change.mutate({
      status,
      adminNote: note.trim() || undefined,
      notifyCustomer: notify,
      ...(receiving && { items: rma.items.map((item) => ({ returnItemId: item.id, condition: conditions[item.id] })), restock }),
    })
  }

  const shown = ['adminNote', 'status', 'items', 'restock']
  const other = change.error && (Object.entries(change.error.fieldErrors ?? {}).find(([field]) => !shown.some((name) => field === name || field.startsWith(`${name}.`)))?.[1][0] ?? (change.error.fieldErrors ? (change.error.fieldErrors.status?.[0] ?? null) : actionErrorMessage(change.error)))
  const titles = { approved: `Approve return ${rma.number}?`, rejected: `Reject return ${rma.number}?`, received: `Receive return ${rma.number}`, closed: `Close return ${rma.number}?` }
  const descriptions = {
    approved: 'The customer is told to send the items back.',
    rejected: "The customer is told the return isn't accepted, with your note.",
    received: "Record each item's condition as it arrived, and whether it goes back into stock.",
    closed: 'Ends the return without a refund (for example, after sending a replacement).',
  }
  return (
    <FormDialog
      isOpen
      wide={receiving}
      danger={status === 'rejected'}
      title={titles[status]}
      description={descriptions[status]}
      submitLabel={MOVE_LABELS[status]}
      busy={change.isPending}
      error={other}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {receiving && (
        <>
          <table className="table refund-table">
            <caption className="visually-hidden">Condition of each returned item</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col">Condition</th>
              </tr>
            </thead>
            <tbody>
              {rma.items.map((item) => {
                const id = `condition-${item.id}`
                const error = errors[`item-${item.id}`]?.[0]
                const name = item.variantLabel ? `${item.name} (${item.variantLabel})` : item.name
                return (
                  <tr key={item.id}>
                    <th scope="row">
                      {name}
                      {error && (
                        <span id={`${id}-error`} className="field__error">
                          {error}
                        </span>
                      )}
                    </th>
                    <td className="num">{item.quantity}</td>
                    <td>
                      <label htmlFor={id} className="visually-hidden">
                        Condition of {name}
                      </label>
                      <select
                        id={id}
                        value={conditions[item.id]}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${id}-error` : undefined}
                        onChange={(event) => setConditions((current) => ({ ...current, [item.id]: event.target.value }))}
                      >
                        <option value="">Choose…</option>
                        {Object.entries(RETURN_CONDITIONS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <label className="checkbox">
            <input type="checkbox" checked={restock} onChange={(event) => setRestock(event.target.checked)} />
            Put the returned items back into stock
          </label>
        </>
      )}
      <Field
        label={status === 'rejected' ? 'Why is it rejected?' : 'Note (optional)'}
        error={errors.adminNote?.[0]}
        hint="Saved on the return and added to the order history; the customer sees it if emailed."
      >
        {(a11y) => <textarea {...a11y} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
        Email the customer
      </label>
    </FormDialog>
  )
}
