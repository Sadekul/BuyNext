import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { adminKeys, getOrders } from '../api/admin'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatMoney } from '../utils/format'

const LIMIT = 20

/**
 * Orders = DummyJSON's carts (the demo API's only order-like data). Orders
 * placed in the storefront's simulated checkout stay in each customer's
 * browser, so they aren't listed here; with Laravel they will be.
 */
function OrdersPage() {
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

export default OrdersPage
