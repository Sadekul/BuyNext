import { useParams } from 'react-router'
import { LuCircleCheck, LuPackageX } from 'react-icons/lu'
import OrderDetailsView from '../components/orders/OrderDetailsView'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { useAuth } from '../hooks/useAuth'
import { useOrders } from '../hooks/useOrders'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './OrderPages.css'

function OrderConfirmationPage() {
  const { orderId } = useParams()
  const { getOrder } = useOrders()
  const { user } = useAuth()
  const order = getOrder(orderId)

  if (!order) {
    return (
      <div className="section container">
        <EmptyState icon={LuPackageX} title="Order not found" message="We couldn't find that order on this device.">
          <Button to={ROUTES.orders}>View your orders</Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="order-page section container">
      <title>{`Order ${order.id} | ${SITE.name}`}</title>
      <header className="order-page__hero" role="status">
        <LuCircleCheck className="order-page__check" aria-hidden="true" />
        <div>
          <h1>Thank you, {user.firstName}!</h1>
          <p>
            Your order <strong>{order.id}</strong> was recorded (demo). A real store would email a confirmation to{' '}
            <strong>{order.contact.email}</strong>; no email was sent.
          </p>
        </div>
      </header>

      <OrderDetailsView order={order} />

      <div className="order-page__actions">
        <Button to={ROUTES.orderDetails(order.id)} variant="outline">
          View order details
        </Button>
        <Button to={ROUTES.products}>Continue shopping</Button>
      </div>
    </div>
  )
}

export default OrderConfirmationPage
