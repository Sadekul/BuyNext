import { useId } from 'react'

/**
 * Label + control + hint + error. `children` is a function that receives the
 * id and aria attributes for the control, so the label and messages are wired up
 * (aria-invalid and aria-describedby announce the error with the field).
 */
function Field({ label, error, hint, className = '', children }) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <span id={`${id}-hint`} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="field__error">
          {error}
        </span>
      )}
    </div>
  )
}

export default Field
