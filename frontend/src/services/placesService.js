import { apiClient } from './apiClient'

/*
 * Phase 14: Bangladesh's places (8 divisions, 64 districts, their upazilas
 * and thanas), public and cached, through the catalog service on this site's
 * own address (/api/catalog/places/bd → /api/v1/places/bd, frontend/server/catalogApi.js).
 * Bangla pages ask with `lang=bn` (apiClient), so the lists come back in Bangla order.
 */

const CATALOG = { sameOrigin: true }

const toId = (value) => {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** One place → { id, name, nameEn, nameBn, kind, postcodes }. */
export function normalizePlace(raw = {}) {
  const nameEn = typeof raw.name_en === 'string' ? raw.name_en : typeof raw.name === 'string' ? raw.name : ''
  return {
    id: toId(raw.id),
    name: typeof raw.name === 'string' ? raw.name : nameEn,
    nameEn,
    nameBn: typeof raw.name_bn === 'string' && raw.name_bn ? raw.name_bn : null,
    kind: raw.kind === 'thana' || raw.kind === 'upazila' ? raw.kind : null,
    postcodes: Array.isArray(raw.postcodes) ? raw.postcodes.map(String).filter((code) => /^\d{4}$/.test(code)) : [],
  }
}

const list = (answer) => (Array.isArray(answer?.data) ? answer.data : []).map(normalizePlace).filter((place) => place.id !== null)

/** GET /api/catalog/places/bd/divisions → [place]. */
export async function getDivisions({ signal } = {}) {
  return list(await apiClient.get('/api/catalog/places/bd/divisions', { ...CATALOG, signal }))
}

/** GET /api/catalog/places/bd/districts?division= → [place] (every district when `divisionId` is null). */
export async function getDistricts(divisionId, { signal } = {}) {
  return list(await apiClient.get('/api/catalog/places/bd/districts', { ...CATALOG, params: { division: divisionId }, signal }))
}

/** GET /api/catalog/places/bd/areas?district= → [place] (upazilas and thanas, with postcodes). */
export async function getAreas(districtId, { signal } = {}) {
  return list(await apiClient.get('/api/catalog/places/bd/areas', { ...CATALOG, params: { district: districtId }, signal }))
}
