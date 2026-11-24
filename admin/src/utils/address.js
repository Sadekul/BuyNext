/* Address helpers for the admin's address forms (customer address book, create order). */
// Phase 14: Bangladesh addresses (division, district, area; mobile number).
import { BD_MOBILE_MESSAGE, isBangladesh, isBdPostcode, normalizeBdMobile } from './bangladesh'

// Phase 14: + divisionId, districtId, areaId ('' until chosen) for Bangladesh.
export const EMPTY_ADDRESS = { firstName: '', lastName: '', company: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: '', divisionId: '', districtId: '', areaId: '' }

const placeId = (value) => (value === '' || value === null || value === undefined ? null : Number(value))

/** Address fields → the shape the API checks (optional fields left empty become null). */
export function addressValues(address, { withContact = false } = {}) {
  const trimmed = Object.fromEntries(Object.entries(address).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]))
  // Phase 14: a Bangladesh address names its places by id; the server fills city and state from them.
  if (isBangladesh(trimmed.country)) {
    const values = {
      firstName: trimmed.firstName,
      lastName: trimmed.lastName,
      line1: trimmed.line1,
      line2: trimmed.line2 || null,
      postalCode: trimmed.postalCode || null,
      country: trimmed.country,
      divisionId: placeId(trimmed.divisionId),
      districtId: placeId(trimmed.districtId),
      areaId: placeId(trimmed.areaId),
    }
    return withContact ? { ...values, company: trimmed.company || null, phone: normalizeBdMobile(trimmed.phone ?? '') ?? trimmed.phone } : values
  }
  const values = {
    firstName: trimmed.firstName,
    lastName: trimmed.lastName,
    line1: trimmed.line1,
    line2: trimmed.line2 || null,
    city: trimmed.city,
    state: trimmed.state || null,
    postalCode: trimmed.postalCode,
    country: trimmed.country,
  }
  return withContact ? { ...values, company: trimmed.company || null, phone: trimmed.phone } : values
}

/** The checks done here first (the server has the final word). */
export function addressErrors(address, { withContact = false } = {}) {
  const errors = {}
  const bangladesh = isBangladesh(address.country ?? '')
  if (withContact && !address.phone?.trim()) errors.phone = [bangladesh ? 'Enter a mobile number.' : 'Enter a phone number.']
  // Phase 14: the courier calls this number: in Bangladesh, a Bangladeshi mobile.
  else if (withContact && bangladesh && !normalizeBdMobile(address.phone)) errors.phone = [BD_MOBILE_MESSAGE]
  if (!address.firstName.trim()) errors.firstName = ['Enter the first name.']
  if (!address.lastName.trim()) errors.lastName = ['Enter the last name.']
  if (bangladesh) {
    if (!address.line1.trim()) errors.line1 = ['Enter the house, road, or village.']
    if (!address.divisionId) errors.divisionId = ['Choose the division.']
    if (!address.districtId) errors.districtId = ['Choose the district.']
    if (!address.areaId) errors.areaId = ['Choose the area (upazila or thana).']
    if (address.postalCode?.trim() && !isBdPostcode(address.postalCode.trim())) errors.postalCode = ['Enter the 4-digit postcode, or leave it empty.']
    return errors
  }
  if (!address.line1.trim()) errors.line1 = ['Enter the street address.']
  if (!address.city.trim()) errors.city = ['Enter the city.']
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(address.postalCode.trim())) errors.postalCode = ['Enter a valid postal code.']
  if (!address.country.trim()) errors.country = ['Choose a country.']
  return errors
}
