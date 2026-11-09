import { useState } from 'react'
import FormField from './FormField'
import Button from '../ui/Button'
import './EditNameForm.css'

/** Small inline form for first/last name. The parent decides what saving does. */
function EditNameForm({ initialValues, onSave, onCancel }) {
  const [values, setValues] = useState(initialValues)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const errors = {
    firstName: values.firstName.trim() ? null : 'Enter a first name.',
    lastName: values.lastName.trim() ? null : 'Enter a last name.',
  }

  function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    if (errors.firstName || errors.lastName) return
    onSave({ firstName: values.firstName.trim(), lastName: values.lastName.trim() })
  }

  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => setValues((current) => ({ ...current, [name]: event.target.value })),
    error: hasSubmitted ? errors[name] ?? undefined : undefined,
  })

  return (
    <form className="edit-name-form" onSubmit={handleSubmit} noValidate>
      <FormField label="First name" autoComplete="given-name" {...field('firstName')} />
      <FormField label="Last name" autoComplete="family-name" {...field('lastName')} />
      <div className="edit-name-form__actions">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export default EditNameForm
