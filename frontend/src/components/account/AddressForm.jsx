import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import AddressFields from '../checkout/AddressFields'
import FormField, { CheckboxField } from '../forms/FormField'
import Button from '../ui/Button'
import { createSavedAddressSchema } from '../../schemas/checkoutSchema'
import { applyServerFieldErrors } from '../../utils/serverErrors'
import { usesBangladeshForm } from '../../utils/bangladesh'
import './AddressForm.css'
import { useTranslation } from 'react-i18next'

// Phase 14: a Bangladesh address's division, district and area too.
const FIELDS = ['firstName', 'lastName', 'phone', 'company', 'line1', 'line2', 'city', 'state', 'postalCode', 'country', 'isDefaultShipping', 'isDefaultBilling', 'divisionId', 'districtId', 'areaId']
// The shop service already turns the API's snake_case into these names.
const SERVER_FIELD_MAP = Object.fromEntries(FIELDS.map((field) => [field, field]))

const EMPTY_SAVED_ADDRESS = {
  firstName: '',
  lastName: '',
  phone: '',
  company: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  isDefaultShipping: false,
  isDefaultBilling: false,
}

/**
 * Add or edit one address-book entry. `onSave(values)` returns a promise:
 * the server's 422 field errors land on the matching fields, anything else
 * is shown above the buttons. `countries` are the store's allowed countries;
 * an address saved before its country was removed keeps showing it, and the
 * schema asks for a new one.
 */
function AddressForm({ title, initialValues, countries, onSave, onCancel, submitLabel, bangladesh = false, defaultCountry = null }) {
  const { t } = useTranslation('account')
  const titleId = useId()
  // Phase 14: `bangladesh` (the store's API knows Bangladesh's places): an address in Bangladesh has its own fields.
  const [schema] = useState(() => createSavedAddressSchema(countries, { bangladesh }))
  const startCountry = defaultCountry && countries.includes(defaultCountry) ? defaultCountry : (countries[0] ?? '')
  const defaults = { ...EMPTY_SAVED_ADDRESS, country: startCountry, ...initialValues }
  const options = defaults.country && !countries.includes(defaults.country) ? [...countries, defaults.country] : countries

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: defaults, mode: 'onSubmit', reValidateMode: 'onChange' })
  const country = useWatch({ control, name: 'country' })
  const bangladeshAddress = usesBangladeshForm(country, { bangladeshAddresses: bangladesh })

  async function submit(values) {
    clearErrors('root.server')
    try {
      await onSave(values)
    } catch (error) {
      if (applyServerFieldErrors(error, setError, SERVER_FIELD_MAP)) return
      setError('root.server', { message: Object.values(error.fieldErrors ?? {})[0]?.[0] ?? error.message })
    }
  }

  return (
    <form className="address-form" onSubmit={handleSubmit(submit)} noValidate aria-labelledby={titleId}>
      <h3 id={titleId} className="address-form__title">
        {title}
      </h3>
      <AddressFields prefix="" register={register} errors={errors} autoCompleteSection="shipping" countries={options} form={{ control, setValue }} bangladesh={bangladesh} />
      <div className="address-form__extra">
        <FormField
          label={t('addressForm.phone')}
          type="tel"
          autoComplete="tel"
          hint={bangladeshAddress ? t('common:bdAddress.mobileHint') : t('addressForm.phoneHint')}
          {...register('phone')}
          error={errors.phone?.message}
        />
        <FormField label={t('addressForm.company')} autoComplete="organization" {...register('company')} error={errors.company?.message} />
      </div>
      <div className="address-form__defaults">
        <CheckboxField label={t('addressForm.defaultShipping')} {...register('isDefaultShipping')} error={errors.isDefaultShipping?.message} />
        <CheckboxField label={t('addressForm.defaultBilling')} {...register('isDefaultBilling')} error={errors.isDefaultBilling?.message} />
      </div>
      {errors.root?.server && (
        <p className="address-form__error" role="alert">
          {errors.root.server.message}
        </p>
      )}
      <div className="address-form__actions">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('addressForm.saving') : (submitLabel ?? t('addressForm.save'))}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          {t('addressForm.cancel')}
        </Button>
      </div>
    </form>
  )
}

export default AddressForm
