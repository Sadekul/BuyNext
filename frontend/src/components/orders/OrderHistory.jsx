import OrderStatusBadge from './OrderStatusBadge'
import { formatDateTime } from '../../utils/formatters'
import './OrderHistory.css'

/** What happened to an order, oldest first: each status change with its date and note. */
function OrderHistory({ history }) {
  if (!history?.length) return null
  return (
    <ol className="order-history" aria-label="Order history">
      {history.map((entry, index) => (
        <li key={`${entry.createdAt}-${index}`} className="order-history__entry">
          <OrderStatusBadge status={entry.status} />
          <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
          {entry.note && <p className="order-history__note">{entry.note}</p>}
        </li>
      ))}
    </ol>
  )
}

export default OrderHistory
