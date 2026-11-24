import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuPhone } from 'react-icons/lu'
import { getToConfirm, phase14Keys } from '../api/phase14'
import ConfirmationDialog from '../components/ConfirmationDialog'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { confirmationStatus, formatBdMobile, historyText, telHref } from '../utils/bangladesh'
import { formatCount, formatDateTime, formatMoney } from '../utils/format'

const LIMIT = 20

/**
 * Sales → To confirm (docs/backend/PHASE14_CONTRACT.md §4), orders.edit:
 * cash on delivery orders waiting for a phone call, oldest first. Each
 * shows the mobile number as a call link, what the customer ordered before
 * (and returned), and the last note; staff record Confirmed, Couldn't reach,
 * or Cancel (with a reason), each with an optional note (the full log is on the order page).
 * Only when Settings → Cash on delivery asks for confirmation.
 */
function ToConfirmPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const skip = Number(params.get('skip')) || 0
  const query = { limit: LIMIT, skip }
  const queue = useQuery({ queryKey: phase14Keys.toConfirm(query), queryFn: ({ signal }) => getToConfirm(query, { signal }), placeholderData: keepPreviousData })
  const [dialog, setDialog] = useState(null) // { order, outcome }
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  function open(order, outcome, event) {
    openerRef.current = event.currentTarget
    setNotice(null)
    setDialog({ order, outcome })
  }
  function done(text) {
    setDialog(null)
    for (const key of [['to-confirm'], ['orders'], ['order'], ['products'], ['product']]) queryClient.invalidateQueries({ queryKey: key })
    setNotice(text)
  }
  const update = (changes) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const orders = queue.data?.orders ?? []
  return (
    <>
      <title>To confirm | BuyNest Admin</title>
      <PageHeader
        title="To confirm"
        description={
          queue.data
            ? `${formatCount(queue.data.total)} cash on delivery ${queue.data.total === 1 ? 'order waits' : 'orders wait'} for a call, oldest first.`
            : 'Cash on delivery orders waiting for a call, oldest first.'
        }
      />
      <div role="status">
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className="notice notice--success">
            {notice}
          </p>
        )}
      </div>
      {queue.isPending && <Loading label="Loading the orders to confirm…" />}
      {queue.error && <ErrorState error={queue.error} onRetry={queue.refetch} />}
      {queue.data && orders.length === 0 && <Empty>Nothing to confirm: every cash on delivery order has been called.</Empty>}
      {orders.length > 0 && (
        <ol className="confirm-queue" aria-busy={queue.isFetching}>
          {orders.map((order) => {
            const tel = telHref(order.phone)
            const history = historyText(order.history)
            return (
              <li key={order.number} className="panel confirm-card" aria-labelledby={`confirm-${order.number}`}>
                <div className="confirm-card__head">
                  <h2 id={`confirm-${order.number}`} className="confirm-card__title">
                    <Link to={`/orders/${order.number}`}>{order.number}</Link>
                    <span className="muted"> · {order.customerName}</span>
                  </h2>
                  <StatusBadge {...confirmationStatus(order.confirmationStatus)} />
                </div>
                <div className="confirm-card__body">
                  <dl className="details">
                    <dt>Mobile</dt>
                    <dd>
                      {tel ? (
                        <a href={tel} className="btn btn--outline btn--sm confirm-card__call">
                          <LuPhone aria-hidden="true" /> Call {formatBdMobile(order.phone)}
                          <span className="visually-hidden">, {order.customerName}</span>
                        </a>
                      ) : (
                        <span className="muted">No number</span>
                      )}
                    </dd>
                    <dt>Placed</dt>
                    <dd>
                      <time dateTime={order.placedAt}>{formatDateTime(order.placedAt)}</time>
                    </dd>
                    <dt>To collect</dt>
                    <dd>
                      <strong>{formatMoney(order.codDue ?? order.total ?? 0, order.currency)}</strong>
                      {Number.isInteger(order.itemCount) && <span className="muted"> · {formatCount(order.itemCount)} {order.itemCount === 1 ? 'item' : 'items'}</span>}
                    </dd>
                    {order.deliveryZone && (
                      <>
                        <dt>Zone</dt>
                        <dd>{order.deliveryZone.name ?? order.deliveryZone.code}</dd>
                      </>
                    )}
                    {history && (
                      <>
                        <dt>Customer</dt>
                        <dd>{history}</dd>
                      </>
                    )}
                    <dt>Calls</dt>
                    <dd>
                      {order.attempts > 0 ? `${formatCount(order.attempts)} so far` : 'Not called yet'}
                      {order.lastAttemptAt && <span className="muted"> · last {formatDateTime(order.lastAttemptAt)}</span>}
                    </dd>
                  </dl>
                  <div>
                    {order.address && <p className="confirm-card__address">{order.address}</p>}
                    {order.lastNote && <p className="muted">Last note: “{order.lastNote}”</p>}
                  </div>
                </div>
                <div className="confirm-card__actions">
                  <button type="button" className="btn btn--primary btn--sm" aria-label={`Confirmed: ${order.number}`} onClick={(event) => open(order, 'confirmed', event)}>
                    Confirmed
                  </button>
                  <button type="button" className="btn btn--outline btn--sm" aria-label={`Couldn't reach: ${order.number}`} onClick={(event) => open(order, 'unreachable', event)}>
                    Couldn't reach
                  </button>
                  <button type="button" className="btn btn--danger btn--sm" aria-label={`Cancel order ${order.number}`} onClick={(event) => open(order, 'cancelled', event)}>
                    Cancel order
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {queue.data && <Pagination total={queue.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />}
      {dialog && (
        <ConfirmationDialog
          order={dialog.order}
          outcome={dialog.outcome}
          onDone={done}
          onCancel={() => {
            setDialog(null)
            openerRef.current?.focus()
          }}
        />
      )}
    </>
  )
}

export default ToConfirmPage
