import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { cn } from '../../utils/classNames'
import { getPageItems } from '../../utils/pagination'
import './Pagination.css'

/** Accessible page navigation. The parent owns `currentPage` and handles `onPageChange`. */
function Pagination({ currentPage, pageCount, onPageChange }) {
  if (pageCount <= 1) return null

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="pagination__button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Previous page"
      >
        <LuChevronLeft aria-hidden="true" />
      </button>

      <ul className="pagination__list">
        {getPageItems(currentPage, pageCount).map((item) =>
          typeof item === 'string' ? (
            <li key={item} className="pagination__gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={cn('pagination__button', item === currentPage && 'pagination__button--current')}
                onClick={() => onPageChange(item)}
                aria-current={item === currentPage ? 'page' : undefined}
                aria-label={`Page ${item}`}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ul>

      <button
        type="button"
        className="pagination__button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === pageCount}
        aria-label="Next page"
      >
        <LuChevronRight aria-hidden="true" />
      </button>
    </nav>
  )
}

export default Pagination
