import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { adminKeys, getOverview } from '../api/admin'
import PageHeader from '../components/PageHeader'
import StatTile from '../components/StatTile'
import StatusBadge from '../components/StatusBadge'
import { ErrorState, Loading } from '../components/States'
import { formatCount, formatCountCompact, formatDate, formatMoney, formatMoneyCompact, formatSlug } from '../utils/format'
import { ORDER_STATUSES, orderStatus } from '../utils/orders'

/** The shop at a glance: headline numbers, then what needs attention. */
function OverviewPage() {
  const overview = useQuery({ queryKey: adminKeys.overview, queryFn: ({ signal }) => getOverview({ signal }) })

  if (overview.isPending) return <Loading label="Loading the overview…" />
  if (overview.error) return <ErrorState error={overview.error} onRetry={overview.refetch} />

  const { products, orders, customers, lowStockProducts, latestOrders, lowStockThreshold, live } = overview.data
  // Real data (live) counts revenue from orders that aren't cancelled, and knows each order's status.
  const averageOrder = orders.averageOrder ?? (orders.total > 0 ? orders.revenue / orders.total : 0)
  return (
    <>
      <title>Overview | BuyNest Admin</title>
      <PageHeader title="Overview" description="All orders, products, and customers in the store's data." />

      {/* One hero number (revenue), then six supporting tiles. No trend arrows: the demo data has no history. */}
      <dl className="stats">
        <StatTile
          hero
          label="Revenue"
          value={formatMoneyCompact(orders.revenue)}
          note={live ? `${formatCount(orders.total)} orders, not counting cancelled ones` : `${formatCount(orders.total)} orders, after discounts`}
        />
        <StatTile label="Average order" value={formatMoney(averageOrder)} />
        <StatTile label="Units sold" value={formatCountCompact(orders.unitsSold)} />
        <StatTile
          label="Products"
          value={formatCount(products.total)}
          note={live ? `${formatCount(products.active)} active · ${formatCount(products.outOfStock)} out of stock` : `${formatCount(products.outOfStock)} out of stock`}
        />
        <StatTile label="Low stock" value={formatCount(products.lowStock)} note={`Fewer than ${lowStockThreshold} units`} />
        <StatTile label="Customers" value={formatCount(customers.total)} />
        <StatTile label="Inventory value" value={formatMoneyCompact(products.inventoryValue)} note="Price × units in stock" />
      </dl>

      {live && orders.byStatus && (
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
                  <td className="num">{formatMoney(order.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  )
}

export default OverviewPage
