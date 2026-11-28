import { useEffect } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LuDownload } from 'react-icons/lu'
import { reportCsvUrl } from '../api/admin'
import { getPaymentsReport, phase21Keys } from '../api/phase21'
import PageHeader from '../components/PageHeader'
import ReportRangeForm from '../components/ReportRangeForm'
import { StackedChart } from '../components/ReportCharts'
import StatTile from '../components/StatTile'
import { Empty, ErrorState, Loading } from '../components/States'
import { useReportRange } from '../hooks/useReportRange'
import { formatCount, formatMoney, formatMoneyCompact } from '../utils/format'
import { periodLabel, zoneWords } from '../utils/reportRange'

const plural = { day: 'days', week: 'weeks', month: 'months' }

/**
 * Phase 21 §2: Reports → Money in. What actually arrived, by the day it
 * arrived (not the day the order was placed): online payments per provider,
 * cash couriers and staff collected, and refunds paid back. Store currency
 * only; other currencies are listed on their own. Needs reports.view.
 */
function MoneyInPage() {
  const { range, zone, noteZone, apply } = useReportRange()
  const report = useQuery({ queryKey: phase21Keys.payments(range), queryFn: ({ signal }) => getPaymentsReport(range, { signal }), placeholderData: keepPreviousData })
  const reportedZone = report.data?.range?.timezone
  useEffect(() => {
    if (reportedZone) noteZone(reportedZone)
  }, [reportedZone, noteZone])
  const data = report.data
  const currency = data?.currency ?? undefined

  return (
    <>
      <title>Money in | BuyNest Admin</title>
      <PageHeader title="Money in" description={`Payments received, by the day the money arrived. Dates in ${zoneWords(zone)}. Refunds are money paid back to customers.`} />
      <ReportRangeForm key={`${range.from}|${range.to}|${range.groupBy}`} range={range} onApply={apply} />

      {report.isPending && <Loading label="Loading money in…" />}
      {report.error && <ErrorState error={report.error} onRetry={report.refetch} />}
      {data && (
        <section aria-labelledby="money-in-title" aria-busy={report.isFetching}>
          <header className="panel__header report__header">
            <h2 id="money-in-title">Received in this period</h2>
            <a href={reportCsvUrl('payments', range)} className="btn btn--outline btn--sm" download>
              <LuDownload aria-hidden="true" /> Download money-in CSV
            </a>
          </header>
          <dl className="stats">
            <StatTile hero label="Net received" value={formatMoneyCompact(data.totals.netReceived, currency)} note={`Received minus refunds${currency ? ` · ${currency} only` : ''}`} />
            <StatTile label="Received" value={formatMoneyCompact(data.totals.received, currency)} note={data.totals.other > 0 ? `Includes ${formatMoney(data.totals.other, currency)} other` : undefined} />
            <StatTile label="Online" value={formatMoneyCompact(data.totals.online, currency)} />
            <StatTile label="Cash on delivery" value={formatMoneyCompact(data.totals.codCash, currency)} note="Collected by couriers and staff" />
            <StatTile label="Refunds" value={formatMoneyCompact(data.totals.refunds, currency)} />
          </dl>

          {data.otherCurrencies.length > 0 && <OtherCurrencies rows={data.otherCurrencies} currency={currency} />}

          <section className="panel panel--spaced" aria-labelledby="money-chart-title">
            <header className="panel__header">
              <h3 id="money-chart-title">Money received by {range.groupBy}</h3>
            </header>
            {data.series.length === 0 ? <Empty>No money came in during this period.</Empty> : <MoneyChart data={data} groupBy={range.groupBy} currency={currency} />}
          </section>

          <section className="panel panel--spaced" aria-labelledby="channels-title">
            <header className="panel__header">
              <h3 id="channels-title">By channel</h3>
            </header>
            {data.channels.length === 0 ? (
              <Empty>No money came in during this period.</Empty>
            ) : (
              <div className="table-wrap" role="region" aria-label="Amounts by channel" tabIndex={0}>
                <table className="table">
                  <caption className="visually-hidden">Money received by channel</caption>
                  <thead>
                    <tr>
                      <th scope="col">Channel</th>
                      <th scope="col" className="num">
                        Payments
                      </th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                      <th scope="col" className="num">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.channels.map((row) => (
                      <tr key={row.channel}>
                        <th scope="row">{row.label}</th>
                        <td className="num">{formatCount(row.count)}</td>
                        <td className="num">{formatMoney(row.amount, currency)}</td>
                        <td className="num">{data.totals.received > 0 ? `${Math.round((row.amount / data.totals.received) * 100)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Received</th>
                      <td className="num">{formatCount(data.channels.reduce((sum, row) => sum + row.count, 0))}</td>
                      <td className="num">{formatMoney(data.totals.received, currency)}</td>
                      <td className="num" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </section>
      )}
    </>
  )
}

/** The stacked chart (online / cash on delivery / other), its summary, and every figure as a table. */
function MoneyChart({ data, groupBy, currency }) {
  const { series, totals } = data
  const total = (point) => point.online + point.codCash + point.other
  const busiest = series.reduce((top, point) => (total(point) > total(top) ? point : top), series[0])
  const summary =
    `${series.length} ${series.length === 1 ? groupBy : plural[groupBy]} from ${periodLabel(series[0].period, groupBy)} to ${periodLabel(series.at(-1).period, groupBy)}. ` +
    `Received ${formatMoney(totals.received, currency)}: online ${formatMoney(totals.online, currency)}, cash on delivery ${formatMoney(totals.codCash, currency)}, other ${formatMoney(totals.other, currency)}. ` +
    `Refunds paid ${formatMoney(totals.refunds, currency)}.` +
    (total(busiest) > 0 ? ` Most received: ${periodLabel(busiest.period, groupBy)} (${formatMoney(total(busiest), currency)}).` : '') +
    (currency ? ` Amounts in ${currency}.` : '')
  return (
    <>
      <StackedChart series={series} groupBy={groupBy} titleId="money-chart-title" summaryId="money-chart-summary" summary={summary} currency={currency} />
      <div className="chart">
        <details className="chart__table">
          <summary>Show the numbers as a table</summary>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Money received by {groupBy}</caption>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col" className="num">
                    Online
                  </th>
                  <th scope="col" className="num">
                    Cash on delivery
                  </th>
                  <th scope="col" className="num">
                    Other
                  </th>
                  <th scope="col" className="num">
                    Refunds
                  </th>
                  <th scope="col" className="num">
                    Net received
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr key={point.period}>
                    <th scope="row">{periodLabel(point.period, groupBy)}</th>
                    <td className="num">{formatMoney(point.online, currency)}</td>
                    <td className="num">{formatMoney(point.codCash, currency)}</td>
                    <td className="num">{formatMoney(point.other, currency)}</td>
                    <td className="num">{formatMoney(point.refunds, currency)}</td>
                    <td className="num">{formatMoney(point.netReceived, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </>
  )
}

/** Money received in other currencies (orders placed before the store switched): never added to the totals. */
function OtherCurrencies({ rows, currency }) {
  return (
    <section className="panel panel--spaced" aria-labelledby="money-other-currencies-title">
      <header className="panel__header">
        <h3 id="money-other-currencies-title">Received in other currencies</h3>
      </header>
      <p className="field__hint panel__note">
        Not in the totals above{currency ? ` (${currency})` : ''}: amounts in different currencies are never added together.
      </p>
      <div className="table-wrap" role="region" aria-label="Amounts received in other currencies" tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Currency</th>
              <th scope="col" className="num">
                Payments
              </th>
              <th scope="col" className="num">
                Received
              </th>
              <th scope="col" className="num">
                Refunds
              </th>
              <th scope="col" className="num">
                Net received
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.currency}>
                <th scope="row">{row.currency}</th>
                <td className="num">{formatCount(row.count)}</td>
                <td className="num">{formatMoney(row.received, row.currency)}</td>
                <td className="num">{formatMoney(row.refunds, row.currency)}</td>
                <td className="num">{formatMoney(row.netReceived, row.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default MoneyInPage
