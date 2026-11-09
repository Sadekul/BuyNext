import { Link, useParams } from 'react-router'
import { LuArrowLeft, LuPackageX } from 'react-icons/lu'
import OrderDetailsView from '../components/orders/OrderDetailsView'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useOrders } from '../hooks/useOrders'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './OrderPages.css'

/** /account/orders/:orderId — only finds orders belonging to the signed-in customer. */
function OrderDetailsPage() {
  const { orderId } = useParams()
  const order = useOrders().getOrder(orderId)

  if (!order) {
    return (
      <EmptyState icon={LuPackageX} titleAs="h2" title="Order not found" message="This order doesn't exist or belongs to another account.">
        <Button to={ROUTES.orders}>Back to orders</Button>
      </EmptyState>
    )
  }

  return (
    <section className="orders" aria-labelledby="order-details-title">
      <title>{`Order ${order.id} | ${SITE.name}`}</title>
      <Link to={ROUTES.orders} className="orders__back">
        <LuArrowLeft aria-hidden="true" /> All orders
      </Link>
      <h2 id="order-details-title" className="orders__title">
        Order {order.id}
      </h2>
      <OrderDetailsView order={order} />
    </section>
  )
}

export default OrderDetailsPage
