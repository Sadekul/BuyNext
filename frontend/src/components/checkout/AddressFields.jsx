import FormField, { SelectField } from '../forms/FormField'
import { COUNTRIES } from '../../constants/store'
import './AddressFields.css'
import { useTranslation } from 'react-i18next'

/**
 * Address inputs for one prefix ("shipping" or "billing"). Uses React Hook
 * Form's `register` (uncontrolled inputs: the DOM holds the values, RHF
 * reads them) and shows nested errors like errors.shipping.city.
 * `countries`: where the store ships (REAL_SHOP: the server's settings).
 * An empty `prefix` registers the fields at the top level (the address book form).
 */
function AddressFields({ prefix, register, errors = {}, autoCompleteSection, countries = COUNTRIES }) {
  const { t } = useTranslation('common')
  // Browsers autofill separate address books with "section-… shipping/billing …".
  const ac = (token) => `section-${autoCompleteSection} ${autoCompleteSection} ${token}`
  const field = (name) => ({ ...register(prefix ? `${prefix}.${name}` : name), error: errors[name]?.message })

  return (
    <div className="address-fields">
      <FormField label={t('address.firstName')} autoComplete={ac('given-name')} {...field('firstName')} />
      <FormField label={t('address.lastName')} autoComplete={ac('family-name')} {...field('lastName')} />
      <FormField className="address-fields__wide" label={t('address.line1')} autoComplete={ac('address-line1')} {...field('line1')} />
      <FormField
        className="address-fields__wide"
        label={t('address.line2')}
        autoComplete={ac('address-line2')}
        {...field('line2')}
      />
      <FormField label={t('address.city')} autoComplete={ac('address-level2')} {...field('city')} />
      <FormField label={t('address.state')} autoComplete={ac('address-level1')} {...field('state')} />
      <FormField label={t('address.postalCode')} autoComplete={ac('postal-code')} {...field('postalCode')} />
      <SelectField
        label={t('address.country')}
        options={countries.map((country) => ({ value: country, label: t(`countries.${country}`, { defaultValue: country }) }))}
        autoComplete={ac('country-name')}
        {...field('country')}
      />
    </div>
  )
}

export default AddressFields
