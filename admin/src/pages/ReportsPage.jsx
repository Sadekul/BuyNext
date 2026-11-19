import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuDownload } from 'react-icons/lu'
import { adminKeys, getReport, reportCsvUrl } from '../api/admin'
import StatTile from '../components/StatTile'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatCountCompact, formatDate, formatMoney, formatMoneyCompact } from '../utils/format'
import Pagination from '../components/Pagination'
// Phase 11 §1 and §4.
import { formatPoints } from '../utils/rewards'

const GROUPS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]
const MAX_DAYS = 366
const DAY_MS = 86_400_000

// Dates are the store's (UTC for now, contract §4): YYYY-MM-DD in UTC.
const isoDay = (date) => date.toISOString().slice(0, 10)
function defaultRange() {
  const today = new Date()
  return { from: isoDay(new Date(today.getTime() - 29 * DAY_MS)), to: isoDay(today) }
}
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
/** "2026-11-10" → "Nov 10" (day), "Week of Nov 10" (week), "Nov 2026" (month). */
function periodLabel(period, groupBy) {
  const date = new Date(period.length === 7 ? `${period}-01T00:00:00Z` : `${period}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return period
  if (groupBy === 'month') return monthFormat.format(date)
  return groupBy === 'week' ? `Week of ${dayFormat.format(date)}` : dayFormat.format(date)
}

/** Reports: sales over a date range, best sellers, customers, coupons, low stock. Needs reports.view. */
function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const fallback = defaultRange()
  const range = {
    from: params.get('from') ?? fallback.from,
    to: params.get('to') ?? fallback.to,
    groupBy: GROUPS.some((group) => group.value === params.get('groupBy')) ? params.get('groupBy') : 'day',
  }
  const [draft, setDraft] = useState(range)
  const [problem, setProblem] = useState(null)

  function apply(event) {
    event.preventDefault()
    const days = (Date.parse(draft.to) - Date.parse(draft.from)) / DAY_MS
    if (!draft.from || !draft.to || Number.isNaN(days)) return setProblem('Choose both dates.')
    if (days < 0) return setProblem('The start date must be on or before the end date.')
    if (days >= MAX_DAYS) return setProblem(`Choose at most ${MAX_DAYS} days.`)
    setProblem(null)
    setParams(draft)
  }

  return (
    <>
      <title>Reports | BuyNest Admin</title>
      <PageHeader title="Reports" description="Orders that weren't cancelled, in UTC dates. Net is after discounts and refunds." />

      <form className="toolbar" aria-label="Report period" noValidate onSubmit={apply}>
        <label className="toolbar__select">
          <span>From</span>
          <input type="date" value={draft.from} max={draft.to} required onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label className="toolbar__select">
          <span>To</span>
          <input type="date" value={draft.to} min={draft.from} required onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </label>
        <label className="toolbar__select">
          <span>Group by</span>
          <select value={draft.groupBy} onChange={(event) => setDraft({ ...draft, groupBy: event.target.value })}>
            {GROUPS.map((group) => (
              <option key={group.value} value={group.value}>
                {group.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn--outline">
          Show
        </button>
      </form>
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}

      <SalesReport range={range} />
      <div className="panels">
        <BestSellers range={range} />
        <CustomersReport range={range} />
      </div>
      <div className="panels">
        <CouponsReport range={range} />
        <LowStockReport />
      </div>
      {/* Phase 11 §1 and §4: wishlists and reward points, for the same period. */}
      <div className="panels">
        <WishlistReport range={range} />
        <RewardPointsReport range={range} />
      </div>
      {/* Phase 9 §7. */}
      <StockAlertsReport />
    </>
  )
}

function useReport(name, params) {
  return useQuery({ queryKey: adminKeys.report(name, params), queryFn: ({ signal }) => getReport(name, params, { signal }), placeholderData: keepPreviousData })
}

function CsvLink({ name, range, label }) {
  return (
    <a href={reportCsvUrl(name, range)} className="btn btn--outline btn--sm" download>
      <LuDownload aria-hidden="true" /> {label}
    </a>
  )
}

function SalesReport({ range }) {
  const sales = useReport('sales', range)
  if (sales.isPending) return <Loading label="Loading sales…" />
  if (sales.error) return <ErrorState error={sales.error} onRetry={sales.refetch} />
  const { totals, series } = sales.data
  // Phase 12 §5: the totals are in the store currency only; orders in other currencies are listed on their own, never added in.
  const currency = sales.data.currency ?? undefined
  const others = sales.data.otherCurrencies ?? []
  return (
    <section aria-labelledby="sales-title" aria-busy={sales.isFetching}>
      <header className="panel__header report__header">
        <h2 id="sales-title">Sales</h2>
        <CsvLink name="sales" range={range} label="Download sales CSV" />
      </header>
      {/* One hero number, then the parts it's made of. No deltas: there is no comparison period. */}
      <dl className="stats">
        <StatTile
          hero
          label="Net revenue"
          value={formatMoneyCompact(totals.net, currency)}
          note={`${formatCount(totals.orders)} orders · after discounts and refunds${others.length > 0 ? ` · ${currency ?? 'store currency'} orders only` : ''}`}
        />
        <StatTile label="Gross sales" value={formatMoneyCompact(totals.gross, currency)} />
        <StatTile label="Discounts" value={formatMoneyCompact(totals.discounts, currency)} />
        <StatTile label="Refunds" value={formatMoneyCompact(totals.refunds, currency)} />
        <StatTile label="Shipping" value={formatMoneyCompact(totals.shipping, currency)} />
        <StatTile label="Average order" value={formatMoney(totals.averageOrder, currency)} />
        <StatTile label="Units sold" value={formatCount(totals.units)} />
      </dl>
      {others.length > 0 && <OtherCurrencies rows={others} currency={currency} />}
      <section className="panel panel--spaced" aria-labelledby="net-chart-title">
        <header className="panel__header">
          <h3 id="net-chart-title">Net revenue by {range.groupBy}</h3>
        </header>
        {series.length === 0 ? <Empty>No sales in this period.</Empty> : <NetChart series={series} groupBy={range.groupBy} />}
      </section>
    </section>
  )
}

/** Phase 12 §5: orders of the period in other currencies (placed before the store switched), per currency. */
function OtherCurrencies({ rows, currency }) {
  return (
    <section className="panel panel--spaced" aria-labelledby="other-currencies-title">
      <header className="panel__header">
        <h3 id="other-currencies-title">Orders in other currencies</h3>
      </header>
      <p className="field__hint panel__note">
        Not in the totals above{currency ? ` (${currency})` : ''}: amounts in different currencies are never added together.
      </p>
      <div className="table-wrap" role="region" aria-label="Amounts by currency" tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col" className="num">
                Orders
              </th>
              <th scope="col" className="num">
                Gross
              </th>
              <th scope="col" className="num">
                Refunds
              </th>
              <th scope="col" className="num">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.currency}>
                <th scope="row">{row.currency}</th>
                <td className="num">{formatCount(row.orders)}</td>
                <td className="num">{formatMoney(row.gross, row.currency)}</td>
                <td className="num">{formatMoney(row.refunds, row.currency)}</td>
                <td className="num">{formatMoney(row.net, row.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * One series (net revenue per period) as columns from a shared zero line;
 * refunds can make a period negative, so it grows down. Single series: no
 * legend, the heading names it. The summary is the chart's text alternative,
 * and the table has every value (hover only adds a quick readout).
 */
function NetChart({ series, groupBy }) {
  const max = Math.max(0, ...series.map((point) => point.net))
  const min = Math.min(0, ...series.map((point) => point.net))
  const span = max - min || 1
  const zero = (-min / span) * 100 // the zero line, % from the bottom
  const best = series.reduce((top, point) => (point.net > top.net ? point : top), series[0])
  const total = series.reduce((sum, point) => sum + Math.round(point.net * 100), 0) / 100
  const summary = `${series.length} ${groupBy}s from ${periodLabel(series[0].period, groupBy)} to ${periodLabel(series.at(-1).period, groupBy)}. Total ${formatMoney(total)}; highest ${formatMoney(best.net)} (${periodLabel(best.period, groupBy)}).`
  // Selective axis labels: first, middle, last, so they never collide.
  const labelled = new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])

  return (
    <div className="chart">
      <p id="net-chart-summary" className="chart__summary">
        {summary}
      </p>
      <figure className="chart__figure" role="img" aria-labelledby="net-chart-title" aria-describedby="net-chart-summary">
        <div className="chart__axis" aria-hidden="true">
          <span>{formatMoneyCompact(max)}</span>
          {min < 0 && <span>{formatMoneyCompact(min)}</span>}
        </div>
        <div className="chart__plot" aria-hidden="true">
          <span className="chart__zero" style={{ bottom: `${zero}%` }} />
          {series.map((point) => {
            const height = (Math.abs(point.net) / span) * 100
            const negative = point.net < 0
            return (
              <div key={point.period} className="chart__slot">
                <span
                  className={`chart__bar${negative ? ' chart__bar--negative' : ''}`}
                  style={negative ? { top: `${100 - zero}%`, height: `${height}%` } : { bottom: `${zero}%`, height: `${height}%` }}
                />
                <span className="chart__tip">
                  <strong>{formatMoney(point.net)}</strong> {periodLabel(point.period, groupBy)} · {formatCount(point.orders)} orders
                </span>
              </div>
            )
          })}
        </div>
        <div className="chart__labels" aria-hidden="true">
          {series.map((point, index) => (
            <span key={point.period}>{labelled.has(index) ? periodLabel(point.period, groupBy) : ''}</span>
          ))}
        </div>
      </figure>
      <details className="chart__table">
        <summary>Show the numbers as a table</summary>
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Sales by {groupBy}</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col" className="num">
                  Orders
                </th>
                <th scope="col" className="num">
                  Gross
                </th>
                <th scope="col" className="num">
                  Refunds
                </th>
                <th scope="col" className="num">
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.period}>
                  <th scope="row">{periodLabel(point.period, groupBy)}</th>
                  <td className="num">{formatCount(point.orders)}</td>
                  <td className="num">{formatMoney(point.gross)}</td>
                  <td className="num">{formatMoney(point.refunds)}</td>
                  <td className="num">{formatMoney(point.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function BestSellers({ range }) {
  const report = useReport('products', { from: range.from, to: range.to, limit: 10 })
  return (
    <section className="panel" aria-labelledby="best-title" tabIndex={0}>
      <header className="panel__header">
        <h2 id="best-title">Best sellers</h2>
        <CsvLink name="products" range={{ from: range.from, to: range.to }} label="Download CSV" />
      </header>
      {report.isPending && <Loading />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {report.data && report.data.products.length === 0 && <Empty>No products sold in this period.</Empty>}
      {report.data && report.data.products.length > 0 && (
        <table className="table">
          <caption className="visually-hidden">Best-selling products by units</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="num">
                Units
              </th>
              <th scope="col" className="num">
                Revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {report.data.products.map((row) => (
              <tr key={row.productId ?? row.sku ?? row.name}>
                <th scope="row">
                  {row.productId ? <Link to={`/products/${row.productId}`}>{row.name}</Link> : row.name}
                  {row.sku && <small className="muted"> · {row.sku}</small>}
                </th>
                <td className="num">{formatCount(row.units)}</td>
                <td className="num">{formatMoney(row.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function CustomersReport({ range }) {
  const report = useReport('customers', { from: range.from, to: range.to })
  return (
    <section className="panel" aria-labelledby="customers-report-title" tabIndex={0}>
      <header className="panel__header">
        <h2 id="customers-report-title">Customers</h2>
      </header>
      {report.isPending && <Loading />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {report.data && (
        <>
          <dl className="stats stats--compact">
            <StatTile label="New customers" value={formatCount(report.data.newCustomers)} />
            <StatTile label="Returning customers" value={formatCount(report.data.returningCustomers)} />
            <StatTile label="Guest orders" value={formatCount(report.data.guestOrders)} />
          </dl>
          {report.data.topCustomers.length === 0 ? (
            <Empty>No customer orders in this period.</Empty>
          ) : (
            <table className="table">
              <caption className="visually-hidden">Top customers by amount spent</caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col" className="num">
                    Orders
                  </th>
                  <th scope="col" className="num">
                    Spent
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.data.topCustomers.map((row) => (
                  <tr key={row.id ?? row.email}>
                    <th scope="row">
                      {row.name || row.email}
                      {row.name && <small className="muted"> · {row.email}</small>}
                    </th>
                    <td className="num">{formatCount(row.orders)}</td>
                    <td className="num">{formatMoney(row.spent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}

function CouponsReport({ range }) {
  const report = useReport('coupons', { from: range.from, to: range.to })
  return (
    <section className="panel" aria-labelledby="coupons-report-title" tabIndex={0}>
      <header className="panel__header">
        <h2 id="coupons-report-title">Coupons used</h2>
      </header>
      {report.isPending && <Loading />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {report.data && report.data.coupons.length === 0 && <Empty>No coupons used in this period.</Empty>}
      {report.data && report.data.coupons.length > 0 && (
        <table className="table">
          <caption className="visually-hidden">Coupon use</caption>
          <thead>
            <tr>
              <th scope="col">Code or rule</th>
              <th scope="col" className="num">
                Uses
              </th>
              <th scope="col" className="num">
                Discount given
              </th>
            </tr>
          </thead>
          <tbody>
            {report.data.coupons.map((row) => (
              <tr key={row.couponId ?? row.code}>
                <th scope="row">
                  {/* Phase 7 (marketing): an automatic rule has no code, so it goes by its name. */}
                  {row.automatic || !row.code ? (
                    <>
                      {row.name} <small className="muted">(automatic)</small>
                    </>
                  ) : (
                    <code>{row.code}</code>
                  )}
                </th>
                <td className="num">{formatCount(row.uses)}</td>
                <td className="num">{formatMoney(row.discountTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** Not tied to the date range: stock right now. */
function LowStockReport() {
  const report = useReport('low-stock', {})
  return (
    <section className="panel" aria-labelledby="low-stock-title" tabIndex={0}>
      <header className="panel__header">
        <h2 id="low-stock-title">Low stock now</h2>
      </header>
      {report.isPending && <Loading />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {report.data && report.data.products.length === 0 && <Empty>Nothing is below the low-stock threshold.</Empty>}
      {report.data && report.data.products.length > 0 && (
        <table className="table">
          <caption className="visually-hidden">Products below the low-stock threshold, lowest first</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Stock</th>
            </tr>
          </thead>
          <tbody>
            {report.data.products.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <Link to={`/products/${row.id}`}>{row.title}</Link>
                  {row.sku && <small className="muted"> · {row.sku}</small>}
                </th>
                <td>
                  {/* Everything here is below the store's threshold (Settings), whatever it is. */}
                  <StatusBadge {...(row.stock <= 0 ? { tone: 'danger', label: 'Out of stock' } : { tone: 'warning', label: 'Low stock' })} /> <span className="muted">{formatCount(row.stock)} left</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

const ALERTS_PAGE = 10

/**
 * Stock alerts (phase 9 §7): sold-out products that shoppers asked to be
 * emailed about, most waiting first. Not tied to the date range. Each alert
 * is emailed once, automatically, when the product can be ordered again.
 */
function StockAlertsReport() {
  const [skip, setSkip] = useState(0)
  const report = useReport('stock-alerts', { limit: ALERTS_PAGE, skip })
  const data = report.data
  // An API without stock alerts (before phase 9): no panel.
  if (report.error?.status === 404) return null
  return (
    <section id="stock-alerts" className="panel panel--spaced" aria-labelledby="stock-alerts-title" aria-busy={report.isFetching}>
      <header className="panel__header">
        <h2 id="stock-alerts-title">Stock alerts</h2>
      </header>
      {report.isPending && <Loading label="Loading stock alerts…" />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {data && (
        <p className="muted stock-alerts__summary">
          {formatCount(data.waitingTotal)} {data.waitingTotal === 1 ? 'shopper is' : 'shoppers are'} waiting for a back-in-stock email
          {data.total > 0 && ` on ${formatCount(data.total)} ${data.total === 1 ? 'product' : 'products'}`}. {formatCount(data.notifiedLast30Days)} emailed in the
          last 30 days.
        </p>
      )}
      {data && data.products.length === 0 && <Empty>Nobody is waiting for a sold-out product.</Empty>}
      {data && data.products.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Products with shoppers waiting for a back-in-stock email, most waiting first</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Stock</th>
                <th scope="col" className="table__number">
                  Waiting
                </th>
                <th scope="col">First asked</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((row) => (
                <tr key={row.productId}>
                  <th scope="row">
                    <Link to={`/products/${row.productId}`}>{row.name}</Link>
                    {row.sku && <small className="muted"> · {row.sku}</small>}
                    {row.variants.length > 0 && (
                      <ul className="stock-alerts__variants">
                        {row.variants.map((variant) => (
                          <li key={variant.id}>
                            {variant.label || variant.sku}: {formatCount(variant.waiting)} waiting, {formatCount(variant.stock)} in stock
                          </li>
                        ))}
                      </ul>
                    )}
                  </th>
                  <td>
                    <StatusBadge stock={row.stock} />
                  </td>
                  <td className="table__number">{formatCount(row.waiting)}</td>
                  <td>{formatDate(row.oldestAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={data.total} limit={ALERTS_PAGE} skip={skip} onChange={setSkip} />
        </div>
      )}
    </section>
  )
}

/** Phase 11 §1: the products most customers saved to their wishlist in the period. */
function WishlistReport({ range }) {
  const report = useReport('wishlist', { from: range.from, to: range.to, limit: 10 })
  // An API without wishlists (before phase 11): no panel.
  if (report.error?.status === 404) return null
  return (
    <section className="panel" aria-labelledby="wishlist-report-title" aria-busy={report.isFetching} tabIndex={0}>
      <header className="panel__header">
        <h2 id="wishlist-report-title">Most wished-for products</h2>
      </header>
      {report.isPending && <Loading />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {report.data && report.data.products.length === 0 && <Empty>No products were saved to a wishlist in this period.</Empty>}
      {report.data && report.data.products.length > 0 && (
        <table className="table">
          <caption className="visually-hidden">Products saved to the most wishlists in this period</caption>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="num">
                Customers
              </th>
              <th scope="col">In stock?</th>
            </tr>
          </thead>
          <tbody>
            {report.data.products.map((row) => (
              <tr key={row.productId ?? row.sku ?? row.name}>
                <th scope="row">
                  {row.productId ? <Link to={`/products/${row.productId}`}>{row.name}</Link> : row.name}
                  {row.sku && <small className="muted"> · {row.sku}</small>}
                </th>
                <td className="num">{formatCount(row.customers)}</td>
                <td>{row.inStock === null ? '—' : <StatusBadge {...(row.inStock ? { tone: 'success', label: 'In stock' } : { tone: 'danger', label: 'Out of stock' })} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** Phase 11 §4: points issued and spent in the period, and what customers hold now (the store's liability). */
function RewardPointsReport({ range }) {
  const report = useReport('rewards', range)
  if (report.error?.status === 404) return null
  const data = report.data
  return (
    <section className="panel" aria-labelledby="rewards-report-title" aria-busy={report.isFetching} tabIndex={0}>
      <header className="panel__header">
        <h2 id="rewards-report-title">Reward points</h2>
      </header>
      {report.isPending && <Loading />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {data && (
        <>
          <dl className="stats stats--compact">
            <StatTile label="Issued" value={formatCountCompact(data.totals.issued)} note="Earned, sign-up and review bonuses" />
            <StatTile label="Spent" value={formatCountCompact(data.totals.spent)} note={`${formatCount(data.totals.returned)} returned by cancels and refunds`} />
            <StatTile
              label="Outstanding liability"
              value={formatMoneyCompact(data.outstandingValue)}
              note={`${formatPoints(data.outstandingPoints)} held by customers now${data.pointValue ? ` at ${formatMoney(data.pointValue)} each` : ''}`}
            />
          </dl>
          <p className="muted page-note">
            {formatPoints(data.totals.reversed)} taken back by refunds; staff adjustments {data.totals.adjusted < 0 ? '−' : '+'}
            {formatCount(Math.abs(data.totals.adjusted))} in this period.
          </p>
          {data.series.length === 0 ? (
            <Empty>No points issued or spent in this period.</Empty>
          ) : (
            <table className="table">
              <caption className="visually-hidden">Reward points by {range.groupBy}</caption>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col" className="num">
                    Issued
                  </th>
                  <th scope="col" className="num">
                    Spent
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((point) => (
                  <tr key={point.period}>
                    <th scope="row">{periodLabel(point.period, range.groupBy)}</th>
                    <td className="num">{formatCount(point.issued)}</td>
                    <td className="num">{formatCount(point.spent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}

export default ReportsPage
