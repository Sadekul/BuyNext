import { useSyncExternalStore } from 'react'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener?.('change', onChange)
  return () => query.removeEventListener?.('change', onChange)
}
const prefersReducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(REDUCED_MOTION).matches)

/** true while the visitor asked their system for less motion. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
}
