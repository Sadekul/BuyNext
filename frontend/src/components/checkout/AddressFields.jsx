import FormField, { SelectField } from '../forms/FormField'
import { COUNTRIES } from '../../constants/store'
import './AddressFields.css'

/**
 * Address inputs for one prefix ("shipping" or "billing"). Uses React Hook
 * Form's `register` (uncontrolled inputs: the DOM holds the values, RHF
 * reads them) and shows nested errors like errors.shipping.city.
`countries`: where the store ships (REAL_SHOP: the server's settings).
 */
function AddressFields({ prefix, register, errors = {}, autoCompleteSection, countries = COUNTRIES }) {
  // Browsers autofill separate address books with "section-… shipping/billing …".
  const ac = (token) => `section-${autoCompleteSection} ${autoCompleteSection} ${token}`
  const field = (name) => ({ ...register(`${prefix}.${name}`), error: errors[name]?.message })

  return (
    <div className="address-fields">
      <FormField label="First name" autoComplete={ac('given-name')} {...field('firstName')} />
      <FormField label="Last name" autoComplete={ac('family-name')} {...field('lastName')} />
      <FormField className="address-fields__wide" label="Street address" autoComplete={ac('address-line1')} {...field('line1')} />
      <FormField
        className="address-fields__wide"
        label="Apartment, suite, etc. (optional)"
        autoComplete={ac('address-line2')}
        {...field('line2')}
      />
      <FormField label="City" autoComplete={ac('address-level2')} {...field('city')} />
      <FormField label="State / region" autoComplete={ac('address-level1')} {...field('state')} />
      <FormField label="Postal code" autoComplete={ac('postal-code')} {...field('postalCode')} />
      <SelectField label="Country" options={countries} autoComplete={ac('country-name')} {...field('country')} />
    </div>
  )
}

export default AddressFields
