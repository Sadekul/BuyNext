import { useWatch } from 'react-hook-form'
import FormField, { SelectField } from '../forms/FormField'
import BangladeshAddressFields from './BangladeshAddressFields'
import { COUNTRIES } from '../../constants/store'
import { isBangladesh } from '../../utils/bangladesh'
import './AddressFields.css'
import { useTranslation } from 'react-i18next'

/**
 * Address inputs for one prefix ("shipping" or "billing"). Uses React Hook
 * Form's `register` (uncontrolled inputs: the DOM holds the values, RHF
 * reads them) and shows nested errors like errors.shipping.city.
 * `countries`: where the store ships (REAL_SHOP: the server's settings).
 * An empty `prefix` registers the fields at the top level (the address book form).
 *
 * Phase 14: with `bangladesh` (the store's API knows Bangladesh's places) and
 * `form` ({ control, setValue }), an address in Bangladesh switches to
 * Division → District → Area (BangladeshAddressFields). Without them, or for
 * any other country, the fields are exactly as before.
 */
function AddressFields({ prefix, register, errors = {}, autoCompleteSection, countries = COUNTRIES, form = null, bangladesh = false }) {
  if (bangladesh && form) {
    return <SwitchingAddressFields prefix={prefix} register={register} errors={errors} autoCompleteSection={autoCompleteSection} countries={countries} form={form} />
  }
  return <StandardAddressFields prefix={prefix} register={register} errors={errors} autoCompleteSection={autoCompleteSection} countries={countries} />
}

function useAddressField({ prefix, register, errors, autoCompleteSection }) {
  // Browsers autofill separate address books with "section-… shipping/billing …".
  const ac = (token) => `section-${autoCompleteSection} ${autoCompleteSection} ${token}`
  const field = (name) => ({ ...register(prefix ? `${prefix}.${name}` : name), error: errors[name]?.message })
  return { ac, field }
}

function CountrySelect({ countries, field, ac }) {
  const { t } = useTranslation('common')
  return (
    <SelectField
      label={t('address.country')}
      options={countries.map((country) => ({ value: country, label: t(`countries.${country}`, { defaultValue: country }) }))}
      autoComplete={ac('country-name')}
      {...field('country')}
    />
  )
}

function StandardAddressFields({ prefix, register, errors, autoCompleteSection, countries }) {
  const { t } = useTranslation('common')
  const { ac, field } = useAddressField({ prefix, register, errors, autoCompleteSection })

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
      <CountrySelect countries={countries} field={field} ac={ac} />
    </div>
  )
}

/** Watches the country: Bangladesh gets its own fields, every other country the usual ones. */
function SwitchingAddressFields({ prefix, register, errors, autoCompleteSection, countries, form }) {
  const country = useWatch({ control: form.control, name: prefix ? `${prefix}.country` : 'country' })
  const { ac, field } = useAddressField({ prefix, register, errors, autoCompleteSection })
  if (!isBangladesh(country)) {
    return <StandardAddressFields prefix={prefix} register={register} errors={errors} autoCompleteSection={autoCompleteSection} countries={countries} />
  }
  return (
    <BangladeshAddressFields
      prefix={prefix}
      form={form}
      errors={errors}
      field={field}
      ac={ac}
      countrySelect={<CountrySelect countries={countries} field={field} ac={ac} />}
    />
  )
}

export default AddressFields
