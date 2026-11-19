import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuPackage } from 'react-icons/lu'
import OrderStatusBadge from '../components/orders/OrderStatusBadge'
import Pagination from '../components/common/Pagination'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useOrders } from '../hooks/useOrders'
import { ordersQuery } from '../queries/orderQueries'
import { REAL_SHOP } from '../constants/shop'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate, formatBasePrice } from '../utils/formatters'
import './OrderPages.css'

function NoOrders() {
  return (
    <EmptyState icon={LuPackage} titleAs="h2" title="No orders yet" message="Orders you place will appear here.">
      <Button to={ROUTES.products}>Start shopping</Button>
    </EmptyState>
  )
}

/** One row of the order history; works for real (`number`) and demo (`id`) orders. */
function OrderRow({ order }) {
  const id = order.number ?? order.id
  return (
    <li className="orders__item">
      <div className="orders__thumbs" aria-hidden="true">
        {order.items.slice(0, 3).map((item, index) => (
          <img key={`${item.productId ?? ''}-${item.variantId ?? ''}-${index}`} src={item.thumbnail} alt="" width="48" height="48" loading="lazy" />
        ))}
      </div>
      <div className="orders__info">
        <Link to={ROUTES.orderDetails(id)} className="orders__id">
          Order {id}
        </Link>
        <span className="orders__meta">
          {formatDate(new Date(order.placedAt).toISOString())} · {order.totals.itemCount} {order.totals.itemCount === 1 ? 'item' : 'items'}
        </span>
      </div>
      <OrderStatusBadge status={order.status} />
      <span className="orders__total">{formatBasePrice(order.totals.total, order.currency)}</span>
    </li>
  )
}

/** Demo: the signed-in customer's orders saved on this device. */
function DemoOrdersPage() {
  const { orders } = useOrders()
  if (orders.length === 0) return <NoOrders />

  return (
    <section className="orders" aria-labelledby="orders-title">
      <title>{`Orders | ${SITE.name}`}</title>
      <h2 id="orders-title" className="orders__title">
        Order history
      </h2>
      <p className="orders__note">Demo orders are saved on this device only.</p>
      <ul className="orders__list">
        {orders.map((order) => (
          <OrderRow key={order.id} order={order} />
        ))}
      </ul>
    </section>
  )
}

/** BuyNest's API: the customer's orders, newest first, a page at a time (?page=2). */
function ServerOrdersPage() {
  const { user, authorizedRequest } = useAuth()
  const [params, setParams] = useSearchParams()
  const page = Math.max(Number.parseInt(params.get('page') ?? '1', 10) || 1, 1)
  const request = useQuery(ordersQuery(user.id, authorizedRequest, page))

  if (request.isPending) return <Loader label="Loading your orders…" />
  if (request.error) return <ErrorMessage title="We couldn't load your orders" titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />
  const { orders, lastPage } = request.data
  if (orders.length === 0 && page === 1) return <NoOrders />

  return (
    <section className="orders" aria-labelledby="orders-title" aria-busy={request.isFetching}>
      <title>{`Orders | ${SITE.name}`}</title>
      <h2 id="orders-title" className="orders__title">
        Order history
      </h2>
      <ul className="orders__list">
        {orders.map((order) => (
          <OrderRow key={order.number} order={order} />
        ))}
      </ul>
      <Pagination currentPage={page} pageCount={lastPage} onPageChange={(next) => setParams(next > 1 ? { page: String(next) } : {})} />
    </section>
  )
}

/** /account/orders — the signed-in customer's orders. */
const OrdersPage = REAL_SHOP ? ServerOrdersPage : DemoOrdersPage

export default OrdersPage
