import { useContext } from 'react'
import { CompareContext } from '../context/compareContext'

/**
 * The compare list (phase 11). Returns null outside <CompareProvider>, so
 * components that only offer comparison (cards in isolated tests, for example) simply leave it out.
 */
export function useCompare() {
  return useContext(CompareContext)
}
