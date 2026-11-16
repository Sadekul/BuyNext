import { orderStatus, paymentStatus, returnStatus } from '../../constants/orders'
import './OrderStatusBadge.css'

/** An order's status (or, with `payment`, its payment status; with `kind="return"`, a return's) as icon + words. */
function OrderStatusBadge({ status, payment = false, kind = payment ? 'payment' : 'order' }) {
  const describe = { order: orderStatus, payment: paymentStatus, return: returnStatus }[kind] ?? orderStatus
  const { label, icon: Icon } = describe(status)
  return (
    <span className={`order-badge order-badge--${kind === 'return' ? 'return-' : ''}${status}`}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  )
}

export default OrderStatusBadge
