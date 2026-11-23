import { useState } from 'react'
import FormField from './FormField'
import Button from '../ui/Button'
import { normalizePhone, validatePhone } from '../../utils/validation'
import './EditNameForm.css'
import { useTranslation } from 'react-i18next'

/**
 * Small inline form for first/last name, and the phone number when
 * `initialValues.phone` is given (BuyNest accounts). The parent decides what
 * saving does.
 */
function EditNameForm({ initialValues, onSave, onCancel }) {
  const { t } = useTranslation('account')
  const [values, setValues] = useState(initialValues)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const withPhone = initialValues.phone !== undefined
  const errors = {
    firstName: values.firstName.trim() ? null : t('editName.firstNameRequired'),
    lastName: values.lastName.trim() ? null : t('editName.lastNameRequired'),
    phone: withPhone ? validatePhone(values.phone) : null,
  }

  function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    if (errors.firstName || errors.lastName || errors.phone) return
    onSave({
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      ...(withPhone && { phone: normalizePhone(values.phone) }),
    })
  }

  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => setValues((current) => ({ ...current, [name]: event.target.value })),
    error: hasSubmitted ? errors[name] ?? undefined : undefined,
  })

  return (
    <form className="edit-name-form" onSubmit={handleSubmit} noValidate>
      <FormField label={t('editName.firstName')} autoComplete="given-name" {...field('firstName')} />
      <FormField label={t('editName.lastName')} autoComplete="family-name" {...field('lastName')} />
      {withPhone && <FormField label={t('editName.phone')} type="tel" autoComplete="tel" inputMode="tel" {...field('phone')} />}
      <div className="edit-name-form__actions">
        <Button type="submit" size="sm">
          {t('editName.save')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('editName.cancel')}
        </Button>
      </div>
    </form>
  )
}

export default EditNameForm
