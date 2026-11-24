import { queryOptions } from '@tanstack/react-query'
import { getAreas, getDistricts, getDivisions } from '../services/placesService'
import { currentLanguage } from '../i18n'

/* Phase 14: Bangladesh's places. They hardly ever change: kept for the visit. The order follows the language. */
const HOUR = 60 * 60_000

export const placesKeys = {
  divisions: () => ['places', 'bd', 'divisions', currentLanguage()],
  allDistricts: () => ['places', 'bd', 'districts', 'all', currentLanguage()],
  districts: (divisionId) => ['places', 'bd', 'districts', String(divisionId), currentLanguage()],
  areas: (districtId) => ['places', 'bd', 'areas', String(districtId), currentLanguage()],
}

export const divisionsQuery = () => queryOptions({ queryKey: placesKeys.divisions(), queryFn: ({ signal }) => getDivisions({ signal }), staleTime: HOUR })

export const districtsQuery = (divisionId) =>
  queryOptions({ queryKey: placesKeys.districts(divisionId), queryFn: ({ signal }) => getDistricts(divisionId, { signal }), staleTime: HOUR, enabled: Boolean(divisionId) })

export const areasQuery = (districtId) =>
  queryOptions({ queryKey: placesKeys.areas(districtId), queryFn: ({ signal }) => getAreas(districtId, { signal }), staleTime: HOUR, enabled: Boolean(districtId) })

/** All 64 districts at once (names for saved addresses and orders, in the reader's language). */
export const allDistrictsQuery = () => queryOptions({ queryKey: placesKeys.allDistricts(), queryFn: ({ signal }) => getDistricts(null, { signal }), staleTime: HOUR })
