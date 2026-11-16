import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuArrowLeft, LuPackageX } from 'react-icons/lu'
import OrderStatusBadge from '../components/orders/OrderStatusBadge'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { returnQuery } from '../queries/customerQueries'
import { orderQuery } from '../queries/orderQueries'
import { returnStatus } from '../constants/orders'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate, formatDateTime, formatPrice } from '../utils/formatters'
import '../components/orders/OrderDetailsView.css'
import '../components/orders/OrderHistory.css'
import '../components/orders/OrderItems.css'
import './OrderPages.css'

const RESOLUTIONS = { refund: 'Refund', replace: 'Replacement' }
const CONDITIONS = { unopened: 'Unopened', opened: 'Opened', damaged: 'Damaged' }

function NotFound() {
  return (
    <EmptyState icon={LuPackageX} titleAs="h2" title="Return not found" message="This return doesn't exist or belongs to another account.">
      <Button to={ROUTES.returns}>Back to returns</Button>
    </EmptyState>
  )
}

/** The order's history entries about this return ("Return RMA-100001 approved."), oldest first. */
const historyOf = (order, number) => (order?.history ?? []).filter((entry) => entry.note?.includes(number))

/**
 * /account/returns/:returnNumber (REAL_SHOP): one of the customer's returns,
 * with its status, items, and history. Every change to a return adds a note
 * to its order's history, so the history comes from the order.
 */
function ReturnDetailsPage() {
  const { returnNumber } = useParams()
  const { user, authorizedRequest } = useAuth()
  const request = useQuery(returnQuery(user.id, returnNumber, authorizedRequest))
  const orderNumber = request.data?.orderNumber
  const orderRequest = useQuery({ ...orderQuery(user.id, orderNumber, authorizedRequest), enabled: Boolean(orderNumber) })

  if (request.isPending) return <Loader label="Loading the return…" />
  if (request.error?.status === 404) return <NotFound />
  if (request.error) return <ErrorMessage title="We couldn't load this return" titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />

  const entry = request.data
  const status = returnStatus(entry.status)
  const history = historyOf(orderRequest.data, entry.number)
  return (
    <section className="orders" aria-labelledby="return-title">
      <title>{`Return ${entry.number} | ${SITE.name}`}</title>
      <Link to={ROUTES.returns} className="orders__back">
        <LuArrowLeft aria-hidden="true" /> All returns
      </Link>
      <h2 id="return-title" className="orders__title">
        Return {entry.number}
      </h2>

      <div className="order-view">
        <section className="order-view__card" aria-labelledby="return-status-title">
          <div className="order-view__row">
            <h3 id="return-status-title">Status</h3>
            {entry.createdAt && <p className="order-view__muted">Requested {formatDate(entry.createdAt)}</p>}
          </div>
          <OrderStatusBadge kind="return" status={entry.status} />
          {status.help && <p>{status.help}</p>}
          {entry.message && (
            <div>
              <h4 className="order-view__subheading">Message from us</h4>
              <p>{entry.message}</p>
            </div>
          )}
          {history.length > 0 && (
            <>
              <h4 className="order-view__subheading">History</h4>
              <ol className="order-history" aria-label="Return history">
                {history.map((change, index) => (
                  <li key={`${change.createdAt}-${index}`} className="order-history__entry">
                    <time dateTime={change.createdAt}>{formatDateTime(change.createdAt)}</time>
                    <p className="order-history__note">{change.note}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section className="order-view__card" aria-labelledby="return-details-title">
          <h3 id="return-details-title">Details</h3>
          <dl className="return-details">
            {entry.orderNumber && (
              <div>
                <dt>Order</dt>
                <dd>
                  <Link to={ROUTES.orderDetails(entry.orderNumber)} className="order-view__link">
                    {entry.orderNumber}
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt>Reason</dt>
              <dd>{entry.reason}</dd>
            </div>
            {entry.comment && (
              <div>
                <dt>Your comment</dt>
                <dd>{entry.comment}</dd>
              </div>
            )}
            {entry.resolution && (
              <div>
                <dt>Resolution</dt>
                <dd>{RESOLUTIONS[entry.resolution]}</dd>
              </div>
            )}
            {entry.refund && (
              <div>
                <dt>Refund</dt>
                <dd>
                  {formatPrice(entry.refund.total)} ({entry.refund.number}
                  {entry.refund.createdAt && `, ${formatDate(entry.refund.createdAt)}`})
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="order-view__card" aria-labelledby="return-items-title">
          <h3 id="return-items-title">Items</h3>
          <ul className="order-items">
            {(entry.items ?? []).map((item, index) => (
              <li key={item.id ?? index} className="order-items__row">
                <span className="order-items__thumb">{item.thumbnail && <img src={item.thumbnail} alt="" width="56" height="56" loading="lazy" />}</span>
                <span className="order-items__title">
                  {item.title}
                  {item.variantLabel && <span className="order-items__variant">{item.variantLabel}</span>}
                  {item.condition && <span className="order-items__meta">Condition: {CONDITIONS[item.condition]}</span>}
                </span>
                <span className="order-items__total">× {item.quantity}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}

export default ReturnDetailsPage
