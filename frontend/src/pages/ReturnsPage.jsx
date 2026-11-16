import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuUndo2 } from 'react-icons/lu'
import OrderStatusBadge from '../components/orders/OrderStatusBadge'
import Pagination from '../components/common/Pagination'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { returnsQuery } from '../queries/customerQueries'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate } from '../utils/formatters'
import './OrderPages.css'

/**
 * /account/returns (REAL_SHOP): the customer's return requests, newest
 * first, a page at a time. New returns start from an order's page.
 */
function ReturnsPage() {
  const { user, authorizedRequest } = useAuth()
  const [params, setParams] = useSearchParams()
  const page = Math.max(Number.parseInt(params.get('page') ?? '1', 10) || 1, 1)
  const request = useQuery(returnsQuery(user.id, authorizedRequest, page))

  if (request.isPending) return <Loader label="Loading your returns…" />
  if (request.error) return <ErrorMessage title="We couldn't load your returns" titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />
  const { returns, lastPage } = request.data

  if (returns.length === 0 && page === 1) {
    return (
      <EmptyState icon={LuUndo2} titleAs="h2" title="No returns" message="To return something, open the order it came with and choose “Request a return”.">
        <Button to={ROUTES.orders}>Your orders</Button>
      </EmptyState>
    )
  }

  return (
    <section className="orders" aria-labelledby="returns-title" aria-busy={request.isFetching}>
      <title>{`Returns | ${SITE.name}`}</title>
      <h2 id="returns-title" className="orders__title">
        Returns
      </h2>
      <ul className="orders__list">
        {returns.map((entry) => {
          const count = entry.itemsCount
          return (
            <li key={entry.number} className="orders__item">
              <div className="orders__info">
                <Link to={ROUTES.returnDetails(entry.number)} className="orders__id">
                  Return {entry.number}
                </Link>
                <span className="orders__meta">
                  {entry.createdAt && `${formatDate(entry.createdAt)} · `}
                  {entry.orderNumber && `Order ${entry.orderNumber} · `}
                  {count} {count === 1 ? 'item' : 'items'}
                </span>
              </div>
              <OrderStatusBadge kind="return" status={entry.status} />
            </li>
          )
        })}
      </ul>
      <Pagination currentPage={page} pageCount={lastPage} onPageChange={(next) => setParams(next > 1 ? { page: String(next) } : {})} />
    </section>
  )
}

export default ReturnsPage
