import { useId, useState } from 'react'
import { LuEye, LuEyeOff } from 'react-icons/lu'
import { cn } from '../../utils/classNames'
import './FormField.css'

/**
 * Labelled input with hint and error text, wired up for screen readers:
 * `aria-invalid` marks the field, `aria-describedby` links the hint and the
 * error so they're read with the field. Extra props (name, value, onChange,
 * autoComplete, and in React 19 even `ref`) are passed to the <input>.
 *
 * `revealable` adds a show/hide toggle for password fields.
 */
function FormField({ label, error, hint, type = 'text', revealable = false, className, ...inputProps }) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const [isRevealed, setIsRevealed] = useState(false)
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('form-field', error && 'form-field--invalid', className)}>
      <label htmlFor={id} className="form-field__label">
        {label}
      </label>
      <div className="form-field__control">
        <input
          id={id}
          type={revealable && isRevealed ? 'text' : type}
          className="form-field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...inputProps}
        />
        {revealable && (
          <button
            type="button"
            className="form-field__reveal"
            onClick={() => setIsRevealed((value) => !value)}
            aria-label={isRevealed ? 'Hide password' : 'Show password'}
            aria-pressed={isRevealed}
          >
            {isRevealed ? <LuEyeOff aria-hidden="true" /> : <LuEye aria-hidden="true" />}
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="form-field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="form-field__error">
          {error}
        </p>
      )}
    </div>
  )
}

/** Checkbox with the same error wiring. */
export function CheckboxField({ label, error, className, ...inputProps }) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className={cn('form-field form-field--checkbox', error && 'form-field--invalid', className)}>
      <div className="form-field__checkbox-row">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...inputProps}
        />
        <label htmlFor={id}>{label}</label>
      </div>
      {error && (
        <p id={errorId} className="form-field__error">
          {error}
        </p>
      )}
    </div>
  )
}

/** Labelled <select> with the same label/error wiring. `options` = string[]. */
export function SelectField({ label, error, options, className, ...selectProps }) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className={cn('form-field', error && 'form-field--invalid', className)}>
      <label htmlFor={id} className="form-field__label">
        {label}
      </label>
      <select
        id={id}
        className="form-field__input form-field__select"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...selectProps}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="form-field__error">
          {error}
        </p>
      )}
    </div>
  )
}

export default FormField
