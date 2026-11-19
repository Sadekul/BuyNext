import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { adminKeys, getOverview } from '../api/admin'
import { useAdminAuth } from '../auth/useAdminAuth'
import PageHeader from '../components/PageHeader'
import StatTile from '../components/StatTile'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { formatCount, formatCountCompact, formatDate, formatMoney, formatMoneyCompact, formatSlug } from '../utils/format'
import { ORDER_STATUSES, orderStatus } from '../utils/orders'

/*
 * Phase 7 (Magento's dashboard): the API includes each block only with its
 * permission (products.view, orders.view, customers.view, reports.view…), and
 * so does this page; a block the role can't see is simply not there.
 */
const TODO = [
  { key: 'ordersToInvoice', label: 'Orders to invoice', to: '/orders?paymentStatus=unpaid', permission: 'orders.view' },
  { key: 'ordersToShip', label: 'Orders to ship', to: '/orders?status=processing', permission: 'orders.view' },
  { key: 'returnRequests', label: 'Return requests', to: '/returns?status=requested', permission: 'returns.view' },
  { key: 'pendingReviews', label: 'Reviews to approve', to: '/reviews?status=pending', permission: 'reviews.view' },
  { key: 'lowStockProducts', label: 'Low-stock products', to: '/products?sortBy=stock&order=asc', permission: 'products.view' },
]
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const dayLabel = (date) => dayFormat.format(new Date(`${date}T00:00:00Z`))

/** The shop at a glance: headline numbers, what needs doing, then the latest activity. */
function OverviewPage() {
  const { can } = useAdminAuth()
  const overview = useQuery({ queryKey: adminKeys.overview, queryFn: ({ signal }) => getOverview({ signal }) })

  if (overview.isPending) return <Loading label="Loading the overview…" />
  if (overview.error) return <ErrorState error={overview.error} onRetry={overview.refetch} />

  const data = overview.data
  const { lowStockThreshold, live } = data
  // Each block: sent by the server (it checks the permission) and allowed here.
  const products = can('products.view') ? data.products : null
  const orders = can('orders.view') ? data.orders : null
  const customers = can('customers.view') ? data.customers : null
  const lowStockProducts = can('products.view') ? data.lowStockProducts : null
  const latestOrders = can('orders.view') ? data.latestOrders : null
  const revenueChart = can('orders.view') ? data.revenueChart : null
  const bestsellers = can('reports.view') ? data.bestsellers : null
  const newCustomers = can('customers.view') ? data.newCustomers : null
  const topSearchTerms = can('reports.view') ? data.topSearchTerms : null
  const todo = TODO.filter((item) => can(item.permission) && Number.isInteger(data.todo?.[item.key]))
  // Real data (live) counts revenue from orders that aren't cancelled, and knows each order's status.
  const averageOrder = orders && (orders.averageOrder ?? (orders.total > 0 ? orders.revenue / orders.total : 0))
  const nothing = !products && !orders && !customers && todo.length === 0 && !bestsellers && !newCustomers && !topSearchTerms

  return (
    <>
      <title>Overview | BuyNest Admin</title>
      <PageHeader title="Overview" description="All orders, products, and customers in the store's data." />
      {nothing && <p className="state">Your role has no dashboard blocks. Use the menu to open the screens it allows.</p>}

      {/* One hero number (lifetime sales), then the supporting tiles. No trend arrows: the demo data has no history. */}
      {(orders || products || customers) && (
        <dl className="stats">
          {orders && (
            <>
              <StatTile
                hero
                label={live ? 'Lifetime sales' : 'Revenue'}
                value={formatMoneyCompact(orders.revenue)}
                note={live ? `${formatCount(orders.total)} orders, not counting cancelled ones or refunds` : `${formatCount(orders.total)} orders, after discounts`}
              />
              <StatTile label="Average order" value={formatMoney(averageOrder)} />
              <StatTile label="Units sold" value={formatCountCompact(orders.unitsSold)} />
            </>
          )}
          {products && (
            <>
              <StatTile
                label="Products"
                value={formatCount(products.total)}
                note={live ? `${formatCount(products.active)} active · ${formatCount(products.outOfStock)} out of stock` : `${formatCount(products.outOfStock)} out of stock`}
              />
              <StatTile label="Low stock" value={formatCount(products.lowStock)} note={`Fewer than ${lowStockThreshold} units`} />
            </>
          )}
          {customers && <StatTile label="Customers" value={formatCount(customers.total)} />}
          {products && <StatTile label="Inventory value" value={formatMoneyCompact(products.inventoryValue)} note="Price × units in stock" />}
        </dl>
      )}

      {todo.length > 0 && (
        <section className="panel panel--spaced" aria-labelledby="todo-title">
          <header className="panel__header">
            <h2 id="todo-title">To do</h2>
          </header>
          <ul className="todo-list">
            {todo.map((item) => (
              <li key={item.key}>
                <Link to={item.to}>
                  <strong>{formatCount(data.todo[item.key])}</strong> {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {revenueChart && revenueChart.length > 0 && <RevenueChart points={revenueChart} />}

      {live && orders?.byStatus && (
        <section className="panel panel--spaced" aria-labelledby="by-status-title">
          <header className="panel__header">
            <h2 id="by-status-title">Orders by status</h2>
            <Link to="/orders">All orders</Link>
          </header>
          <ul className="by-status">
            {Object.keys(ORDER_STATUSES).map((status) => (
              <li key={status}>
                <Link to={`/orders?status=${status}`}>
                  <StatusBadge {...orderStatus(status)} /> <strong>{formatCount(orders.byStatus[status] ?? 0)}</strong>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="panels">
        {lowStockProducts && (
          <section className="panel" aria-labelledby="restock-title">
            <header className="panel__header">
              <h2 id="restock-title">Needs restocking</h2>
              <Link to="/products?sortBy=stock&order=asc">All by stock</Link>
            </header>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Units
                  </th>
                </tr>
              </thead>
              <tbody>
                {lowStockProducts.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link to={`/products/${product.id}`} className="table__product">
                        <img src={product.thumbnail} alt="" width="36" height="36" loading="lazy" />
                        <span>
                          {product.title}
                          <small>{formatSlug(product.category)}</small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge stock={product.stock} />
                    </td>
                    <td className="num">{formatCount(product.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {latestOrders && (
          <section className="panel" aria-labelledby="latest-title">
            <header className="panel__header">
              <h2 id="latest-title">Latest orders</h2>
              <Link to="/orders">All orders</Link>
            </header>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  {live && <th scope="col">Status</th>}
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {latestOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link to={`/orders/${order.id}`}>{live ? order.number : `#${order.id}`}</Link>
                      {live && <small className="muted"> {formatDate(order.placedAt)}</small>}
                    </td>
                    <td>
                      {order.customer}
                      <small className="muted"> · {formatCount(order.items)} items</small>
                    </td>
                    {live && (
                      <td>
                        <StatusBadge {...orderStatus(order.status)} />
                      </td>
                    )}
                    <td className="num">{formatMoney(order.total, order.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {bestsellers && (
          <section className="panel" aria-labelledby="bestsellers-title">
            <header className="panel__header">
              <h2 id="bestsellers-title">Bestsellers</h2>
              <Link to="/reports">Reports</Link>
            </header>
            {bestsellers.length === 0 ? (
              <p className="muted panel__empty">No sales yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col" className="num">
                      Units
                    </th>
                    <th scope="col" className="num">
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bestsellers.map((row) => (
                    <tr key={row.productId ?? row.name}>
                      <td>
                        {row.productId && can('products.view') ? <Link to={`/products/${row.productId}`}>{row.name}</Link> : row.name}
                        {row.sku && <small className="muted"> {row.sku}</small>}
                      </td>
                      <td className="num">{formatCount(row.units)}</td>
                      <td className="num">{formatMoney(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {newCustomers && (
          <section className="panel" aria-labelledby="new-customers-title">
            <header className="panel__header">
              <h2 id="new-customers-title">New customers</h2>
              <Link to="/customers">All customers</Link>
            </header>
            {newCustomers.length === 0 ? (
              <p className="muted panel__empty">No customers yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {newCustomers.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <Link to={`/customers/${customer.id}`}>{customer.name || customer.email}</Link>
                        <small className="muted table__sub">{customer.email}</small>
                      </td>
                      <td>{formatDate(customer.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {topSearchTerms && (
          <section className="panel" aria-labelledby="search-terms-title">
            <header className="panel__header">
              <h2 id="search-terms-title">Top search terms</h2>
            </header>
            {topSearchTerms.length === 0 ? (
              <p className="muted panel__empty">No searches yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Term</th>
                    <th scope="col" className="num">
                      Searches
                    </th>
                    <th scope="col" className="num">
                      Results
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topSearchTerms.map((row) => (
                    <tr key={row.term}>
                      <td>{row.term}</td>
                      <td className="num">{formatCount(row.hits)}</td>
                      <td className="num">{row.results === null ? '—' : row.results === 0 ? <StatusBadge tone="warning" label="None" /> : formatCount(row.results)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </>
  )
}

/**
 * Revenue for the last 30 days: one bar per day (single series, so no
 * legend; the heading names it). The summary is the text alternative and
 * the table has every value.
 */
function RevenueChart({ points }) {
  const max = Math.max(0, ...points.map((point) => point.revenue)) || 1
  const total = points.reduce((sum, point) => sum + Math.round(point.revenue * 100), 0) / 100
  const orders = points.reduce((sum, point) => sum + point.orders, 0)
  const best = points.reduce((top, point) => (point.revenue > top.revenue ? point : top), points[0])
  const summary = `${formatMoney(total)} from ${formatCount(orders)} orders between ${dayLabel(points[0].date)} and ${dayLabel(points.at(-1).date)}${best.revenue > 0 ? `; best day ${dayLabel(best.date)} (${formatMoney(best.revenue)})` : ''}.`
  const labelled = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])

  return (
    <section className="panel panel--spaced" aria-labelledby="revenue-title">
      <header className="panel__header">
        <h2 id="revenue-title">Revenue, last 30 days</h2>
        <Link to="/reports">Sales report</Link>
      </header>
      <div className="chart">
        <p id="revenue-summary" className="chart__summary">
          {summary}
        </p>
        <figure className="chart__figure" role="img" aria-labelledby="revenue-title" aria-describedby="revenue-summary">
          <div className="chart__axis" aria-hidden="true">
            <span>{formatMoneyCompact(max)}</span>
          </div>
          <div className="chart__plot" aria-hidden="true">
            <span className="chart__zero" style={{ bottom: 0 }} />
            {points.map((point) => (
              <div key={point.date} className="chart__slot">
                <span className="chart__bar" style={{ bottom: 0, height: `${(point.revenue / max) * 100}%` }} />
                <span className="chart__tip">
                  <strong>{formatMoney(point.revenue)}</strong> {dayLabel(point.date)} · {formatCount(point.orders)} orders
                </span>
              </div>
            ))}
          </div>
          <div className="chart__labels" aria-hidden="true">
            {points.map((point, index) => (
              <span key={point.date}>{labelled.has(index) ? dayLabel(point.date) : ''}</span>
            ))}
          </div>
        </figure>
        <details className="chart__table">
          <summary>Show the numbers as a table</summary>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Revenue by day, last 30 days</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="num">
                    Orders
                  </th>
                  <th scope="col" className="num">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.date}>
                    <th scope="row">{dayLabel(point.date)}</th>
                    <td className="num">{formatCount(point.orders)}</td>
                    <td className="num">{formatMoney(point.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  )
}

export default OverviewPage
