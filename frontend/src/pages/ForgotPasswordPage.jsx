import { useState } from 'react'
import { Link } from 'react-router'
import FormField from '../components/forms/FormField'
import Button from '../components/ui/Button'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { validateEmail } from '../utils/validation'
import './AuthPages.css'

/**
 * Password reset request — SIMULATED. DummyJSON has no reset endpoint, so no
 * email is sent. The confirmation wording is what a real store should show:
 * it never reveals whether an account exists for that address.
 */
function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [sentTo, setSentTo] = useState(null)
  const error = hasSubmitted ? validateEmail(email) : null

  function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    if (validateEmail(email)) {
      event.currentTarget.elements.email.focus()
      return
    }
    setSentTo(email.trim())
  }

  return (
    <div className="auth-page section container">
      <title>{`Reset password | ${SITE.name}`}</title>
      <div className="auth-card">
        <header>
          <h1 className="auth-card__title">Reset your password</h1>
          <p className="auth-card__subtitle">Enter your email and we'll send you a link to choose a new password.</p>
        </header>

        {sentTo ? (
          <div role="status" className="auth-form">
            <p className="auth-alert auth-alert--success">
              If an account exists for <strong>{sentTo}</strong>, you'll receive a reset link shortly.
            </p>
            <p className="auth-alert auth-alert--info">
              <strong>Demo only:</strong> no email was sent. DummyJSON has no password-reset API.
            </p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <FormField
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={error ?? undefined}
            />
            <Button type="submit" size="lg" fullWidth>
              Send reset link
            </Button>
          </form>
        )}

        <p className="auth-card__footer">
          <Link to={ROUTES.login} className="auth-link">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default ForgotPasswordPage
