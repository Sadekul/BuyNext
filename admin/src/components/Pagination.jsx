import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { formatCount } from '../utils/format'

/** "21–40 of 194" with previous/next. `onChange(skip)`. */
function Pagination({ total, limit, skip, onChange }) {
  if (total <= limit) return null
  const first = skip + 1
  const last = Math.min(skip + limit, total)
  return (
    <nav className="pagination" aria-label="Pages">
      <p>
        {formatCount(first)}–{formatCount(last)} of {formatCount(total)}
      </p>
      <div className="pagination__buttons">
        <button type="button" className="btn btn--outline btn--sm" disabled={skip === 0} onClick={() => onChange(Math.max(0, skip - limit))}>
          <LuChevronLeft aria-hidden="true" /> Previous
        </button>
        <button type="button" className="btn btn--outline btn--sm" disabled={last >= total} onClick={() => onChange(skip + limit)}>
          Next <LuChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

export default Pagination
