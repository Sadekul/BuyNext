import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuBell, LuTrash2 } from 'react-icons/lu'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { customerKeys, stockAlertsQuery } from '../queries/customerQueries'
import { deleteStockAlert } from '../services/accountService'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatDate } from '../utils/formatters'
import './OrderPages.css'
import './StockAlertsPage.css'

const alertName = (alert) => (alert.variantLabel ? `${alert.title} (${alert.variantLabel})` : alert.title)

/**
 * /account/stock-alerts (REAL_SHOP, phase 9): the products the customer asked
 * to hear about ("Email me when it's back"). Each alert sends one email when
 * the product (or the chosen variant) is back, then it's done.
 */
function StockAlertsPage() {
  const { user, authorizedRequest } = useAuth()
  const queryClient = useQueryClient()
  const request = useQuery(stockAlertsQuery(user.id, authorizedRequest))
  const [message, setMessage] = useState('')
  const key = customerKeys.stockAlerts(user.id)

  const remove = useMutation({
    mutationFn: (alert) => authorizedRequest(() => deleteStockAlert(alert.id)),
    onSuccess: (_, alert) => {
      queryClient.setQueryData(key, (current) => current?.filter((entry) => entry.id !== alert.id))
      setMessage(`You won't get an email about ${alertName(alert)}.`)
    },
    onError: (error) => setMessage(`Couldn't remove the alert: ${error.message}`),
  })

  if (request.isPending) return <Loader label="Loading your stock alerts…" />
  if (request.error) {
    return <ErrorMessage title="We couldn't load your stock alerts" titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />
  }

  const alerts = request.data
  return (
    <section className="orders stock-alerts" aria-labelledby="stock-alerts-title">
      <title>{`Stock alerts | ${SITE.name}`}</title>
      <h2 id="stock-alerts-title" className="orders__title">
        Stock alerts
      </h2>
      <p className="stock-alerts__note">The sold-out products you're waiting for. We email you once when one is back, and the alert is then done.</p>
      <p className="stock-alerts__status" role="status">
        {message}
      </p>

      {alerts.length === 0 ? (
        <EmptyState
          icon={LuBell}
          titleAs="h3"
          title="No stock alerts"
          message="On a sold-out product, choose “Email me when it's back” and we'll let you know when it returns."
        >
          <Button to={ROUTES.products}>Browse products</Button>
        </EmptyState>
      ) : (
        <ul className="orders__list">
          {alerts.map((alert) => (
            <li key={alert.id} className="orders__item stock-alerts__item">
              {alert.thumbnail ? <img className="stock-alerts__thumb" src={alert.thumbnail} alt="" width="56" height="56" loading="lazy" /> : <span />}
              <div className="orders__info">
                {alert.productId ? (
                  <Link to={ROUTES.productDetails(alert.productId)} className="orders__id">
                    {alert.title}
                  </Link>
                ) : (
                  <span className="orders__id">{alert.title}</span>
                )}
                <span className="orders__meta">
                  {[alert.variantLabel, alert.createdAt && `Asked ${formatDate(alert.createdAt)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove.mutate(alert)}
                disabled={remove.isPending && remove.variables?.id === alert.id}
                aria-label={`Remove the alert for ${alertName(alert)}`}
              >
                <LuTrash2 aria-hidden="true" /> Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default StockAlertsPage
