import { formatMoney, formatMoneyCompact } from '../utils/format'
import { periodLabel } from '../utils/reportRange'

/*
 * Phase 21 §2: hand-made charts like the sales report's NetChart. Each one
 * is a picture (role="img") named by its heading and described by a text
 * summary shown above it; the caller puts every value in a table under
 * "Show the numbers as a table". Colours are tokens (--color-chart-*), ≥ 3:1
 * against the page; every label is text in the page's ink (≥ 4.5:1).
 */

/**
 * Horizontal bars, one per row ({ key, label, value ≥ 0 }), longest = the
 * biggest value. The value is written next to each bar, so colour carries
 * nothing on its own.
 */
export function HorizontalBars({ rows, titleId, summaryId, summary, currency }) {
  const max = Math.max(0, ...rows.map((row) => row.value)) || 1
  return (
    <>
      <p id={summaryId} className="chart__summary">
        {summary}
      </p>
      <figure className="hbars" role="img" aria-labelledby={titleId} aria-describedby={summaryId}>
        {rows.map((row) => (
          <div key={row.key} className="hbars__row" aria-hidden="true">
            <span className="hbars__label">{row.label}</span>
            <span className="hbars__track">
              <span className="hbars__bar" style={{ width: `${(Math.max(row.value, 0) / max) * 100}%` }} />
            </span>
            <span className="hbars__value">{formatMoney(row.value, currency)}</span>
          </div>
        ))}
      </figure>
    </>
  )
}

/** The parts of a stacked column, bottom first: key, legend label, token class. */
const MONEY_IN_PARTS = [
  { key: 'online', label: 'Online', className: 'chart__part--1' },
  { key: 'codCash', label: 'Cash on delivery', className: 'chart__part--2' },
  { key: 'other', label: 'Other', className: 'chart__part--3' },
]

/** Stacked columns per period (each part ≥ 0), with a legend in words. */
export function StackedChart({ series, groupBy, parts = MONEY_IN_PARTS, titleId, summaryId, summary, currency }) {
  const totalOf = (point) => parts.reduce((sum, part) => sum + Math.max(point[part.key] ?? 0, 0), 0)
  const max = Math.max(0, ...series.map(totalOf)) || 1
  // Selective axis labels: first, middle, last, so they never collide.
  const labelled = new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])
  return (
    <div className="chart">
      <p id={summaryId} className="chart__summary">
        {summary}
      </p>
      <ul className="chart__legend" aria-label="Colours in the chart">
        {parts.map((part) => (
          <li key={part.key}>
            <span className={`chart__swatch ${part.className}`} aria-hidden="true" />
            {part.label}
          </li>
        ))}
      </ul>
      <figure className="chart__figure" role="img" aria-labelledby={titleId} aria-describedby={summaryId}>
        <div className="chart__axis" aria-hidden="true">
          <span>{formatMoneyCompact(Math.max(0, ...series.map(totalOf)), currency)}</span>
        </div>
        <div className="chart__plot" aria-hidden="true">
          <span className="chart__zero" style={{ bottom: 0 }} />
          {series.map((point) => {
            const total = totalOf(point)
            return (
              <div key={point.period} className="chart__slot">
                <span className="chart__stack" style={{ height: `${(total / max) * 100}%` }}>
                  {parts.map((part) =>
                    point[part.key] > 0 ? <span key={part.key} className={`chart__part ${part.className}`} style={{ flexGrow: point[part.key] }} /> : null,
                  )}
                </span>
                <span className="chart__tip">
                  <strong>{formatMoney(total, currency)}</strong> {periodLabel(point.period, groupBy)}
                  {parts.map((part) => ` · ${part.label} ${formatMoney(point[part.key] ?? 0, currency)}`).join('')}
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
    </div>
  )
}
