import { useQueries, useQuery } from '@tanstack/react-query'
import { allDistrictsQuery, areasQuery, divisionsQuery } from '../queries/placesQueries'
import { isBangladeshAddress } from '../utils/bangladesh'

const sameId = (a, b) => a !== null && a !== undefined && String(a) === String(b)

/**
 * Phase 14: saved addresses and orders name their Bangladesh places by id
 * (the API stores the English names in city, state and `area`). This looks
 * the places up (cached lists: divisions, all districts, and the areas of the
 * districts in use) so they show in the reader's language. Returns
 * `withPlaces(address)`: the address with `division`, `district` and `area`
 * ({ nameEn, nameBn }) filled in when found. No request at all when none of
 * the addresses is a Bangladesh address.
 */
export function useAddressPlaces(addresses) {
  const bangladesh = (addresses ?? []).filter(isBangladeshAddress)
  const enabled = bangladesh.length > 0
  const divisions = useQuery({ ...divisionsQuery(), enabled })
  const districts = useQuery({ ...allDistrictsQuery(), enabled })
  const districtIds = [...new Set(bangladesh.map((address) => address.districtId).filter(Boolean).map(String))]
  const areas = useQueries({ queries: districtIds.map((id) => areasQuery(id)) })

  return function withPlaces(address) {
    if (!isBangladeshAddress(address)) return address
    const index = districtIds.indexOf(String(address.districtId))
    const area = index >= 0 ? areas[index]?.data?.find((place) => sameId(place.id, address.areaId)) : null
    const district = districts.data?.find((place) => sameId(place.id, address.districtId))
    const division = divisions.data?.find((place) => sameId(place.id, address.divisionId))
    return {
      ...address,
      ...(division && { division }),
      ...(district && { district }),
      ...(area && { area }),
    }
  }
}
