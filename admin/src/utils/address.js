/* Address helpers for the admin's address forms (customer address book, create order). */

export const EMPTY_ADDRESS = { firstName: '', lastName: '', company: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: '' }

/** Address fields → the shape the API checks (optional fields left empty become null). */
export function addressValues(address, { withContact = false } = {}) {
  const trimmed = Object.fromEntries(Object.entries(address).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]))
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
  if (withContact && !address.phone?.trim()) errors.phone = ['Enter a phone number.']
  if (!address.firstName.trim()) errors.firstName = ['Enter the first name.']
  if (!address.lastName.trim()) errors.lastName = ['Enter the last name.']
  if (!address.line1.trim()) errors.line1 = ['Enter the street address.']
  if (!address.city.trim()) errors.city = ['Enter the city.']
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(address.postalCode.trim())) errors.postalCode = ['Enter a valid postal code.']
  if (!address.country.trim()) errors.country = ['Choose a country.']
  return errors
}
