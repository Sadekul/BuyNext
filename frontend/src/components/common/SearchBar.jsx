import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { LuSearch } from 'react-icons/lu'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useFetch } from '../../hooks/useFetch'
import { getSearchSuggestions } from '../../services/productService'
import { ROUTES } from '../../constants/routes'
import { cn } from '../../utils/classNames'
import { formatPrice, formatSlug } from '../../utils/formatters'
import { getProductPricing } from '../../utils/pricing'
import './SearchBar.css'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300

/**
 * Product search with live suggestions (the ARIA "combobox" pattern).
 *
 * - The input is controlled (`query`).
 * - Suggestions use a DEBOUNCED copy of the query, so typing "phone" sends
 *   one request after you pause, not five; useFetch cancels outdated ones.
 * - Keyboard: ↓/↑ move through suggestions, Enter opens one (or searches),
 *   Escape closes the list.
 *
 * `onSearch` is optional — the mobile menu uses it to close itself.
 */
function SearchBar({ placeholder = 'Search products and brands', onSearch }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [active, setActive] = useState({ query: '', index: -1 })
  const navigate = useNavigate()
  const inputId = useId()
  const listboxId = useId()

  const trimmedQuery = query.trim()
  const debouncedQuery = useDebouncedValue(trimmedQuery, DEBOUNCE_MS)
  const canSuggest = debouncedQuery.length >= MIN_QUERY_LENGTH

  const request = useFetch(`suggest:${debouncedQuery}`, (signal) =>
    canSuggest ? getSearchSuggestions(debouncedQuery, { signal }) : Promise.resolve(null),
  )
  const suggestions = canSuggest ? (request.data?.items ?? []) : []
  const total = request.data?.total ?? 0

  // The highlighted option only counts for the query it was chosen in
  // (derived reset: typing a new letter clears the highlight, no effect needed).
  const activeIndex = active.query === debouncedQuery ? active.index : -1
  const showList = isOpen && canSuggest && trimmedQuery === debouncedQuery && !request.isLoading && !request.error

  function goTo(path) {
    setIsOpen(false)
    setQuery('')
    navigate(path)
    onSearch?.(trimmedQuery)
  }

  function submitSearch() {
    if (!trimmedQuery) return
    goTo(`${ROUTES.products}?q=${encodeURIComponent(trimmedQuery)}`)
  }

  function handleSubmit(event) {
    event.preventDefault() // stop the browser's full-page form submission
    if (showList && activeIndex >= 0) goTo(ROUTES.productDetails(suggestions[activeIndex].id))
    else submitSearch()
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }
    if (!showList || suggestions.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault() // keep the text cursor where it is
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = (activeIndex + step + suggestions.length + 1) % (suggestions.length + 1) // includes "no selection"
      setActive({ query: debouncedQuery, index: next === suggestions.length ? -1 : next })
    }
  }

  const optionId = (index) => `${listboxId}-option-${index}`

  return (
    <form className="search-bar" role="search" onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="visually-hidden">
        Search products
      </label>
      <div className="search-bar__field">
        <input
          id={inputId}
          className="search-bar__input"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button type="submit" className="search-bar__button" aria-label="Search">
          <LuSearch aria-hidden="true" />
        </button>
      </div>

      <ul id={listboxId} role="listbox" aria-label="Search suggestions" className="search-bar__suggestions" hidden={!showList}>
        {suggestions.map((product, index) => (
          <li
            key={product.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            className={cn('search-bar__option', index === activeIndex && 'search-bar__option--active')}
            // mousedown (not click) fires before the input's blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault()
              goTo(ROUTES.productDetails(product.id))
            }}
          >
            <img src={product.thumbnail} alt="" width="40" height="40" />
            <span className="search-bar__option-text">
              <HighlightedText text={product.title} query={debouncedQuery} />
              {product.category && <span className="search-bar__option-meta">{formatSlug(product.category)}</span>}
            </span>
            <span className="search-bar__option-price">{formatPrice(getProductPricing(product).salePrice)}</span>
          </li>
        ))}
        {suggestions.length === 0 ? (
          <li className="search-bar__empty" role="presentation">
            No products match "{debouncedQuery}"
          </li>
        ) : (
          <li className="search-bar__all" role="presentation">
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault()
                submitSearch()
              }}
            >
              See all {total} results for "{debouncedQuery}"
            </button>
          </li>
        )}
      </ul>
      <p className="visually-hidden" role="status">
        {showList && (suggestions.length > 0 ? `${suggestions.length} suggestions available` : 'No suggestions')}
      </p>
    </form>
  )
}

/** Wraps the first case-insensitive match of `query` in <mark>. */
function HighlightedText({ text, query }) {
  const start = text.toLowerCase().indexOf(query.toLowerCase())
  if (start === -1) return <span className="search-bar__option-title">{text}</span>
  const end = start + query.length
  return (
    <span className="search-bar__option-title">
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </span>
  )
}

export default SearchBar
