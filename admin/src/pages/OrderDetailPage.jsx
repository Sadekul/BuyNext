import { useId, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuArrowLeft } from 'react-icons/lu'
import { adminKeys, getOrder, updateOrder } from '../api/admin'
import { LIVE_DATA } from '../api/mode'
import ConfirmDialog from '../components/ConfirmDialog'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatDateTime, formatMoney, fullName } from '../utils/format'
import { NEXT_STATUSES, PAYMENT_METHODS, STATUS_ACTIONS, orderStatus, paymentStatus } from '../utils/orders'

/** Demo: a DummyJSON cart shown as an order. */
function DemoOrderDetailPage() {
  const { orderId } = useParams()
  const order = useQuery({ queryKey: adminKeys.order(orderId), queryFn: ({ signal }) => getOrder(orderId, { signal }) })

  if (order.isPending) return <Loading label="Loading the order…" />
  if (order.error) return <ErrorState error={order.error} onRetry={order.refetch} />

  const { customer, lines, subtotal, total, items } = order.data
  return (
    <>
      <title>{`Order #${orderId} | BuyNest Admin`}</title>
      <Link to="/orders" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Orders
      </Link>
      <PageHeader title={`Order #${orderId}`} description={`${formatCount(items)} items`} />

      <div className="panels">
        <section className="panel panel--wide" aria-labelledby="lines-title">
          <h2 id="lines-title" className="panel__title">
            Items
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <Link to={`/products/${line.id}`} className="table__product">
                      <img src={line.thumbnail} alt="" width="36" height="36" loading="lazy" />
                      <span>{line.title}</span>
                    </Link>
                  </td>
                  <td className="num">{formatMoney(line.price)}</td>
                  <td className="num">{formatCount(line.quantity)}</td>
                  <td className="num">{formatMoney(line.discountedTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Subtotal
                </th>
                <td className="num">{formatMoney(subtotal)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>
                  Total after discounts
                </th>
                <td className="num">
                  <strong>{formatMoney(total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section className="panel" aria-labelledby="customer-title">
          <h2 id="customer-title" className="panel__title">
            Customer
          </h2>
          <dl className="details">
            <dt>Name</dt>
            <dd>{fullName(customer) || `Customer #${customer.id}`}</dd>
            {customer.email && (
              <>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${customer.email}`}>{customer.email}</a>
                </dd>
              </>
            )}
            {customer.phone && (
              <>
                <dt>Phone</dt>
                <dd>{customer.phone}</dd>
              </>
            )}
            {customer.city && (
              <>
                <dt>Location</dt>
                <dd>{[customer.city, customer.country].filter(Boolean).join(', ')}</dd>
              </>
            )}
          </dl>
        </section>
      </div>
    </>
  )
}


function Address({ address }) {
  if (!address) return null
  return (
    <address className="address">
      {address.firstName} {address.lastName}
      <br />
      {address.line1}
      {address.line2 && (
        <>
          <br />
          {address.line2}
        </>
      )}
      <br />
      {address.city}, {address.state} {address.postalCode}
      <br />
      {address.country}
    </address>
  )
}

/** What was done, in words, for the notice afterwards. */
function describeChange(changes, updated) {
  if (changes.paymentStatus === 'paid') {
    return changes.previousStatus === 'pending_payment' && updated.status === 'processing' ? 'Marked as paid; the order is now processing.' : 'Marked as paid.'
  }
  return `Status changed to ${orderStatus(changes.status).label}.`
}

/**
 * A real order (BuyNest's API): items, customer, delivery, payment, history,
 * and the actions an admin may take. Only the allowed next statuses are
 * offered (the API refuses others); cancelling asks for confirmation because
 * it puts the stock back and can't be undone.
 */
function LiveOrderDetailPage() {
  const { orderId } = useParams()
  const queryClient = useQueryClient()
  const order = useQuery({ queryKey: adminKeys.order(orderId), queryFn: ({ signal }) => getOrder(orderId, { signal }) })
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [notice, setNotice] = useState(null)
  const noteId = useId()

  const change = useMutation({
    mutationFn: (changes) => updateOrder(orderId, { status: changes.status, paymentStatus: changes.paymentStatus, note: note.trim() || undefined, notifyCustomer: notify }),
    onSuccess: (updated, changes) => {
      setConfirmCancel(false)
      setNote('')
      queryClient.setQueryData(adminKeys.order(orderId), updated)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: adminKeys.overview })
      const emailed = notify && ['shipped', 'delivered', 'cancelled'].includes(changes.status) ? ' The customer was emailed.' : ''
      setNotice({ tone: 'success', text: `${describeChange(changes, updated)}${emailed}` })
    },
    onError: (error) => {
      setConfirmCancel(false)
      setNotice({ tone: 'error', text: error.fieldErrors?.status?.[0] ?? error.fieldErrors?.paymentStatus?.[0] ?? error.message })
    },
  })

  if (order.isPending) return <Loading label="Loading the order…" />
  if (order.error) return <ErrorState error={order.error} onRetry={order.refetch} />

  const data = order.data
  const next = NEXT_STATUSES[data.status] ?? []
  const canMarkPaid = data.paymentStatus !== 'paid' && data.status !== 'cancelled'
  const busy = change.isPending
  const run = (changes) => {
    setNotice(null)
    change.mutate({ ...changes, previousStatus: data.status })
  }

  return (
    <>
      <title>{`Order ${data.number} | BuyNest Admin`}</title>
      <Link to="/orders" className="back-link">
        <LuArrowLeft aria-hidden="true" /> Orders
      </Link>
      <PageHeader
        title={`Order ${data.number}`}
        description={`Placed ${formatDate(data.placedAt)} · ${formatCount(data.items)} items`}
        actions={
          <>
            <StatusBadge {...orderStatus(data.status)} />
            <StatusBadge {...paymentStatus(data.paymentStatus)} />
          </>
        }
      />
      {notice && (
        <p className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'} role={notice.tone === 'success' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}

      <div className="panels">
        <section className="panel panel--wide" aria-labelledby="lines-title">
          <h2 id="lines-title" className="panel__title">
            Items
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, index) => (
                <tr key={line.id ?? `${line.sku}-${index}`}>
                  <td>
                    {/* The order keeps a copy of each product; a deleted product has no page any more. */}
                    {line.id ? (
                      <Link to={`/products/${line.id}`} className="table__product">
                        <img src={line.thumbnail} alt="" width="36" height="36" loading="lazy" />
                        <span>
                          {line.title}
                          <small>{line.sku}</small>
                        </span>
                      </Link>
                    ) : (
                      <span className="table__product">
                        <span>
                          {line.title}
                          <small>{line.sku} · no longer in the catalog</small>
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="num">{formatMoney(line.price)}</td>
                  <td className="num">{formatCount(line.quantity)}</td>
                  <td className="num">{formatMoney(line.discountedTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Subtotal
                </th>
                <td className="num">{formatMoney(data.totals.subtotal)}</td>
              </tr>
              {data.totals.discount > 0 && (
                <tr>
                  <th scope="row" colSpan={3}>
                    Discount{data.couponCode && ` (${data.couponCode})`}
                  </th>
                  <td className="num">−{formatMoney(data.totals.discount)}</td>
                </tr>
              )}
              <tr>
                <th scope="row" colSpan={3}>
                  Shipping{data.shippingMethod && ` (${data.shippingMethod.label})`}
                </th>
                <td className="num">{formatMoney(data.totals.shipping)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>
                  Tax
                </th>
                <td className="num">{formatMoney(data.totals.tax)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>
                  Total
                </th>
                <td className="num">
                  <strong>{formatMoney(data.totals.total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section className="panel" aria-labelledby="manage-title">
          <h2 id="manage-title" className="panel__title">
            Manage order
          </h2>
          <div className="order-actions">
            {next.length === 0 && !canMarkPaid ? (
              <p className="muted">Nothing left to do: this order is {orderStatus(data.status).label.toLowerCase()}.</p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor={noteId}>Note (optional)</label>
                  <textarea id={noteId} rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} aria-describedby={`${noteId}-hint`} />
                  <span id={`${noteId}-hint`} className="field__hint">
                    Added to the order history, which the customer can see (e.g. a tracking number).
                  </span>
                </div>
                <label className="checkbox">
                  <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
                  Email the customer
                </label>
                <div className="order-actions__buttons">
                  {next
                    .filter((status) => status !== 'cancelled')
                    .map((status) => (
                      <button key={status} type="button" className="btn btn--primary" disabled={busy} onClick={() => run({ status })}>
                        {STATUS_ACTIONS[status]}
                      </button>
                    ))}
                  {canMarkPaid && (
                    <button type="button" className="btn btn--outline" disabled={busy} onClick={() => run({ paymentStatus: 'paid' })}>
                      Mark as paid
                    </button>
                  )}
                  {next.includes('cancelled') && (
                    <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setConfirmCancel(true)}>
                      Cancel order
                    </button>
                  )}
                </div>
                {data.status === 'pending_payment' && (
                  <p className="field__hint">No payment provider is connected yet: mark the order as paid once the money has arrived. It then moves to Processing.</p>
                )}
              </>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="customer-title">
          <h2 id="customer-title" className="panel__title">
            Customer
          </h2>
          <dl className="details">
            <dt>Name</dt>
            <dd>
              {fullName(data.customer) || '—'} <span className="muted">· {data.customer.guest ? 'Guest' : 'Account'}</span>
            </dd>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${data.email}`}>{data.email}</a>
            </dd>
            {data.phone && (
              <>
                <dt>Phone</dt>
                <dd>{data.phone}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="panel" aria-labelledby="delivery-title">
          <h2 id="delivery-title" className="panel__title">
            Delivery and payment
          </h2>
          <dl className="details">
            <dt>Ship to</dt>
            <dd>
              <Address address={data.shippingAddress} />
            </dd>
            <dt>Method</dt>
            <dd>
              {data.shippingMethod?.label} <span className="muted">· {data.shippingMethod?.eta}</span>
            </dd>
            <dt>Payment</dt>
            <dd>{PAYMENT_METHODS[data.paymentMethod] ?? data.paymentMethod}</dd>
            <dt>Bill to</dt>
            <dd>
              <Address address={data.billingAddress} />
            </dd>
          </dl>
        </section>

        <section className="panel" aria-labelledby="history-title">
          <h2 id="history-title" className="panel__title">
            History
          </h2>
          <ol className="history" aria-labelledby="history-title">
            {data.history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`}>
                <div className="history__head">
                  <StatusBadge {...orderStatus(entry.status)} />
                  {entry.paymentStatus && <StatusBadge {...paymentStatus(entry.paymentStatus)} />}
                </div>
                <p className="muted">
                  <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  {entry.adminName && ` · by ${entry.adminName}`}
                  {entry.customerNotified && ' · customer emailed'}
                </p>
                {entry.note && <p>{entry.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <ConfirmDialog
        isOpen={confirmCancel}
        title={`Cancel order ${data.number}?`}
        message="The items go back into stock and the order can't be reopened."
        confirmLabel="Cancel order"
        busy={busy}
        onConfirm={() => run({ status: 'cancelled' })}
        onCancel={() => setConfirmCancel(false)}
      />
    </>
  )
}

const OrderDetailPage = LIVE_DATA ? LiveOrderDetailPage : DemoOrderDetailPage

export default OrderDetailPage
