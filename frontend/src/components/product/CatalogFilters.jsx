import { useId } from 'react'
import { FaStar } from 'react-icons/fa6'
import { hasInvalidPriceRange } from '../../utils/catalog'
import { formatNumber } from '../../utils/formatters'
import { getStoreCurrency } from '../../utils/displayCurrency'
import './CatalogFilters.css'
import { useTranslation } from 'react-i18next'

const RATING_OPTIONS = [0, 4, 3, 2]

/**
 * Client-side filter controls. Fully controlled: `filters` comes from the
 * parent and every change is reported through `onChange(nextFilters)`.
 * The component never mutates `filters` — it always builds a new object.
 */
function CatalogFilters({ filters, brandOptions, onChange, onClear, activeCount, showTitle = true }) {
  const { t } = useTranslation('catalog')
  const ids = { min: useId(), max: useId(), priceError: useId(), ratingGroup: useId() }
  const isPriceRangeInvalid = hasInvalidPriceRange(filters)
  // The prices are the store currency's (phase 12: ৳ in a taka store).
  const symbol = getStoreCurrency().symbol

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
      {(showTitle || activeCount > 0) && (
        <div className="catalog-filters__header">
          {showTitle && <h2 className="catalog-filters__title">{t('filters.title')}</h2>}
          {activeCount > 0 && (
            <button type="button" className="catalog-filters__clear" onClick={onClear}>
              {t('filters.clearAllCount', { count: activeCount })}
            </button>
          )}
        </div>
      )}

      <fieldset className="catalog-filters__group">
        <legend>{t('filters.price')}</legend>
        <div className="catalog-filters__price">
          <label htmlFor={ids.min}>
            <span className="visually-hidden">{t('filters.minPrice')}</span>
            <span aria-hidden="true">{symbol}</span>
            <input
              id={ids.min}
              type="number"
              inputMode="decimal"
              min="0"
              placeholder={t('filters.min')}
              value={filters.minPrice}
              onChange={(event) => update({ minPrice: event.target.value })}
              aria-describedby={isPriceRangeInvalid ? ids.priceError : undefined}
            />
          </label>
          <span aria-hidden="true">–</span>
          <label htmlFor={ids.max}>
            <span className="visually-hidden">{t('filters.maxPrice')}</span>
            <span aria-hidden="true">{symbol}</span>
            <input
              id={ids.max}
              type="number"
              inputMode="decimal"
              min="0"
              placeholder={t('filters.max')}
              value={filters.maxPrice}
              onChange={(event) => update({ maxPrice: event.target.value })}
              aria-describedby={isPriceRangeInvalid ? ids.priceError : undefined}
            />
          </label>
        </div>
        {isPriceRangeInvalid && (
          <p id={ids.priceError} className="catalog-filters__error" role="alert">
            {t('filters.priceError')}
          </p>
        )}
      </fieldset>

      <fieldset className="catalog-filters__group">
        <legend>{t('filters.rating')}</legend>
        {RATING_OPTIONS.map((value) => (
          <label key={value} className="catalog-filters__option">
            <input
              type="radio"
              name={ids.ratingGroup} // unique per instance: radios sharing a name form one group page-wide
              checked={filters.minRating === value}
              onChange={() => update({ minRating: value })}
            />
            {value > 0 && <FaStar className="catalog-filters__star" aria-hidden="true" />}
            {value > 0 ? t('filters.ratingUp', { rating: value }) : t('filters.anyRating')}
          </label>
        ))}
      </fieldset>

      {brandOptions.length > 0 && (
        <fieldset className="catalog-filters__group">
          <legend>{t('filters.brand')}</legend>
          <div className="catalog-filters__scroll">
            {brandOptions.map((brand) => (
              <label key={brand.name} className="catalog-filters__option">
                <input
                  type="checkbox"
                  checked={filters.brands.includes(brand.name)}
                  onChange={() => toggleBrand(brand.name)}
                />
                <span className="catalog-filters__option-label">{brand.name}</span>
                <span className="catalog-filters__count">{formatNumber(brand.count)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="catalog-filters__group">
        <legend>{t('filters.availability')}</legend>
        <label className="catalog-filters__option">
          <input
            type="checkbox"
            checked={filters.inStockOnly}
            onChange={(event) => update({ inStockOnly: event.target.checked })}
          />
          {t('filters.inStock')}
        </label>
      </fieldset>
    </div>
  )
}

export default CatalogFilters
