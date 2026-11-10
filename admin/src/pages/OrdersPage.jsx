import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuSearch } from 'react-icons/lu'
import { adminKeys, getOrders } from '../api/admin'
import { LIVE_DATA } from '../api/mode'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatMoney } from '../utils/format'
import { ORDER_STATUSES, PAYMENT_STATUSES, orderStatus, paymentStatus } from '../utils/orders'

const LIMIT = 20

/**
 * Demo: orders = DummyJSON's carts (the demo API's only order-like data).
 * Orders placed in the storefront's simulated checkout stay in each
 * customer's browser, so they aren't listed here.
 */
function DemoOrdersPage() {
  const [params, setParams] = useSearchParams()
  const skip = Number(params.get('skip')) || 0
  const orders = useQuery({
    queryKey: adminKeys.orders({ skip }),
    queryFn: ({ signal }) => getOrders({ skip, limit: LIMIT }, { signal }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <title>Orders | BuyNest Admin</title>
      <PageHeader title="Orders" description={orders.data ? `${formatCount(orders.data.total)} orders` : undefined} />
      <p className="muted page-note">
        Demo orders from DummyJSON. Orders placed in the storefront's demo checkout are saved only in the customer's
        browser, so they appear here once the Laravel backend stores them.
      </p>
      {orders.isPending && <Loading label="Loading orders…" />}
      {orders.error && <ErrorState error={orders.error} onRetry={orders.refetch} />}
      {orders.data && orders.data.orders.length === 0 && <Empty>No orders yet.</Empty>}
      {orders.data && orders.data.orders.length > 0 && (
        <div className="table-wrap" aria-busy={orders.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col" className="num">
                  Items
                </th>
                <th scope="col" className="num">
                  Subtotal
                </th>
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.data.orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link to={`/orders/${order.id}`}>#{order.id}</Link>
                  </td>
                  <td>{order.customer}</td>
                  <td className="num">{formatCount(order.items)}</td>
                  <td className="num muted">{formatMoney(order.subtotal)}</td>
                  <td className="num">{formatMoney(order.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={orders.data.total} limit={LIMIT} skip={skip} onChange={(next) => setParams(next ? { skip: String(next) } : {})} />
        </div>
      )}
    </>
  )
}

/**
 * Real orders from BuyNest's API, newest first: search (number, email, name),
 * status and payment filters, pages. Filters live in the URL.
 */
function LiveOrdersPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const payment = params.get('paymentStatus') ?? ''
  const skip = Number(params.get('skip')) || 0
  const [draft, setDraft] = useState(q)
  const query = { q, status, paymentStatus: payment, skip, limit: LIMIT }
  const orders = useQuery({
    queryKey: adminKeys.orders(query),
    queryFn: ({ signal }) => getOrders(query, { signal }),
    placeholderData: keepPreviousData,
  })

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(q || status || payment)
  return (
    <>
      <title>Orders | BuyNest Admin</title>
      <PageHeader title="Orders" description={orders.data ? `${formatCount(orders.data.total)} ${filtered ? 'matching orders' : 'orders'}` : undefined} />

      <div className="toolbar">
        <form
          role="search"
          className="toolbar__search"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: draft.trim(), skip: 0 })
          }}
        >
          <label htmlFor="order-search" className="visually-hidden">
            Search orders
          </label>
          <input id="order-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Order number, email, or name" />
          <button type="submit" className="btn btn--outline">
            <LuSearch aria-hidden="true" /> Search
          </button>
        </form>
        <label className="toolbar__select">
          <span>Status</span>
          <select value={status} onChange={(event) => update({ status: event.target.value, skip: 0 })}>
            <option value="">All statuses</option>
            {Object.entries(ORDER_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Payment</span>
          <select value={payment} onChange={(event) => update({ paymentStatus: event.target.value, skip: 0 })}>
            <option value="">Paid and unpaid</option>
            {Object.entries(PAYMENT_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {orders.isPending && <Loading label="Loading orders…" />}
      {orders.error && <ErrorState error={orders.error} onRetry={orders.refetch} />}
      {orders.data && orders.data.orders.length === 0 && <Empty>{filtered ? 'No orders match.' : 'No orders yet.'}</Empty>}
      {orders.data && orders.data.orders.length > 0 && (
        <div className="table-wrap" aria-busy={orders.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Placed</th>
                <th scope="col">Status</th>
                <th scope="col">Payment</th>
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.data.orders.map((order) => (
                <tr key={order.number}>
                  <td>
                    <Link to={`/orders/${order.number}`}>{order.number}</Link>
                  </td>
                  <td>
                    {order.customer}
                    <small className="muted"> · {order.guest ? 'Guest' : 'Account'}</small>
                  </td>
                  <td>{formatDate(order.placedAt)}</td>
                  <td>
                    <StatusBadge {...orderStatus(order.status)} />
                  </td>
                  <td>
                    <StatusBadge {...paymentStatus(order.paymentStatus)} />
                  </td>
                  <td className="num">{formatMoney(order.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={orders.data.total} limit={LIMIT} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </>
  )
}

const OrdersPage = LIVE_DATA ? LiveOrdersPage : DemoOrdersPage

export default OrdersPage
