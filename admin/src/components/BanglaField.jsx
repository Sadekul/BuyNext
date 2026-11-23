import Field from './Field'
import StatusBadge from './StatusBadge'

/**
 * Phase 13: a Bangla text next to its English one. The control gets
 * lang="bn" (screen readers and spell checkers read it as Bangla). When it is
 * empty, a "Falls back to English" note says what shoppers see instead; the
 * note is part of the field's description, so it is read with it.
 */
function BanglaField({ label, value, english, onChange, error, multiline = false, rows = 3, maxLength, className = '', hint, disabled, inputProps = {} }) {
  const empty = value.trim() === ''
  const englishText = String(english ?? '').trim()
  const fallback = empty ? (
    <span className="bangla-fallback">
      <StatusBadge tone="neutral" label="Falls back to English" />
      <span>{englishText ? ` Shoppers using Bangla see: “${englishText.length > 80 ? `${englishText.slice(0, 80)}…` : englishText}”.` : ' The English field is empty too.'}</span>
    </span>
  ) : null
  return (
    <Field
      label={label}
      error={error}
      className={className}
      hint={
        hint || fallback ? (
          <>
            {hint}
            {hint && fallback ? ' ' : null}
            {fallback}
          </>
        ) : undefined
      }
    >
      {(a11y) =>
        multiline ? (
          <textarea {...a11y} {...inputProps} lang="bn" rows={rows} value={value} maxLength={maxLength} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <input {...a11y} {...inputProps} lang="bn" value={value} maxLength={maxLength} disabled={disabled} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
        )
      }
    </Field>
  )
}

export default BanglaField
