import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { LuMailCheck } from 'react-icons/lu'
import FormField, { CheckboxField } from '../components/forms/FormField'
import ResendCodeButton from '../components/forms/ResendCodeButton'
import Button from '../components/ui/Button'
import { useAuth } from '../hooks/useAuth'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { validateCode } from '../utils/validation'
import { safeRedirectPath } from '../utils/safeRedirect'
import './AuthPages.css'

/**
 * /verify-email — step 2 of sign-up: the customer types the 6-digit code we
 * emailed. The right code confirms the email and signs them in. Arrives here
 * from the sign-up page, or from sign-in when the email isn't confirmed yet
 * (location.state carries { email, resendIn, from }).
 */
function VerifyEmailPage() {
  const { verifyEmail } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const email = location.state?.email
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState(null)

  if (!email) {
    return (
      <div className="auth-page section container">
        <title>{`Confirm your email | ${SITE.name}`}</title>
        <div className="auth-card">
          <h1 className="auth-card__title">Confirm your email</h1>
          <p className="auth-card__subtitle">
            Start by <Link to={ROUTES.register} className="auth-link">creating an account</Link> or{' '}
            <Link to={ROUTES.login} className="auth-link">signing in</Link>: we'll email you a code.
          </p>
        </div>
      </div>
    )
  }

  const error = hasSubmitted ? (validateCode(code) ?? serverError?.field) : serverError?.field

  async function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    setServerError(null)
    if (validateCode(code)) {
      event.currentTarget.elements.code.focus()
      return
    }
    setIsSubmitting(true)
    try {
      await verifyEmail({ email, code: code.trim(), remember })
      navigate(safeRedirectPath(location.state?.from?.pathname), { replace: true })
    } catch (failure) {
      const fieldMessage = failure.fieldErrors?.code?.[0]
      setServerError(fieldMessage ? { field: fieldMessage } : { alert: failure.message })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-page section container">
      <title>{`Confirm your email | ${SITE.name}`}</title>
      <div className="auth-card">
        <header>
          <LuMailCheck size={40} color="var(--color-primary)" aria-hidden="true" />
          <h1 className="auth-card__title">Check your email</h1>
          <p className="auth-card__subtitle">
            We sent a 6-digit code to <strong>{email}</strong>. Enter it below to confirm your email. The code expires in 10 minutes.
          </p>
        </header>

        {serverError?.alert && (
          <p className="auth-alert auth-alert--error" role="alert">
            {serverError.alert}
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <FormField
            label="6-digit code"
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            error={error}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="auth-code"
          />
          <CheckboxField label="Keep me signed in" name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <Button type="submit" size="lg" fullWidth disabled={isSubmitting}>
            {isSubmitting ? 'Confirming…' : 'Confirm and sign in'}
          </Button>
        </form>

        <ResendCodeButton email={email} purpose="verify_email" initialWait={location.state?.resendIn ?? 60} />

        <p className="auth-card__footer">
          Wrong email?{' '}
          <Link to={ROUTES.register} className="auth-link">
            Sign up again
          </Link>
        </p>
      </div>
    </div>
  )
}

export default VerifyEmailPage
