import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router'
import { LuCircleCheck } from 'react-icons/lu'
import FormField, { CheckboxField } from '../components/forms/FormField'
import Button from '../components/ui/Button'
import { registerCustomer, registerDemoCustomer } from '../services/authService'
import { REAL_ACCOUNTS } from '../constants/accounts'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { validateRegistration } from '../utils/validation'
import { withoutField } from '../utils/serverErrors'
import './AuthPages.css'

/*
 * /register — step 1 of sign-up.
 * BuyNest accounts: name, email, phone, password. The server creates the
 * account unconfirmed and emails a 6-digit code; the customer continues on
 * /verify-email. DummyJSON demo: a username instead of a phone, and the
 * account is only simulated.
 */
const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  ...(REAL_ACCOUNTS ? { phone: '' } : { username: '' }),
  password: '',
  confirmPassword: '',
  acceptTerms: false,
}

function RegisterPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [values, setValues] = useState(EMPTY_FORM)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  // Field messages from the server (422), e.g. "An account with this email already exists."
  const [serverErrors, setServerErrors] = useState({})
  // useMutation tracks the request for us: isPending, error, and data.
  const registration = useMutation({
    mutationFn: REAL_ACCOUNTS ? registerCustomer : registerDemoCustomer,
    onSuccess: (result, submitted) => {
      if (!REAL_ACCOUNTS) return // the demo shows its own result below
      navigate(ROUTES.verifyEmail, { state: { email: result.email ?? submitted.email.trim(), resendIn: result.resendIn, from: location.state?.from } })
    },
    onError: (error) => setServerErrors(error.fieldErrors ?? {}),
  })
  const createdDemoUser = REAL_ACCOUNTS ? null : registration.data

  // Shown after the first submit attempt, then live (see LoginPage).
  const errors = validateRegistration(values)
  const visibleError = (field) => (hasSubmitted ? errors[field] : undefined) ?? serverErrors[field]?.[0]

  function handleChange(event) {
    const { name, value, type, checked } = event.target
    setValues((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
    // The server's message was about the old value.
    setServerErrors((current) => withoutField(current, name))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)

    const firstInvalid = Object.keys(errors)[0]
    if (firstInvalid) {
      event.currentTarget.elements[firstInvalid].focus()
      return
    }

    registration.mutate({ ...values, email: values.email.trim() })
  }

  if (createdDemoUser) {
    return (
      <div className="auth-page section container">
        <div className="auth-card" role="status">
          <LuCircleCheck size={40} color="var(--color-success)" aria-hidden="true" />
          <h1 className="auth-card__title">Account request received</h1>
          <p className="auth-alert auth-alert--info">
            <strong>Demo only:</strong> DummyJSON replied with a new user (#{createdDemoUser.id}) but does not save it, so you
            can't sign in as <strong>{createdDemoUser.username}</strong>. Use the demo account on the sign-in page instead.
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
    error: visibleError(name),
  })
  // A 422 with field messages is shown on the fields; anything else up top.
  const generalError = registration.error && !registration.error.fieldErrors ? registration.error.message : null

  return (
    <div className="auth-page section container">
      <title>{`Create account | ${SITE.name}`}</title>
      <div className="auth-card auth-card--wide">
        <header>
          <h1 className="auth-card__title">Create your account</h1>
          <p className="auth-card__subtitle">Track orders, save addresses, and check out faster.</p>
        </header>

        {generalError && (
          <p className="auth-alert auth-alert--error" role="alert">
            {generalError}
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-form__row">
            <FormField label="First name" autoComplete="given-name" {...fieldProps('firstName')} />
            <FormField label="Last name" autoComplete="family-name" {...fieldProps('lastName')} />
          </div>
          <FormField
            label="Email"
            type="email"
            autoComplete="email"
            hint={REAL_ACCOUNTS ? "We'll email you a code to confirm it." : undefined}
            {...fieldProps('email')}
          />
          {REAL_ACCOUNTS ? (
            <FormField
              label="Phone number"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              hint="With the country code, like +880 1712 345678. For delivery updates."
              {...fieldProps('phone')}
            />
          ) : (
            <FormField
              label="Username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              hint="3–30 characters: letters, numbers, dots, dashes, or underscores."
              {...fieldProps('username')}
            />
          )}
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
            error={visibleError('acceptTerms')}
          />
          <Button type="submit" size="lg" fullWidth disabled={registration.isPending}>
            {registration.isPending ? 'Creating account…' : 'Create account'}
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
