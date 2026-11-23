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
import { Trans, useTranslation } from 'react-i18next'

/**
 * /verify-email — step 2 of sign-up: the customer types the 6-digit code we
 * emailed. The right code confirms the email and signs them in. Arrives here
 * from the sign-up page, or from sign-in when the email isn't confirmed yet
 * (location.state carries { email, resendIn, from }).
 */
function VerifyEmailPage() {
  const { t } = useTranslation('auth')
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
        <title>{`${t('verify.tabTitle')} | ${SITE.name}`}</title>
        <div className="auth-card">
          <h1 className="auth-card__title">{t('verify.title')}</h1>
          <p className="auth-card__subtitle">
            <Trans
              t={t}
              i18nKey="verify.start"
              components={{ register: <Link to={ROUTES.register} className="auth-link" />, signin: <Link to={ROUTES.login} className="auth-link" /> }}
            />
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
      <title>{`${t('verify.tabTitle')} | ${SITE.name}`}</title>
      <div className="auth-card">
        <header>
          <LuMailCheck size={40} color="var(--color-primary)" aria-hidden="true" />
          <h1 className="auth-card__title">{t('verify.check')}</h1>
          <p className="auth-card__subtitle">
            <Trans t={t} i18nKey="verify.sent" values={{ email }} components={{ strong: <strong /> }} />
          </p>
        </header>

        {serverError?.alert && (
          <p className="auth-alert auth-alert--error" role="alert">
            {serverError.alert}
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <FormField
            label={t('verify.code')}
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            error={error}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="auth-code"
          />
          <CheckboxField label={t('verify.remember')} name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <Button type="submit" size="lg" fullWidth disabled={isSubmitting}>
            {t(isSubmitting ? 'verify.confirming' : 'verify.submit')}
          </Button>
        </form>

        <ResendCodeButton email={email} purpose="verify_email" initialWait={location.state?.resendIn ?? 60} />

        <p className="auth-card__footer">
          {t('verify.wrong')}{' '}
          <Link to={ROUTES.register} className="auth-link">
            {t('verify.again')}
          </Link>
        </p>
      </div>
    </div>
  )
}

export default VerifyEmailPage
