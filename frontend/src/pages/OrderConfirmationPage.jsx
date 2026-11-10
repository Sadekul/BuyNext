import { useLocation, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuCircleCheck, LuClock, LuPackageX } from 'react-icons/lu'
import OrderDetailsView from '../components/orders/OrderDetailsView'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useOrders } from '../hooks/useOrders'
import { orderQuery } from '../queries/orderQueries'
import { paymentNote } from '../constants/orders'
import { REAL_SHOP } from '../constants/shop'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './OrderPages.css'

/** Demo: the order saved in this browser by the simulated checkout. */
function DemoOrderConfirmation() {
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
      <div className="order-page__hero" role="status">
        <LuCircleCheck className="order-page__check" aria-hidden="true" />
        <div>
          <h1>Thank you, {user.firstName}!</h1>
          <p>
            Your order <strong>{order.id}</strong> was recorded (demo). A real store would email a confirmation to{' '}
            <strong>{order.contact.email}</strong>; no email was sent.
          </p>
        </div>
      </div>

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

/**
 * BuyNest's API: the order the server returned when it was placed (passed in
 * the navigation state, which survives a reload), so this works for guests
 * too. A signed-in customer without it (e.g. a shared link) loads it by number.
 */
function ServerOrderConfirmation() {
  const { orderId } = useParams()
  const location = useLocation()
  const { user, isAuthenticated, authorizedRequest } = useAuth()
  const placed = location.state?.order?.number === orderId ? location.state.order : null
  const request = useQuery({ ...orderQuery(user?.id, orderId, authorizedRequest), enabled: !placed && isAuthenticated })
  const order = placed ?? request.data

  if (!order && request.isLoading) {
    return (
      <div className="section container">
        <Loader label="Loading your order…" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="section container">
        <EmptyState icon={LuPackageX} title="Order not found" message="Look it up with the order number and the email you used at checkout.">
          <Button to={ROUTES.trackOrder}>Track your order</Button>
        </EmptyState>
      </div>
    )
  }

  const awaitingPayment = order.status === 'pending_payment'
  const firstName = user?.firstName || order.shippingAddress?.firstName
  const HeroIcon = awaitingPayment ? LuClock : LuCircleCheck

  return (
    <div className="order-page section container">
      <title>{`Order ${order.number} | ${SITE.name}`}</title>
      <div className="order-page__hero" role="status">
        <HeroIcon className="order-page__check" aria-hidden="true" />
        <div>
          <h1>{firstName ? `Thank you, ${firstName}!` : 'Thank you!'}</h1>
          <p>
            Your order <strong>{order.number}</strong> {awaitingPayment ? 'is saved and awaiting payment.' : 'is confirmed.'} We've emailed a
            confirmation to <strong>{order.email}</strong>.
          </p>
          {awaitingPayment && <p>{paymentNote(order)}</p>}
          {!isAuthenticated && <p>Keep your order number: with your email, it lets you track this order.</p>}
        </div>
      </div>

      <OrderDetailsView order={order} />

      <div className="order-page__actions">
        {isAuthenticated ? (
          <Button to={ROUTES.orderDetails(order.number)} variant="outline">
            View order details
          </Button>
        ) : (
          <Button to={ROUTES.trackOrder} variant="outline">
            Track your order
          </Button>
        )}
        <Button to={ROUTES.products}>Continue shopping</Button>
      </div>
    </div>
  )
}

const OrderConfirmationPage = REAL_SHOP ? ServerOrderConfirmation : DemoOrderConfirmation

export default OrderConfirmationPage
