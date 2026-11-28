import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import { GROUPS, defaultRange, knownZone, rememberZone } from '../utils/reportRange'

/**
 * Phase 21: a report page's period from the address (?from&to&groupBy), or
 * the last 30 days in the store time zone. `noteZone(range.timezone)` after
 * a report answers: when the store's zone differs from the one assumed, the
 * default period moves to the store's today (a period chosen in the address
 * stays as it is).
 */
export function useReportRange() {
  const [params, setParams] = useSearchParams()
  const [zone, setZone] = useState(knownZone)
  const fallback = defaultRange(zone)
  const range = {
    from: params.get('from') ?? fallback.from,
    to: params.get('to') ?? fallback.to,
    groupBy: GROUPS.some((group) => group.value === params.get('groupBy')) ? params.get('groupBy') : 'day',
  }
  const noteZone = useCallback((value) => {
    rememberZone(value)
    if (value) setZone((current) => (value !== current && knownZone() === value ? value : current))
  }, [])
  const apply = useCallback((draft) => setParams(draft), [setParams])
  return { range, zone, noteZone, apply }
}
