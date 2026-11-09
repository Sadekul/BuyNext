import { useId } from 'react'
import { FaStar } from 'react-icons/fa6'
import { hasInvalidPriceRange } from '../../utils/catalog'
import './CatalogFilters.css'

const RATING_OPTIONS = [
  { value: 0, label: 'Any rating' },
  { value: 4, label: '4 & up' },
  { value: 3, label: '3 & up' },
  { value: 2, label: '2 & up' },
]

/**
 * Client-side filter controls. Fully controlled: `filters` comes from the
 * parent and every change is reported through `onChange(nextFilters)`.
 * The component never mutates `filters` — it always builds a new object.
 */
function CatalogFilters({ filters, brandOptions, onChange, onClear, activeCount }) {
  const ids = { min: useId(), max: useId(), priceError: useId() }
  const isPriceRangeInvalid = hasInvalidPriceRange(filters)

  function update(changes) {
    onChange({ ...filters, ...changes })
  }

  function toggleBrand(brand) {
    const brands = filters.brands.includes(brand)
      ? filters.brands.filter((name) => name !== brand)
      : [...filters.brands, brand]
    update({ brands })
  }

  return (
    <div className="catalog-filters">
      <div className="catalog-filters__header">
        <h2 className="catalog-filters__title">Filters</h2>
        {activeCount > 0 && (
          <button type="button" className="catalog-filters__clear" onClick={onClear}>
            Clear all ({activeCount})
          </button>
        )}
      </div>

      <fieldset className="catalog-filters__group">
        <legend>Price</legend>
        <div className="catalog-filters__price">
          <label htmlFor={ids.min}>
            <span className="visually-hidden">Minimum price</span>
            <span aria-hidden="true">$</span>
            <input
              id={ids.min}
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="Min"
              value={filters.minPrice}
              onChange={(event) => update({ minPrice: event.target.value })}
              aria-describedby={isPriceRangeInvalid ? ids.priceError : undefined}
            />
          </label>
          <span aria-hidden="true">–</span>
          <label htmlFor={ids.max}>
            <span className="visually-hidden">Maximum price</span>
            <span aria-hidden="true">$</span>
            <input
              id={ids.max}
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="Max"
              value={filters.maxPrice}
              onChange={(event) => update({ maxPrice: event.target.value })}
              aria-describedby={isPriceRangeInvalid ? ids.priceError : undefined}
            />
          </label>
        </div>
        {isPriceRangeInvalid && (
          <p id={ids.priceError} className="catalog-filters__error" role="alert">
            Minimum price is higher than maximum.
          </p>
        )}
      </fieldset>

      <fieldset className="catalog-filters__group">
        <legend>Customer rating</legend>
        {RATING_OPTIONS.map((option) => (
          <label key={option.value} className="catalog-filters__option">
            <input
              type="radio"
              name="min-rating"
              checked={filters.minRating === option.value}
              onChange={() => update({ minRating: option.value })}
            />
            {option.value > 0 && <FaStar className="catalog-filters__star" aria-hidden="true" />}
            {option.label}
          </label>
        ))}
      </fieldset>

      {brandOptions.length > 0 && (
        <fieldset className="catalog-filters__group">
          <legend>Brand</legend>
          <div className="catalog-filters__scroll">
            {brandOptions.map((brand) => (
              <label key={brand.name} className="catalog-filters__option">
                <input
                  type="checkbox"
                  checked={filters.brands.includes(brand.name)}
                  onChange={() => toggleBrand(brand.name)}
                />
                <span className="catalog-filters__option-label">{brand.name}</span>
                <span className="catalog-filters__count">{brand.count}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="catalog-filters__group">
        <legend>Availability</legend>
        <label className="catalog-filters__option">
          <input
            type="checkbox"
            checked={filters.inStockOnly}
            onChange={(event) => update({ inStockOnly: event.target.checked })}
          />
          In stock only
        </label>
      </fieldset>
    </div>
  )
}

export default CatalogFilters
