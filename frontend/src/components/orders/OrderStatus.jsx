import { LuCheck } from 'react-icons/lu'
import { cn } from '../../utils/classNames'
import './OrderStatus.css'

const STEPS = [
  { id: 'placed', label: 'Order placed' },
  { id: 'processing', label: 'Processing' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
]

/**
 * Status timeline. Statuses are set by the backend as the warehouse works;
 * demo orders stay at "Order placed" because there is no backend yet.
 */
function OrderStatus({ status }) {
  const currentIndex = Math.max(0, STEPS.findIndex((step) => step.id === status))

  return (
    <ol className="order-status" aria-label="Order status">
      {STEPS.map((step, index) => {
        const isDone = index <= currentIndex
        return (
          <li
            key={step.id}
            className={cn('order-status__step', isDone && 'order-status__step--done')}
            aria-current={index === currentIndex ? 'step' : undefined}
          >
            <span className="order-status__dot" aria-hidden="true">
              {isDone && <LuCheck />}
            </span>
            <span>{step.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export default OrderStatus
