import { useId } from 'react'
import { cn } from '../../utils/classNames'
import { isValueAvailable } from '../../utils/variants'
import './VariantSelector.css'
import { useTranslation } from 'react-i18next'

/**
 * Option pickers for a configurable product (Size, Color, …): one native
 * radio group per option, inside a <fieldset> whose <legend> names it and,
 * once chosen, the value ("Color: Blue", phase 16), so arrow keys, screen
 * readers, and forms work as usual. Values that can't be bought with the
 * earlier choices (no variant, or out of stock) are disabled. The radios look
 * like buttons (text options) or round colour swatches (`type: "color"`,
 * phase 16) but stay real inputs (visually hidden, not display:none, so they
 * keep keyboard focus).
 *
 * `allowSoldOut` (phase 9, stores with stock alerts): values that exist but
 * are sold out stay selectable, marked "sold out", so the shopper can choose
 * that variant and ask to be emailed when it's back.
 *
 * `errors` (phase 16): option id → message ("Please select Size."), shown
 * under that option and linked to its group with aria-describedby.
 */
function VariantSelector({ product, selection, onChange, allowSoldOut = false, errors = {} }) {
  const { t } = useTranslation('catalog')
  const id = useId()

  return (
    <div className="variant-selector">
      {product.options.map((option) => {
        const isColor = option.type === 'color'
        const chosen = option.values.find((value) => value.id === selection[option.id])
        const errorId = `${id}-${option.id}-error`
        return (
          <fieldset
            key={option.id}
            className="variant-selector__option"
            data-option-id={option.id}
            aria-describedby={errors[option.id] ? errorId : undefined}
          >
            <legend className="variant-selector__legend">
              {option.name}
              {chosen && <span className="variant-selector__chosen">{t('variants.chosen', { value: chosen.value })}</span>}
            </legend>
            <div className={cn('variant-selector__values', isColor && 'variant-selector__values--swatches')}>
              {option.values.map((value) => {
                const inputId = `${id}-${option.id}-${value.id}`
                const available = isValueAvailable(product, selection, option.id, value.id)
                const soldOut = !available && allowSoldOut && isValueAvailable(product, selection, option.id, value.id, { soldOut: true })
                const status = available ? '' : t(soldOut ? 'variants.soldOut' : 'variants.unavailable')
                return (
                  <span key={value.id} className="variant-selector__value">
                    <input
                      type="radio"
                      id={inputId}
                      className="variant-selector__input"
                      name={`${id}-option-${option.id}`}
                      value={value.id}
                      checked={selection[option.id] === value.id}
                      disabled={!available && !soldOut}
                      onChange={() => onChange(option.id, value.id)}
                    />
                    {isColor ? (
                      <label
                        htmlFor={inputId}
                        className={cn(
                          'variant-selector__swatch',
                          !value.swatch && 'variant-selector__swatch--plain',
                          !available && 'variant-selector__swatch--unavailable',
                          soldOut && 'variant-selector__swatch--sold-out',
                        )}
                        title={`${value.value}${status}`}
                      >
                        {/* One text for the name and the status: "Green (sold out)". */}
                        {value.swatch ? (
                          <>
                            <span className="variant-selector__swatch-colour" style={{ backgroundColor: value.swatch }} aria-hidden="true" />
                            <span className="visually-hidden">{`${value.value}${status}`}</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">{value.value}</span>
                            <span className="visually-hidden">{`${value.value}${status}`}</span>
                          </>
                        )}
                      </label>
                    ) : (
                      <label
                        htmlFor={inputId}
                        className={cn('variant-selector__label', !available && 'variant-selector__label--unavailable', soldOut && 'variant-selector__label--sold-out')}
                      >
                        {value.value}
                        {!available && <span className="visually-hidden">{status}</span>}
                      </label>
                    )}
                  </span>
                )
              })}
            </div>
            {errors[option.id] && (
              <p className="variant-selector__error" id={errorId}>
                {errors[option.id]}
              </p>
            )}
          </fieldset>
        )
      })}
    </div>
  )
}

export default VariantSelector
