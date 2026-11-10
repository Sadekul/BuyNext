/**
 * Shows server-side validation errors (Laravel 422) on the matching form
 * fields. `fieldMap` translates API field names to form field paths, e.g.
 * { 'shipping_address.postal_code': 'shipping.postalCode' }.
 * Returns true when at least one field error was applied.
 */
export function applyServerFieldErrors(error, setError, fieldMap = {}) {
  if (!error?.fieldErrors) return false

  let applied = false
  for (const [apiField, messages] of Object.entries(error.fieldErrors)) {
    const formField = fieldMap[apiField]
    if (!formField) continue
    setError(formField, { type: 'server', message: Array.isArray(messages) ? messages[0] : String(messages) })
    applied = true
  }
  return applied
}

/** A copy of a { field: messages } object without one field (its message was about the old value). */
export function withoutField(errors, field) {
  const rest = { ...errors }
  delete rest[field]
  return rest
}
