import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LuCoins } from 'react-icons/lu'
import Pagination from '../components/common/Pagination'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ErrorMessage from '../components/ui/ErrorMessage'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { rewardsQuery } from '../queries/customerQueries'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { formatBasePrice, formatDate } from '../utils/formatters'
import { REWARD_TYPE_LABELS, formatPoints } from '../utils/rewards'
import './OrderPages.css'
import './RewardsPage.css'

/**
 * /account/rewards (phase 11 §4, REAL_SHOP): the reward points balance, what
 * it is worth at checkout, and its history (earned on paid orders, used,
 * returned, bonuses, adjustments). Points are worth money only at this
 * store's checkout, so their value is shown in the store's own currency.
 */
function RewardsPage() {
  const { user, authorizedRequest } = useAuth()
  const { settings } = useStoreSettings()
  const [page, setPage] = useState(1)
  const request = useQuery(rewardsQuery(user.id, authorizedRequest, page))

  if (request.isPending) return <Loader label="Loading your reward points…" />
  if (request.error) {
    return <ErrorMessage title="We couldn't load your reward points" titleAs="h2" message={request.error.message} onRetry={() => request.refetch()} />
  }

  const { balance, value, transactions, lastPage } = request.data
  const rewards = settings.rewards
  return (
    <section className="orders rewards" aria-labelledby="rewards-title">
      <title>{`Reward points | ${SITE.name}`}</title>
      <h2 id="rewards-title" className="orders__title">
        Reward points
      </h2>

      <div className="rewards__balance">
        <LuCoins aria-hidden="true" className="rewards__icon" />
        <p>
          <span className="rewards__points">{formatPoints(balance)}</span>
          <span className="rewards__value">Worth {formatBasePrice(value)} at checkout</span>
        </p>
      </div>
      {rewards && (
        <p className="orders__note">
          {rewards.earnRate > 0 && `You earn ${formatPoints(rewards.earnRate)} for every ${formatBasePrice(1)} you spend, once your order is paid. `}
          {rewards.minRedeem > 0 ? `Use them at checkout once you have at least ${formatPoints(rewards.minRedeem)}.` : 'Use them at checkout.'}
        </p>
      )}

      <h3 className="rewards__subtitle">History</h3>
      {transactions.length === 0 ? (
        <EmptyState icon={LuCoins} titleAs="h4" title="No points yet" message="Points you earn on paid orders and bonuses show up here.">
          <Button to={ROUTES.products}>Start shopping</Button>
        </EmptyState>
      ) : (
        <div className="rewards__table-wrap" role="region" aria-labelledby="rewards-history-caption" tabIndex={0}>
          <table className="rewards__table">
            <caption id="rewards-history-caption" className="visually-hidden">
              Reward points history, newest first
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What happened</th>
                <th scope="col" className="rewards__num">
                  Points
                </th>
                <th scope="col" className="rewards__num">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.createdAt ? formatDate(entry.createdAt) : '—'}</td>
                  <td>
                    {REWARD_TYPE_LABELS[entry.type] ?? 'Points changed'}
                    {entry.orderNumber && (
                      <>
                        {' '}
                        (<Link to={ROUTES.orderDetails(entry.orderNumber)}>{entry.orderNumber}</Link>)
                      </>
                    )}
                    {entry.note && <span className="rewards__note">{entry.note}</span>}
                  </td>
                  <td className={entry.points < 0 ? 'rewards__num rewards__num--minus' : 'rewards__num rewards__num--plus'}>
                    {entry.points > 0 ? '+' : entry.points < 0 ? '−' : ''}
                    {Math.abs(entry.points).toLocaleString('en-US')}
                  </td>
                  <td className="rewards__num">{entry.balanceAfter.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination currentPage={page} pageCount={lastPage} onPageChange={setPage} />
    </section>
  )
}

export default RewardsPage
