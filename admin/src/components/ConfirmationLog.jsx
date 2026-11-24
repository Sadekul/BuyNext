import { outcomeLabel } from '../utils/bangladesh'
import { formatDateTime } from '../utils/format'

/** The calls and notes of an order's confirmation, newest first. */
function ConfirmationLog({ log, summary }) {
  const entries = [...log].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const list = (
    <ol className="history confirm-log">
      {entries.map((entry, index) => (
        <li key={`${entry.createdAt}-${index}`}>
          <p>
            <strong>{outcomeLabel(entry.outcome)}</strong>
            <span className="muted">
              {' '}
              · <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
              {entry.adminName && ` · by ${entry.adminName}`}
            </span>
          </p>
          {entry.note && <p>{entry.note}</p>}
        </li>
      ))}
    </ol>
  )
  if (!summary) return list
  return (
    <details className="confirm-card__log">
      <summary>{summary}</summary>
      {list}
    </details>
  )
}

export default ConfirmationLog
