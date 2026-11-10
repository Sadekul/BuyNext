import { orderStatus, paymentStatus } from '../../constants/orders'
import './OrderStatusBadge.css'

/** An order's status (or, with `payment`, its payment status) as icon + words. */
function OrderStatusBadge({ status, payment = false }) {
  const { label, icon: Icon } = payment ? paymentStatus(status) : orderStatus(status)
  return (
    <span className={`order-badge order-badge--${status}`}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  )
}

export default OrderStatusBadge
