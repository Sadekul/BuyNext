import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuDownload, LuPlus, LuSearch } from 'react-icons/lu'
import { adminKeys, getOrders, ordersCsvUrl } from '../api/admin'
import { LIVE_DATA } from '../api/mode'
import { useAdminAuth } from '../auth/useAdminAuth'
import OrderBulkActions from '../components/OrderBulkActions'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatDate, formatMoney } from '../utils/format'
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES, orderSource, orderStatus, paymentStatus } from '../utils/orders'
// Phase 7: column chooser, rows per page, saved filters.
import GridPreferences from '../components/GridPreferences'
import { useGridPreferences } from '../utils/useGridPreferences'
// Phase 14: delivery zone, cash on delivery, and phone confirmation filters and columns.
import { getDeliveryZones, phase14Keys } from '../api/phase14'
import { CONFIRMATION_STATUSES, SEEDED_ZONES, confirmationStatus } from '../utils/bangladesh'

const LIMIT = 20
const COLUMNS = [
  { id: 'order', label: 'Order', required: true },
  { id: 'customer', label: 'Customer' },
  { id: 'placed', label: 'Placed' },
  { id: 'source', label: 'Source' },
  { id: 'status', label: 'Status' },
  { id: 'payment', label: 'Payment' },
  { id: 'total', label: 'Total' },
  // Phase 14: hidden until chosen in the column chooser.
  { id: 'zone', label: 'Delivery zone', optional: true },
  { id: 'confirmation', label: 'Confirmation', optional: true },
]

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
 * status, payment, and source filters, pages. Filters live in the URL.
 * Phase 6: tick orders for a mass action (invoice, ship, cancel, print),
 * export the filtered grid as CSV, and create an order for a customer.
 */
function LiveOrdersPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const location = useLocation()
  const { can } = useAdminAuth()
  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const payment = params.get('paymentStatus') ?? ''
  const source = params.get('source') ?? ''
  // Phase 14: ?zone=<code>&cod=1&confirmation=pending|confirmed|unreachable|cancelled.
  const zone = params.get('zone') ?? ''
  const cod = params.get('cod') === '1' ? '1' : ''
  const confirmation = Object.hasOwn(CONFIRMATION_STATUSES, params.get('confirmation') ?? '') ? params.get('confirmation') : ''
  const skip = Number(params.get('skip')) || 0
  const grid = useGridPreferences('orders_grid', COLUMNS)
  const limit = grid.pageSize
  const [draft, setDraft] = useState(q)
  const query = { q, status, paymentStatus: payment, source, ...(zone && { zone }), ...(cod && { cod }), ...(confirmation && { confirmation }), skip, limit }
  // The zones for the filter (settings.view); without the permission, the three seeded ones.
  const zones = useQuery({ queryKey: phase14Keys.zones, queryFn: ({ signal }) => getDeliveryZones({ signal }), enabled: can('settings.view'), retry: false, staleTime: 60_000 })
  const zoneOptions = zones.data?.zones?.length ? zones.data.zones : SEEDED_ZONES
  const orders = useQuery({
    queryKey: adminKeys.orders(query),
    queryFn: ({ signal }) => getOrders(query, { signal }),
    placeholderData: keepPreviousData,
  })
  // The ticked orders, for this page and these filters only.
  const pageKey = JSON.stringify(query)
  const [selection, setSelection] = useState({ pageKey, numbers: [] })
  const selected = selection.pageKey === pageKey ? selection.numbers : []
  const select = (numbers) => setSelection({ pageKey, numbers })
  const [summary, setSummary] = useState(null)
  const summaryRef = useRef(null)
  useEffect(() => {
    if (summary) summaryRef.current?.focus()
  }, [summary])

  function bulkDone(result) {
    select([])
    setSummary(result)
    for (const key of [['orders'], ['order'], adminKeys.overview, ['invoices'], ['shipments'], ['products'], ['product']]) queryClient.invalidateQueries({ queryKey: key })
  }

  function update(changes) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === 0) next.delete(key)
      else next.set(key, String(value))
    }
    setParams(next)
  }

  const filtered = Boolean(q || status || payment || source || zone || cod || confirmation)
  const pageOrders = orders.data?.orders ?? []
  const allSelected = pageOrders.length > 0 && pageOrders.every((order) => selected.includes(order.number))
  const toggleOne = (number, checked) => select(checked ? [...selected, number] : selected.filter((item) => item !== number))
  return (
    <>
      <title>Orders | BuyNest Admin</title>
      <PageHeader
        title="Orders"
        description={orders.data ? `${formatCount(orders.data.total)} ${filtered ? 'matching orders' : 'orders'}` : undefined}
        actions={
          <>
            <a href={ordersCsvUrl({ q, status, paymentStatus: payment, source, zone, cod, confirmation })} className="btn btn--outline" download>
              <LuDownload aria-hidden="true" /> Export CSV
            </a>
            {can('orders.create') && (
              <Link to="/orders/new" className="btn btn--primary">
                <LuPlus aria-hidden="true" /> Create order
              </Link>
            )}
          </>
        }
      />
      {location.state?.notice && (
        <p className="notice" role="status">
          {location.state.notice}
        </p>
      )}
      <div role="status">
        {summary && (
          <div ref={summaryRef} tabIndex={-1} className="notice notice--success bulk-summary">
            <p>
              {/* Phase 14 §5: a downloaded file says what it was. */}
              {summary.text ?? `${summary.done.length === 1 ? '1 order' : `${formatCount(summary.done.length)} orders`} ${summary.verb}.`}
              {summary.skipped.length > 0 && ` ${formatCount(summary.skipped.length)} skipped:`}
            </p>
            {summary.skipped.length > 0 && (
              <ul>
                {summary.skipped.map((item) => (
                  <li key={item.number}>
                    <Link to={`/orders/${item.number}`}>{item.number}</Link>: {item.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

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
        <label className="toolbar__select">
          <span>Source</span>
          <select value={source} onChange={(event) => update({ source: event.target.value, skip: 0 })}>
            <option value="">All sources</option>
            {Object.entries(ORDER_SOURCES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {/* Phase 14 §5: Bangladesh delivery and cash on delivery. */}
        <label className="toolbar__select">
          <span>Delivery zone</span>
          <select value={zone} onChange={(event) => update({ zone: event.target.value, skip: 0 })}>
            <option value="">All zones</option>
            {zoneOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Cash on delivery</span>
          <select value={cod} onChange={(event) => update({ cod: event.target.value, skip: 0 })}>
            <option value="">All payment methods</option>
            <option value="1">Cash on delivery only</option>
          </select>
        </label>
        <label className="toolbar__select">
          <span>Confirmation</span>
          <select value={confirmation} onChange={(event) => update({ confirmation: event.target.value, skip: 0 })}>
            <option value="">Any</option>
            {Object.entries(CONFIRMATION_STATUSES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <GridPreferences
        prefs={grid}
        noun="orders"
        onPageSize={() => update({ skip: 0 })}
        current={{ q, status, paymentStatus: payment, source, ...(zone && { zone }), ...(cod && { cod }), ...(confirmation && { confirmation }) }}
        onApply={(saved) => {
          setDraft(saved.q ?? '')
          setParams(new URLSearchParams(Object.entries(saved).filter(([, value]) => value !== '' && value !== null)))
        }}
      />
      {selected.length > 0 && <OrderBulkActions selected={selected} onDone={bulkDone} onClear={() => select([])} onDownloaded={(text) => setSummary({ text, done: [], skipped: [] })} />}

      {orders.isPending && <Loading label="Loading orders…" />}
      {orders.error && <ErrorState error={orders.error} onRetry={orders.refetch} />}
      {orders.data && orders.data.orders.length === 0 && <Empty>{filtered ? 'No orders match.' : 'No orders yet.'}</Empty>}
      {orders.data && orders.data.orders.length > 0 && (
        <div className="table-wrap" aria-busy={orders.isFetching}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="table__check">
                  <input
                    type="checkbox"
                    aria-label="Select all orders on this page"
                    checked={allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = selected.length > 0 && !allSelected
                    }}
                    onChange={(event) => select(event.target.checked ? pageOrders.map((order) => order.number) : [])}
                  />
                </th>
                <th scope="col">Order</th>
                {grid.isVisible('customer') && <th scope="col">Customer</th>}
                {grid.isVisible('placed') && <th scope="col">Placed</th>}
                {grid.isVisible('source') && <th scope="col">Source</th>}
                {grid.isVisible('status') && <th scope="col">Status</th>}
                {grid.isVisible('payment') && <th scope="col">Payment</th>}
                {grid.isVisible('total') && (
                  <th scope="col" className="num">
                    Total
                  </th>
                )}
                {grid.isVisible('zone') && <th scope="col">Delivery zone</th>}
                {grid.isVisible('confirmation') && <th scope="col">Confirmation</th>}
              </tr>
            </thead>
            <tbody>
              {orders.data.orders.map((order) => (
                <tr key={order.number} className={selected.includes(order.number) ? 'is-selected' : undefined}>
                  <td className="table__check">
                    <input type="checkbox" aria-label={`Select order ${order.number}`} checked={selected.includes(order.number)} onChange={(event) => toggleOne(order.number, event.target.checked)} />
                  </td>
                  <td>
                    <Link to={`/orders/${order.number}`}>{order.number}</Link>
                  </td>
                  {grid.isVisible('customer') && (
                    <td>
                      {order.customer}
                      <small className="muted"> · {order.guest ? 'Guest' : 'Account'}</small>
                    </td>
                  )}
                  {grid.isVisible('placed') && <td>{formatDate(order.placedAt)}</td>}
                  {grid.isVisible('source') && (
                    <td>
                      <StatusBadge {...orderSource(order.source)} />
                    </td>
                  )}
                  {grid.isVisible('status') && (
                    <td>
                      <StatusBadge {...orderStatus(order.status)} />
                    </td>
                  )}
                  {grid.isVisible('payment') && (
                    <td>
                      <StatusBadge {...paymentStatus(order.paymentStatus)} />
                    </td>
                  )}
                  {grid.isVisible('total') && <td className="num">{formatMoney(order.total, order.currency)}</td>}
                  {grid.isVisible('zone') && <td>{order.deliveryZone ? (order.deliveryZone.name ?? order.deliveryZone.code) : <span className="muted">—</span>}</td>}
                  {grid.isVisible('confirmation') && <td>{order.confirmationStatus ? <StatusBadge {...confirmationStatus(order.confirmationStatus)} /> : <span className="muted">—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={orders.data.total} limit={limit} skip={skip} onChange={(next) => update({ skip: next })} />
        </div>
      )}
    </>
  )
}

const OrdersPage = LIVE_DATA ? LiveOrdersPage : DemoOrdersPage

export default OrdersPage
