import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { LuSearch } from 'react-icons/lu'
import { Trans, useTranslation } from 'react-i18next'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useQuery } from '@tanstack/react-query'
import { suggestionsQuery } from '../../queries/productQueries'
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
 *   one request after you pause, not five. TanStack Query caches each query
 *   (typing "lap" again is instant, with no request).
 * - Keyboard: ↓/↑ move through suggestions, Enter opens one (or searches),
 *   Escape closes the list.
 *
 * `onSearch` is optional — the mobile menu uses it to close itself.
 * `categories` (phase 17, optional: [{ slug, name }]) adds a "Search in" select
 * after the box; a chosen category searches only there (`/products?q=…&category=slug`).
 * It comes after the text box in the page order, so the box stays the first combobox.
 */
function SearchBar({ placeholder: placeholderProp, onSearch, categories, inputId: inputIdProp }) {
  const { t } = useTranslation('common')
  const placeholder = placeholderProp ?? t('search.placeholder')
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [active, setActive] = useState({ query: '', index: -1 })
  const [category, setCategory] = useState('')
  const navigate = useNavigate()
  const generatedId = useId()
  const inputId = inputIdProp ?? generatedId
  const listboxId = useId()
  const categoryId = useId()
  const categoryOptions = Array.isArray(categories) ? categories : []
  const searchCategory = categoryOptions.some((option) => option.slug === category) ? category : ''

  const trimmedQuery = query.trim()
  const debouncedQuery = useDebouncedValue(trimmedQuery, DEBOUNCE_MS)
  const canSuggest = debouncedQuery.length >= MIN_QUERY_LENGTH

  const request = useQuery(suggestionsQuery(debouncedQuery)) // disabled below MIN_QUERY_LENGTH
  const suggestions = canSuggest ? (request.data?.items ?? []) : []
  const total = request.data?.total ?? 0
  // Phase 10: the API corrected a typo for these suggestions ("ihpone" → "iphone").
  const correctedQuery = canSuggest ? (request.data?.correctedQuery ?? null) : null

  // The highlighted option only counts for the query it was chosen in
  // (derived reset: typing a new letter clears the highlight, no effect needed).
  const activeIndex = active.query === debouncedQuery ? active.index : -1
  // Only show results that belong to what's typed right now.
  const showList = isOpen && canSuggest && trimmedQuery === debouncedQuery && request.isSuccess

  function goTo(path) {
    setIsOpen(false)
    setQuery('')
    navigate(path)
    onSearch?.(trimmedQuery)
  }

  function submitSearch() {
    if (!trimmedQuery) return
    // The store can send an exact term straight to a page (phase 7 search
    // redirects): the suggestions for this very term already carry it.
    const redirect = trimmedQuery === debouncedQuery ? request.data?.redirectUrl : null
    if (redirect && !redirect.startsWith('/')) {
      onSearch?.(trimmedQuery)
      window.location.assign(redirect)
      return
    }
    const inCategory = searchCategory ? `&category=${encodeURIComponent(searchCategory)}` : ''
    goTo(redirect ?? `${ROUTES.products}?q=${encodeURIComponent(trimmedQuery)}${inCategory}`)
  }

  function handleSubmit(event) {
    event.preventDefault() // stop the browser's full-page form submission
    if (showList && activeIndex >= 0) goTo(ROUTES.productDetails(suggestions[activeIndex].id))
    else submitSearch()
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      // With suggestions showing, Escape closes only them: without this, the
      // mobile menu (a <dialog>) would also treat it as "close the menu".
      if (showList) {
        event.preventDefault()
        event.stopPropagation()
      }
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
        {t('search.label')}
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
        {categoryOptions.length > 0 && (
          <>
            <label htmlFor={categoryId} className="visually-hidden">
              {t('search.inCategory')}
            </label>
            <select id={categoryId} className="search-bar__category" value={searchCategory} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t('search.allCategories')}</option>
              {categoryOptions.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button type="submit" className="search-bar__button" aria-label={t('search.submit')}>
          <LuSearch aria-hidden="true" />
        </button>
      </div>

      <ul id={listboxId} role="listbox" aria-label={t('search.suggestions')} className="search-bar__suggestions" hidden={!showList}>
        {correctedQuery && suggestions.length > 0 && (
          <li className="search-bar__corrected" role="presentation">
            <Trans t={t} i18nKey="search.showingFor" values={{ query: correctedQuery }} components={{ strong: <strong /> }} />
          </li>
        )}
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
              <HighlightedText text={product.title} query={correctedQuery ?? debouncedQuery} />
              {product.category && <span className="search-bar__option-meta">{product.categoryName ?? formatSlug(product.category)}</span>}
            </span>
            <span className="search-bar__option-price">{formatPrice(getProductPricing(product).salePrice)}</span>
          </li>
        ))}
        {suggestions.length === 0 ? (
          <li className="search-bar__empty" role="presentation">
            {t('search.noMatch', { query: debouncedQuery })}
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
              {t('search.seeAll', { count: total, query: debouncedQuery })}
            </button>
          </li>
        )}
      </ul>
      <p className="visually-hidden" role="status">
        {showList &&
          (suggestions.length > 0
            ? t(correctedQuery ? 'search.availableFor' : 'search.available', { count: suggestions.length, query: correctedQuery })
            : t('search.none'))}
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
