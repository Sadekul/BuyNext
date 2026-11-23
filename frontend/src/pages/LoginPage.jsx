import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import FormField, { CheckboxField } from '../components/forms/FormField'
import Button from '../components/ui/Button'
import { useAuth } from '../hooks/useAuth'
import { ApiError } from '../services/apiClient'
import { DEMO_ACCOUNT, REAL_ACCOUNTS } from '../constants/accounts'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { safeRedirectPath } from '../utils/safeRedirect'
import { validateLogin } from '../utils/validation'
import './AuthPages.css'
import { useTranslation } from 'react-i18next'

// BuyNest accounts sign in with an email; DummyJSON's demo users with a username.
const ID_FIELD = REAL_ACCOUNTS
  ? { name: 'email', labelKey: 'login.email', type: 'email', autoComplete: 'email' }
  : { name: 'username', labelKey: 'login.username', type: 'text', autoComplete: 'username' }

function LoginPage() {
  const { t } = useTranslation('auth')
  const { login, sessionExpired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Where the customer was going before ProtectedRoute sent them here.
  const redirectTo = safeRedirectPath(location.state?.from?.pathname)

  const [values, setValues] = useState({ [ID_FIELD.name]: '', password: '', remember: true })
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState(null)

  // Errors are derived from the values. They're shown after the first submit
  // attempt and then update live as the customer types. (Showing them on
  // blur shifted the layout mid-click, so clicks on the button were lost.)
  const errors = validateLogin(values)
  const visibleError = (field) => (hasSubmitted ? errors[field] : undefined)

  function handleChange(event) {
    const { name, value, type, checked } = event.target
    setValues((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    setServerError(null)

    const firstInvalid = Object.keys(errors)[0]
    if (firstInvalid) {
      event.currentTarget.elements[firstInvalid].focus() // take keyboard users to the problem
      return
    }

    setIsSubmitting(true)
    try {
      await login(values)
      navigate(redirectTo, { replace: true })
    } catch (error) {
      // Right password, but the email isn't confirmed yet: a new code was
      // emailed, so continue on the code page.
      if (error instanceof ApiError && error.status === 403 && error.data?.code === 'email_unverified') {
        navigate(ROUTES.verifyEmail, {
          state: { email: error.data.data?.email ?? values.email, resendIn: error.data.data?.resendIn, from: location.state?.from },
        })
        return
      }
      setServerError(error.message) // e.g. "The email or password is incorrect."
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-page section container">
      <title>{`${t('login.tabTitle')} | ${SITE.name}`}</title>
      <div className="auth-card">
        <header>
          <h1 className="auth-card__title">{t('login.title')}</h1>
          <p className="auth-card__subtitle">{t('login.subtitle')}</p>
        </header>

        {location.state?.notice && !serverError && (
          <p className="auth-alert auth-alert--success" role="status">
            {location.state.notice}
          </p>
        )}
        {sessionExpired && !serverError && !location.state?.notice && (
          <p className="auth-alert auth-alert--info" role="status">
            {t('login.expired')}
          </p>
        )}
        {serverError && (
          <p className="auth-alert auth-alert--error" role="alert">
            {serverError}
          </p>
        )}

        {DEMO_ACCOUNT && (
          <div className="auth-demo">
            <span>
              {t('login.demo')} <code>{DEMO_ACCOUNT[ID_FIELD.name]}</code> / <code>{DEMO_ACCOUNT.password}</code>
            </span>
            <button type="button" className="auth-link" onClick={() => setValues((current) => ({ ...current, ...DEMO_ACCOUNT }))}>
              {t('login.useDemo')}
            </button>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <FormField
            label={t(ID_FIELD.labelKey)}
            name={ID_FIELD.name}
            type={ID_FIELD.type}
            value={values[ID_FIELD.name]}
            onChange={handleChange}
            error={visibleError(ID_FIELD.name)}
            autoComplete={ID_FIELD.autoComplete}
            autoCapitalize="none"
            spellCheck={false}
          />
          <FormField
            label={t('login.password')}
            name="password"
            type="password"
            revealable
            value={values.password}
            onChange={handleChange}
            error={visibleError('password')}
            autoComplete="current-password"
          />
          <div className="auth-form__options">
            <CheckboxField label={t('login.remember')} name="remember" checked={values.remember} onChange={handleChange} />
            <Link to={ROUTES.forgotPassword} className="auth-link">
              {t('login.forgot')}
            </Link>
          </div>
          <Button type="submit" size="lg" fullWidth disabled={isSubmitting}>
            {t(isSubmitting ? 'login.signingIn' : 'login.submit')}
          </Button>
        </form>

        <p className="auth-card__footer">
          {t('login.newTo', { store: SITE.name })}{' '}
          <Link to={ROUTES.register} className="auth-link">
            {t('login.create')}
          </Link>
        </p>
      </div>
    </div>
  )
}

export default LoginPage
