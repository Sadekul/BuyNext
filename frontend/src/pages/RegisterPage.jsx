import { useState } from 'react'
import { Link } from 'react-router'
import { LuCircleCheck } from 'react-icons/lu'
import FormField, { CheckboxField } from '../components/forms/FormField'
import Button from '../components/ui/Button'
import { registerCustomer } from '../services/authService'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { validateRegistration } from '../utils/validation'
import './AuthPages.css'

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  username: '',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
}

function RegisterPage() {
  const [values, setValues] = useState(EMPTY_FORM)
  const [touched, setTouched] = useState({})
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState(null)
  const [createdUser, setCreatedUser] = useState(null)

  const errors = validateRegistration(values)
  const visibleError = (field) => (touched[field] || hasSubmitted ? errors[field] : undefined)

  function handleChange(event) {
    const { name, value, type, checked } = event.target
    setValues((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  function handleBlur(event) {
    setTouched((current) => ({ ...current, [event.target.name]: true }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    setServerError(null)

    const firstInvalid = Object.keys(errors)[0]
    if (firstInvalid) {
      event.currentTarget.elements[firstInvalid].focus()
      return
    }

    setIsSubmitting(true)
    try {
      setCreatedUser(await registerCustomer(values))
    } catch (error) {
      setServerError(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (createdUser) {
    return (
      <div className="auth-page section container">
        <div className="auth-card" role="status">
          <LuCircleCheck size={40} color="var(--color-success)" aria-hidden="true" />
          <h1 className="auth-card__title">Account request received</h1>
          <p className="auth-alert auth-alert--info">
            <strong>Demo only:</strong> DummyJSON replied with a new user (#{createdUser.id}) but does not save it, so you
            can't sign in as <strong>{createdUser.username}</strong>. Use the demo account on the sign-in page instead.
          </p>
          <Button to={ROUTES.login} size="lg" fullWidth>
            Go to sign in
          </Button>
        </div>
      </div>
    )
  }

  const fieldProps = (name) => ({
    name,
    value: values[name],
    onChange: handleChange,
    onBlur: handleBlur,
    error: visibleError(name),
  })

  return (
    <div className="auth-page section container">
      <title>{`Create account | ${SITE.name}`}</title>
      <div className="auth-card auth-card--wide">
        <header>
          <h1 className="auth-card__title">Create your account</h1>
          <p className="auth-card__subtitle">Track orders, save addresses, and check out faster.</p>
        </header>

        {serverError && (
          <p className="auth-alert auth-alert--error" role="alert">
            {serverError}
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-form__row">
            <FormField label="First name" autoComplete="given-name" {...fieldProps('firstName')} />
            <FormField label="Last name" autoComplete="family-name" {...fieldProps('lastName')} />
          </div>
          <FormField label="Email" type="email" autoComplete="email" {...fieldProps('email')} />
          <FormField
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            hint="3–30 characters: letters, numbers, dots, dashes, or underscores."
            {...fieldProps('username')}
          />
          <FormField
            label="Password"
            type="password"
            revealable
            autoComplete="new-password"
            hint="At least 8 characters, including a letter and a number."
            {...fieldProps('password')}
          />
          <FormField label="Confirm password" type="password" revealable autoComplete="new-password" {...fieldProps('confirmPassword')} />
          <CheckboxField
            label="I agree to the terms of service and privacy policy."
            name="acceptTerms"
            checked={values.acceptTerms}
            onChange={handleChange}
            onBlur={handleBlur}
            error={visibleError('acceptTerms')}
          />
          <Button type="submit" size="lg" fullWidth disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="auth-card__footer">
          Already have an account?{' '}
          <Link to={ROUTES.login} className="auth-link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default RegisterPage
