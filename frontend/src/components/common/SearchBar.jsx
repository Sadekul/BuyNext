import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { LuSearch } from 'react-icons/lu'
import { ROUTES } from '../../constants/routes'
import './SearchBar.css'

/**
 * Product search form. The input is *controlled*: React state is the single
 * source of truth for its value. Submitting navigates to /products?q=...
 * (the catalog page that reads this query arrives in Phases 4 and 8).
 *
 * `onSearch` is optional — the mobile menu uses it to close itself.
 */
function SearchBar({ placeholder = 'Search products, brands and more…', onSearch }) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const inputId = useId()

  function handleSubmit(event) {
    event.preventDefault() // stop the browser's full-page form submission
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return

    navigate(`${ROUTES.products}?q=${encodeURIComponent(trimmedQuery)}`)
    onSearch?.(trimmedQuery)
  }

  return (
    <form className="search-bar" role="search" onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="visually-hidden">
        Search products
      </label>
      <input
        id={inputId}
        className="search-bar__input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <button type="submit" className="search-bar__button" aria-label="Search">
        <LuSearch aria-hidden="true" />
      </button>
    </form>
  )
}

export default SearchBar
