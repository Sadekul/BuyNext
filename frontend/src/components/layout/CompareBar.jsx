import { Link, useLocation } from 'react-router'
import { LuGitCompareArrows, LuX } from 'react-icons/lu'
import { useCompare } from '../../hooks/useCompare'
import { ROUTES } from '../../constants/routes'
import './CompareBar.css'

/**
 * Phase 11 §2: the small sticky "Compare (3) · Clear" bar, on every page
 * while products are picked (not on the compare page itself). Its status
 * line announces additions and why a 5th product wasn't added.
 */
function CompareBar() {
  const compare = useCompare()
  const { pathname } = useLocation()
  if (!compare) return null
  const hidden = compare.count === 0 || pathname === ROUTES.compare

  return (
    <>
      {/* Always rendered, so screen readers announce what changed (also after the last product is removed). */}
      <p className="visually-hidden" role="status">
        {compare.notice}
      </p>
      {!hidden && (
        <aside className="compare-bar" aria-label="Compare products">
          <div className="compare-bar__inner container">
            <Link to={ROUTES.compare} className="compare-bar__link">
              <LuGitCompareArrows aria-hidden="true" />
              Compare ({compare.count})
            </Link>
            {compare.notice && compare.count >= compare.max && <span className="compare-bar__notice">{compare.notice}</span>}
            <button type="button" className="compare-bar__clear" onClick={compare.clear} aria-label="Clear compare list">
              <LuX aria-hidden="true" />
              Clear
            </button>
          </div>
        </aside>
      )}
    </>
  )
}

export default CompareBar
