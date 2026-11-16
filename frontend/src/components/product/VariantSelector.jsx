import { useId } from 'react'
import { cn } from '../../utils/classNames'
import { isValueAvailable } from '../../utils/variants'
import './VariantSelector.css'

/**
 * Option pickers for a configurable product (Size, Color, …): one native
 * radio group per option, inside a <fieldset> whose <legend> names it, so
 * arrow keys, screen readers, and forms work as usual. Values that can't be
 * bought with the earlier choices (no variant, or out of stock) are disabled.
 * The radios look like buttons but stay real inputs (visually hidden, not
 * display:none, so they keep keyboard focus).
 */
function VariantSelector({ product, selection, onChange }) {
  const id = useId()

  return (
    <div className="variant-selector">
      {product.options.map((option) => (
        <fieldset key={option.id} className="variant-selector__option">
          <legend className="variant-selector__legend">{option.name}</legend>
          <div className="variant-selector__values">
            {option.values.map((value) => {
              const inputId = `${id}-${option.id}-${value.id}`
              const available = isValueAvailable(product, selection, option.id, value.id)
              return (
                <span key={value.id} className="variant-selector__value">
                  <input
                    type="radio"
                    id={inputId}
                    className="variant-selector__input"
                    name={`${id}-option-${option.id}`}
                    value={value.id}
                    checked={selection[option.id] === value.id}
                    disabled={!available}
                    onChange={() => onChange(option.id, value.id)}
                  />
                  <label htmlFor={inputId} className={cn('variant-selector__label', !available && 'variant-selector__label--unavailable')}>
                    {value.value}
                    {!available && <span className="visually-hidden"> (unavailable)</span>}
                  </label>
                </span>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}

export default VariantSelector
