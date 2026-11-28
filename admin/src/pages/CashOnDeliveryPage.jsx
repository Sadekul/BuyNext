import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuDownload, LuTriangleAlert } from 'react-icons/lu'
import { reportCsvUrl } from '../api/admin'
import { getCodReport, getOutstanding, phase21Keys } from '../api/phase21'
import { useAdminAuth } from '../auth/useAdminAuth'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import ReportRangeForm from '../components/ReportRangeForm'
import StatTile from '../components/StatTile'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { useReportRange } from '../hooks/useReportRange'
import { OLDER_THAN, PAYOUT_COURIERS, courierName } from '../utils/cash'
import { deliveryStatus } from '../utils/couriers'
import { formatCount, formatDate, formatMoney, formatMoneyCompact } from '../utils/format'
import { formatDay, zoneWords } from '../utils/reportRange'

const PAGE = 20

/**
 * Phase 21 §2: Reports → Cash on delivery. Where the cash of COD orders is:
 * with each courier (collected − fees − paid to you, all time), in the
 * period's parcels, and still with customers (shipped, not yet paid).
 * A courier's fees it never reported stay "not reported", never 0.
 * Needs reports.view; recording a payment needs cash.manage.
 */
function CashOnDeliveryPage() {
  const { range, zone, noteZone, apply } = useReportRange()
  const period = { from: range.from, to: range.to }
  const report = useQuery({ queryKey: phase21Keys.cod(period), queryFn: ({ signal }) => getCodReport(period, { signal }), placeholderData: keepPreviousData })
  const reportedZone = report.data?.range?.timezone
  useEffect(() => {
    if (reportedZone) noteZone(reportedZone)
  }, [reportedZone, noteZone])
  const data = report.data
  const currency = data?.currency ?? undefined
  const owedTotal = data ? data.balances.reduce((sum, row) => sum + Math.round(row.owed * 100), 0) / 100 : 0

  return (
    <>
      <title>Cash on delivery | BuyNest Admin</title>
      <PageHeader
        title="Cash on delivery"
        description={`Where the cash from cash-on-delivery orders is: with a courier, or still with the customer. Courier balances are all time; the period table uses dates in ${zoneWords(zone)}.`}
      />
      <ReportRangeForm key={`${range.from}|${range.to}`} range={range} onApply={apply} grouped={false} />

      {report.isPending && <Loading label="Loading cash on delivery…" />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {data && (
        <div aria-busy={report.isFetching}>
          <dl className="stats">
            <StatTile hero label="Still to collect" value={formatMoneyCompact(data.outstanding.amount, currency)} note={`${formatCount(data.outstanding.orders)} ${data.outstanding.orders === 1 ? 'order' : 'orders'} shipped, not yet paid`} />
            <StatTile label="Couriers owe you" value={formatMoneyCompact(owedTotal, currency)} note="All couriers, all time" />
            <StatTile label="Collected by staff" value={formatMoneyCompact(data.staff.collected, currency)} note="In this period" />
          </dl>

          <section className="panel panel--spaced" aria-labelledby="balances-title">
            <header className="panel__header">
              <h2 id="balances-title">Courier balances</h2>
              <a href={reportCsvUrl('cod', period)} className="btn btn--outline btn--sm" download>
                <LuDownload aria-hidden="true" /> Download balances CSV
              </a>
            </header>
            <p className="field__hint panel__note">Cash each courier collected for you, minus its fees and what it has paid you. All time, not only this period.</p>
            {data.balances.length === 0 ? (
              <Empty>No courier has collected cash for you yet.</Empty>
            ) : (
              <ul className="cash-cards">
                {data.balances.map((balance) => (
                  <BalanceCard key={balance.carrier} balance={balance} currency={currency} />
                ))}
              </ul>
            )}
          </section>

          <PeriodTable rows={data.period} currency={currency} />
        </div>
      )}

      <StillToCollect />
    </>
  )
}

/** One courier: what it owes you (or that it paid more than recorded), and how that adds up. */
function BalanceCard({ balance, currency }) {
  const name = courierName(balance.carrier, balance.label)
  const titleId = `balance-${balance.carrier}`
  // Below 0: payments recorded beyond the cash (check them), or, with none, fees beyond the cash (you owe the courier).
  const feesOwed = balance.owed < 0 && balance.note === 'fees_more_than_collected'
  const overpaid = !feesOwed && (balance.owed < 0 || balance.note === 'paid_more_than_recorded')
  return (
    <li className="cash-card">
      <h3 id={titleId} className="cash-card__title">
        {name}
      </h3>
      {feesOwed ? (
        <>
          <p className="cash-card__owed cash-card__owed--warning">
            <LuTriangleAlert aria-hidden="true" />
            <span>You owe {name} {formatMoney(Math.abs(balance.owed), currency)}</span>
          </p>
          <p className="cash-card__detail">
            {name}'s fees, returned parcels included, are more than the cash it collected for you. Settle the difference with {name}, or check for a collection that wasn't recorded.
          </p>
        </>
      ) : overpaid ? (
        <>
          <p className="cash-card__owed cash-card__owed--warning">
            <LuTriangleAlert aria-hidden="true" />
            <span>Paid more than recorded — check the payments</span>
          </p>
          <p className="cash-card__detail">
            {name} has paid you {formatMoney(Math.abs(balance.owed), currency)} more than the cash recorded for it. A payment may have been typed twice, or a collection is missing.
          </p>
        </>
      ) : (
        <p className="cash-card__owed">{balance.owed > 0 ? `${name} owes you ${formatMoney(balance.owed, currency)}` : `${name} owes you nothing`}</p>
      )}
      <dl className="cash-card__figures">
        <div>
          <dt>Collected</dt>
          <dd>{formatMoney(balance.collectedAllTime, currency)}</dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd>{balance.feesAllTime === null ? <span className="muted">Fees not reported</span> : formatMoney(balance.feesAllTime, currency)}</dd>
        </div>
        <div>
          <dt>Paid to you</dt>
          <dd>{formatMoney(balance.payoutsAllTime, currency)}</dd>
        </div>
        <div>
          <dt>Last payment</dt>
          <dd>{balance.lastPayoutOn ? formatDay(balance.lastPayoutOn) : 'None recorded yet'}</dd>
        </div>
      </dl>
      {balance.feesAllTime === null && (
        <p className="field__hint">{name} doesn't report its fees per parcel. Type them into the courier payment from its statement, or the balance stays before fees.</p>
      )}
      <Link to={`/reports/courier-payments?carrier=${balance.carrier}`} className="cash-card__link">
        See {name} payments
      </Link>
    </li>
  )
}

/** Per courier for the period: parcels and money. */
function PeriodTable({ rows, currency }) {
  return (
    <section className="panel panel--spaced" aria-labelledby="cod-period-title">
      <header className="panel__header">
        <h2 id="cod-period-title">In this period, by courier</h2>
      </header>
      {rows.length === 0 ? (
        <Empty>No cash-on-delivery parcels with a courier in this period.</Empty>
      ) : (
        <div className="table-wrap" role="region" aria-label="Parcels and money by courier" tabIndex={0}>
          <table className="table">
            <caption className="visually-hidden">Cash-on-delivery parcels and money per courier in this period</caption>
            <thead>
              <tr>
                <th scope="col">Courier</th>
                <th scope="col" className="num">
                  Shipped
                </th>
                <th scope="col" className="num">
                  Delivered
                </th>
                <th scope="col" className="num">
                  Returned
                </th>
                <th scope="col" className="num">
                  Cancelled
                </th>
                <th scope="col" className="num">
                  Collected
                </th>
                <th scope="col" className="num">
                  Fees
                </th>
                <th scope="col" className="num">
                  Paid to you
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.carrier}>
                  <th scope="row">{courierName(row.carrier, row.label)}</th>
                  <td className="num">{formatCount(row.shipped)}</td>
                  <td className="num">{formatCount(row.delivered)}</td>
                  <td className="num">{formatCount(row.returned)}</td>
                  <td className="num">{formatCount(row.cancelled)}</td>
                  <td className="num">{formatMoney(row.collected, currency)}</td>
                  <td className="num">{row.fees === null ? <span className="muted">Not reported</span> : formatMoney(row.fees, currency)}</td>
                  <td className="num">{formatMoney(row.payouts, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** COD orders shipped and not yet paid, oldest first, each linking to its order. Not tied to the period. */
function StillToCollect() {
  const { can } = useAdminAuth()
  const [filters, setFilters] = useState({ carrier: '', olderThanDays: '' })
  const [skip, setSkip] = useState(0)
  const params = { ...filters, limit: PAGE, skip }
  const list = useQuery({ queryKey: phase21Keys.outstanding(params), queryFn: ({ signal }) => getOutstanding(params, { signal }), placeholderData: keepPreviousData })
  const set = (key) => (event) => {
    setFilters({ ...filters, [key]: event.target.value })
    setSkip(0)
  }
  const csvFilters = Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
  const currency = list.data?.currency ?? undefined

  return (
    <section className="panel panel--spaced" aria-labelledby="outstanding-title" aria-busy={list.isFetching}>
      <header className="panel__header">
        <h2 id="outstanding-title">Still to collect</h2>
        <a href={reportCsvUrl('cod/outstanding', csvFilters)} className="btn btn--outline btn--sm" download>
          <LuDownload aria-hidden="true" /> Download list CSV
        </a>
      </header>
      <p className="field__hint panel__note">Cash-on-delivery orders that were shipped and are not paid yet, oldest first. Not limited to the period above.</p>
      <div className="toolbar cash-filters" role="group" aria-label="Filter the orders still to collect">
        <label className="toolbar__select">
          <span>Courier</span>
          <select value={filters.carrier} onChange={set('carrier')}>
            <option value="">All couriers</option>
            {PAYOUT_COURIERS.map((courier) => (
              <option key={courier.code} value={courier.code}>
                {courier.label}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__select">
          <span>Shipped</span>
          <select value={filters.olderThanDays} onChange={set('olderThanDays')}>
            {OLDER_THAN.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isPending && <Loading label="Loading orders to collect…" />}
      {list.error && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && list.data.orders.length === 0 && <Empty>{filters.carrier || filters.olderThanDays ? 'No orders to collect match these filters.' : 'Nothing left to collect: every shipped COD order is paid.'}</Empty>}
      {list.data && list.data.orders.length > 0 && (
        <div className="table-wrap" role="region" aria-label="Orders still to collect" tabIndex={0}>
          <table className="table">
            <caption className="visually-hidden">Cash-on-delivery orders still to collect, oldest first</caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Courier</th>
                <th scope="col">Delivery</th>
                <th scope="col">Shipped</th>
                <th scope="col" className="num">
                  Days
                </th>
                <th scope="col" className="num">
                  To collect
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.orders.map((order) => (
                <tr key={order.number}>
                  <th scope="row">{can('orders.view') ? <Link to={`/orders/${order.number}`}>{order.number}</Link> : order.number}</th>
                  <td>
                    {order.carrier ? courierName(order.carrier) : '—'}
                    {order.consignmentId && <small className="muted"> · {order.consignmentId}</small>}
                  </td>
                  <td>{order.deliveryStatus ? <StatusBadge {...deliveryStatus(order.deliveryStatus)} /> : <span className="muted">—</span>}</td>
                  <td>{formatDate(order.shippedAt)}</td>
                  <td className="num">{order.daysSinceShipped === null ? '—' : formatCount(order.daysSinceShipped)}</td>
                  <td className="num">{formatMoney(order.codDue, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={list.data.total} limit={PAGE} skip={skip} onChange={setSkip} />
        </div>
      )}
    </section>
  )
}

export default CashOnDeliveryPage
