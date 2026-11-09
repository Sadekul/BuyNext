import { cn } from '../../utils/classNames'
import './ChoiceCards.css'

/**
 * A radio group rendered as selectable cards (delivery and payment options).
 * Works with React Hook Form: pass `register(name)` as `registration`.
 * `options` = [{ id, label, description, aside }].
 */
function ChoiceCards({ legend, options, registration, selectedId, error }) {
  return (
    <fieldset className={cn('choice-cards', error && 'choice-cards--invalid')}>
      <legend className="choice-cards__legend">{legend}</legend>
      <div className="choice-cards__list">
        {options.map((option) => (
          <label key={option.id} className={cn('choice-card', selectedId === option.id && 'choice-card--selected')}>
            <input type="radio" value={option.id} {...registration} />
            <span className="choice-card__text">
              <span className="choice-card__label">{option.label}</span>
              {option.description && <span className="choice-card__description">{option.description}</span>}
            </span>
            {option.aside && <span className="choice-card__aside">{option.aside}</span>}
          </label>
        ))}
      </div>
      {error && <p className="form-field__error">{error}</p>}
    </fieldset>
  )
}

export default ChoiceCards
