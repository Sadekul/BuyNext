import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuDownload } from 'react-icons/lu'
import { adminKeys, getReport, reportCsvUrl } from '../api/admin'
import StatTile from '../components/StatTile'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { Empty, ErrorState, Loading } from '../components/States'
import { formatCount, formatMoney, formatMoneyCompact } from '../utils/format'

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
  return (
    <section aria-labelledby="sales-title" aria-busy={sales.isFetching}>
      <header className="panel__header report__header">
        <h2 id="sales-title">Sales</h2>
        <CsvLink name="sales" range={range} label="Download sales CSV" />
      </header>
      {/* One hero number, then the parts it's made of. No deltas: there is no comparison period. */}
      <dl className="stats">
        <StatTile hero label="Net revenue" value={formatMoneyCompact(totals.net)} note={`${formatCount(totals.orders)} orders · after discounts and refunds`} />
        <StatTile label="Gross sales" value={formatMoneyCompact(totals.gross)} />
        <StatTile label="Discounts" value={formatMoneyCompact(totals.discounts)} />
        <StatTile label="Refunds" value={formatMoneyCompact(totals.refunds)} />
        <StatTile label="Shipping" value={formatMoneyCompact(totals.shipping)} />
        <StatTile label="Average order" value={formatMoney(totals.averageOrder)} />
        <StatTile label="Units sold" value={formatCount(totals.units)} />
      </dl>
      <section className="panel panel--spaced" aria-labelledby="net-chart-title">
        <header className="panel__header">
          <h3 id="net-chart-title">Net revenue by {range.groupBy}</h3>
        </header>
        {series.length === 0 ? <Empty>No sales in this period.</Empty> : <NetChart series={series} groupBy={range.groupBy} />}
      </section>
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
    <section className="panel" aria-labelledby="best-title">
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
    <section className="panel" aria-labelledby="customers-report-title">
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
    <section className="panel" aria-labelledby="coupons-report-title">
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
    <section className="panel" aria-labelledby="low-stock-title">
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

export default ReportsPage
