import { Link } from 'react-router'
import { LuPackage } from 'react-icons/lu'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useOrders } from '../hooks/useOrders'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate, formatPrice } from '../utils/formatters'
import './OrderPages.css'

const STATUS_LABELS = { placed: 'Placed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered' }

/** /account/orders — the signed-in customer's (demo) orders on this device. */
function OrdersPage() {
  const { orders } = useOrders()

  if (orders.length === 0) {
    return (
      <EmptyState icon={LuPackage} titleAs="h2" title="No orders yet" message="Orders you place will appear here.">
        <Button to={ROUTES.products}>Start shopping</Button>
      </EmptyState>
    )
  }

  return (
    <section className="orders" aria-labelledby="orders-title">
      <title>{`Orders | ${SITE.name}`}</title>
      <h2 id="orders-title" className="orders__title">
        Order history
      </h2>
      <p className="orders__note">Demo orders are saved on this device only.</p>
      <ul className="orders__list">
        {orders.map((order) => (
          <li key={order.id} className="orders__item">
            <div className="orders__thumbs" aria-hidden="true">
              {order.items.slice(0, 3).map((item) => (
                <img key={item.productId} src={item.thumbnail} alt="" width="48" height="48" loading="lazy" />
              ))}
            </div>
            <div className="orders__info">
              <Link to={ROUTES.orderDetails(order.id)} className="orders__id">
                Order {order.id}
              </Link>
              <span className="orders__meta">
                {formatDate(new Date(order.placedAt).toISOString())} · {order.totals.itemCount}{' '}
                {order.totals.itemCount === 1 ? 'item' : 'items'}
              </span>
            </div>
            <span className="orders__status">{STATUS_LABELS[order.status] ?? order.status}</span>
            <span className="orders__total">{formatPrice(order.totals.total)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default OrdersPage
