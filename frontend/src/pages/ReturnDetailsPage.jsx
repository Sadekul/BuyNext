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
import { formatDate, formatDateTime, formatBasePrice, formatNumber } from '../utils/formatters'
import '../components/orders/OrderDetailsView.css'
import '../components/orders/OrderHistory.css'
import '../components/orders/OrderItems.css'
import './OrderPages.css'
import { useTranslation } from 'react-i18next'

const RESOLUTIONS = { refund: 'Refund', replace: 'Replacement' }
const CONDITIONS = { unopened: 'Unopened', opened: 'Opened', damaged: 'Damaged' }

function NotFound() {
  const { t } = useTranslation('orders')
  return (
    <EmptyState icon={LuPackageX} titleAs="h2" title={t('returnDetails.notFound')} message={t('returnDetails.notFoundMessage')}>
      <Button to={ROUTES.returns}>{t('returnDetails.back')}</Button>
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
  const { t } = useTranslation('orders')
  const { returnNumber } = useParams()
  const { user, authorizedRequest } = useAuth()
  const request = useQuery(returnQuery(user.id, returnNumber, authorizedRequest))
  const orderNumber = request.data?.orderNumber
  const orderRequest = useQuery({ ...orderQuery(user.id, orderNumber, authorizedRequest), enabled: Boolean(orderNumber) })

  if (request.isPending) return <Loader label={t('returnDetails.loading')} />
  if (request.error?.status === 404) return <NotFound />
  if (request.error) return <ErrorMessage title={t('returnDetails.failed')} titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />

  const entry = request.data
  const status = returnStatus(entry.status)
  const history = historyOf(orderRequest.data, entry.number)
  return (
    <section className="orders" aria-labelledby="return-title">
      <title>{`${t('returns.return', { number: entry.number })} | ${SITE.name}`}</title>
      <Link to={ROUTES.returns} className="orders__back">
        <LuArrowLeft aria-hidden="true" /> {t('returnDetails.all')}
      </Link>
      <h2 id="return-title" className="orders__title">
        {t('returns.return', { number: entry.number })}
      </h2>

      <div className="order-view">
        <section className="order-view__card" aria-labelledby="return-status-title">
          <div className="order-view__row">
            <h3 id="return-status-title">{t('returnDetails.status')}</h3>
            {entry.createdAt && <p className="order-view__muted">{t('returnDetails.requested', { date: formatDate(entry.createdAt) })}</p>}
          </div>
          <OrderStatusBadge kind="return" status={entry.status} />
          {status.help && <p>{status.help}</p>}
          {entry.message && (
            <div>
              <h4 className="order-view__subheading">{t('returnDetails.message')}</h4>
              <p>{entry.message}</p>
            </div>
          )}
          {history.length > 0 && (
            <>
              <h4 className="order-view__subheading">{t('returnDetails.history')}</h4>
              <ol className="order-history" aria-label={t('returnDetails.historyLabel')}>
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
          <h3 id="return-details-title">{t('returnDetails.details')}</h3>
          <dl className="return-details">
            {entry.orderNumber && (
              <div>
                <dt>{t('returnDetails.order')}</dt>
                <dd>
                  <Link to={ROUTES.orderDetails(entry.orderNumber)} className="order-view__link">
                    {entry.orderNumber}
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt>{t('returnDetails.reason')}</dt>
              <dd>{entry.reason}</dd>
            </div>
            {entry.comment && (
              <div>
                <dt>{t('returnDetails.comment')}</dt>
                <dd>{entry.comment}</dd>
              </div>
            )}
            {entry.resolution && (
              <div>
                <dt>{t('returnDetails.resolution')}</dt>
                <dd>{RESOLUTIONS[entry.resolution] ? t(`returnDetails.resolutions.${entry.resolution}`) : entry.resolution}</dd>
              </div>
            )}
            {entry.refund && (
              <div>
                <dt>{t('returnDetails.refund')}</dt>
                <dd>
                  {formatBasePrice(entry.refund.total, entry.refund.currency)} ({entry.refund.number}
                  {entry.refund.createdAt && `, ${formatDate(entry.refund.createdAt)}`})
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="order-view__card" aria-labelledby="return-items-title">
          <h3 id="return-items-title">{t('returnDetails.items')}</h3>
          <ul className="order-items">
            {(entry.items ?? []).map((item, index) => (
              <li key={item.id ?? index} className="order-items__row">
                <span className="order-items__thumb">{item.thumbnail && <img src={item.thumbnail} alt="" width="56" height="56" loading="lazy" />}</span>
                <span className="order-items__title">
                  {item.title}
                  {item.variantLabel && <span className="order-items__variant">{item.variantLabel}</span>}
                  {item.condition && <span className="order-items__meta">{t('returnDetails.condition', { condition: CONDITIONS[item.condition] ? t(`returnDetails.conditions.${item.condition}`) : item.condition })}</span>}
                </span>
                <span className="order-items__total">× {formatNumber(item.quantity)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}

export default ReturnDetailsPage
