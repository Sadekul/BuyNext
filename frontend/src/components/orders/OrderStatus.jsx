import { LuCheck } from 'react-icons/lu'
import OrderStatusBadge from './OrderStatusBadge'
import { cn } from '../../utils/classNames'
import './OrderStatus.css'
import { useTranslation } from 'react-i18next'

const STEPS = ['placed', 'processing', 'shipped', 'delivered']

// Where each status sits on the steps. Awaiting payment is still "placed".
const STEP_OF = { placed: 0, pending_payment: 0, processing: 1, shipped: 2, delivered: 3 }

/**
 * Status timeline. Statuses are set by the backend as the warehouse works;
 * demo orders stay at "Order placed" because there is no backend. A
 * cancelled order has no next step, so it shows its status instead.
 */
function OrderStatus({ status }) {
  const { t } = useTranslation('orders')
  // Cancelled and closed (fully refunded) orders have no next step.
  if (status === 'cancelled' || status === 'closed') return <OrderStatusBadge status={status} />
  const currentIndex = STEP_OF[status] ?? 0

  return (
    <ol className="order-status" aria-label={t('steps.label')}>
      {STEPS.map((id, index) => {
        const isDone = index <= currentIndex
        return (
          <li
            key={id}
            className={cn('order-status__step', isDone && 'order-status__step--done')}
            aria-current={index === currentIndex ? 'step' : undefined}
          >
            <span className="order-status__dot" aria-hidden="true">
              {isDone && <LuCheck />}
            </span>
            <span>{t(`steps.${id}`)}</span>
          </li>
        )
      })}
    </ol>
  )
}

export default OrderStatus
