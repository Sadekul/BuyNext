import { useState } from 'react'
import { GROUPS, rangeProblem } from '../utils/reportRange'

/**
 * The report period: From, To and (when `grouped`) Group by, then Show.
 * The dates are whole days in the store time zone. Remount it with a `key`
 * of the applied range so it starts from what is shown.
 */
function ReportRangeForm({ range, onApply, grouped = true }) {
  const [draft, setDraft] = useState(range)
  const [problem, setProblem] = useState(null)

  function apply(event) {
    event.preventDefault()
    const found = rangeProblem(draft)
    setProblem(found)
    if (!found) onApply(grouped ? draft : { from: draft.from, to: draft.to })
  }

  return (
    <>
      <form className="toolbar" aria-label="Report period" noValidate onSubmit={apply}>
        <label className="toolbar__select">
          <span>From</span>
          <input type="date" value={draft.from} max={draft.to} required onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label className="toolbar__select">
          <span>To</span>
          <input type="date" value={draft.to} min={draft.from} required onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </label>
        {grouped && (
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
        )}
        <button type="submit" className="btn btn--outline">
          Show
        </button>
      </form>
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
    </>
  )
}

export default ReportRangeForm
