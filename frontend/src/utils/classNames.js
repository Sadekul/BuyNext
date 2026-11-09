/**
 * Joins CSS class names, skipping falsy values.
 * cn('btn', isActive && 'btn--active') → 'btn btn--active' or 'btn'
 */
export function cn(...classNames) {
  return classNames.filter(Boolean).join(' ')
}
