import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import FormField from '../components/forms/FormField'
import ResendCodeButton from '../components/forms/ResendCodeButton'
import Button from '../components/ui/Button'
import { requestPasswordReset, resetPassword } from '../services/authService'
import { REAL_ACCOUNTS } from '../constants/accounts'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import { validateCode, validateEmail, validateNewPassword } from '../utils/validation'
import { withoutField } from '../utils/serverErrors'
import './AuthPages.css'
import { Trans, useTranslation } from 'react-i18next'

/**
 * /forgot-password
 * BuyNest accounts, in two steps:
 *   1. the customer enters their email; if it has an account we email a
 *      6-digit code (the answer is the same either way, so nobody can use
 *      this page to find out who has an account);
 *   2. they enter the code and a new password. Every device is signed out,
 *      and they sign in again with the new password.
 * DummyJSON demo: SIMULATED. No email is sent (DummyJSON has no reset API).
 */
function ForgotPasswordPage() {
  const { t } = useTranslation('auth')
  const [sent, setSent] = useState(null) // { email, resendIn } after step 1

  return (
    <div className="auth-page section container">
      <title>{`${t('forgot.tabTitle')} | ${SITE.name}`}</title>
      <div className="auth-card">
        {sent ? <ResetStep email={sent.email} resendIn={sent.resendIn} /> : <RequestStep onSent={setSent} />}
        <p className="auth-card__footer">
          <Link to={ROUTES.login} className="auth-link">
            {t('forgot.back')}
          </Link>
        </p>
      </div>
    </div>
  )
}

function RequestStep({ onSent }) {
  const { t } = useTranslation('auth')
  const [email, setEmail] = useState('')
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState(null)
  const [demoSentTo, setDemoSentTo] = useState(null)
  const error = hasSubmitted ? validateEmail(email) : null

  async function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    setServerError(null)
    if (validateEmail(email)) {
      event.currentTarget.elements.email.focus()
      return
    }
    if (!REAL_ACCOUNTS) {
      setDemoSentTo(email.trim())
      return
    }
    setIsSubmitting(true)
    try {
      const result = await requestPasswordReset({ email: email.trim() })
      onSent({ email: email.trim(), resendIn: result?.resendIn })
    } catch (failure) {
      setServerError(failure.message)
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <header>
        <h1 className="auth-card__title">{t('forgot.title')}</h1>
        <p className="auth-card__subtitle">{t('forgot.subtitle')}</p>
      </header>

      {serverError && (
        <p className="auth-alert auth-alert--error" role="alert">
          {serverError}
        </p>
      )}

      {demoSentTo ? (
        <div role="status" className="auth-form">
          <p className="auth-alert auth-alert--success">
            <Trans t={t} i18nKey="forgot.demoSent" values={{ email: demoSentTo }} components={{ strong: <strong /> }} />
          </p>
          <p className="auth-alert auth-alert--info">
            <Trans t={t} i18nKey="forgot.demoNote" components={{ strong: <strong /> }} />
          </p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <FormField
            label={t('forgot.email')}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" size="lg" fullWidth disabled={isSubmitting}>
            {t(isSubmitting ? 'forgot.sending' : 'forgot.send')}
          </Button>
        </form>
      )}
    </>
  )
}

function ResetStep({ email, resendIn }) {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const [values, setValues] = useState({ code: '', password: '', confirmPassword: '' })
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverErrors, setServerErrors] = useState({})
  const [generalError, setGeneralError] = useState(null)

  const codeError = validateCode(values.code)
  const errors = { ...(codeError && { code: codeError }), ...validateNewPassword(values.password, values.confirmPassword) }
  const visibleError = (field) => (hasSubmitted ? errors[field] : undefined) ?? serverErrors[field]?.[0]

  function handleChange(event) {
    const { name, value } = event.target
    setValues((current) => ({ ...current, [name]: name === 'code' ? value.replace(/\D/g, '').slice(0, 6) : value }))
    setServerErrors((current) => withoutField(current, name))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    setGeneralError(null)
    const firstInvalid = Object.keys(errors)[0]
    if (firstInvalid) {
      event.currentTarget.elements[firstInvalid].focus()
      return
    }
    setIsSubmitting(true)
    try {
      await resetPassword({ email, ...values })
      navigate(ROUTES.login, { replace: true, state: { notice: t('forgot.changed') } })
    } catch (failure) {
      if (failure.fieldErrors) setServerErrors(failure.fieldErrors)
      else setGeneralError(failure.message)
      setIsSubmitting(false)
    }
  }

  const fieldProps = (name) => ({ name, value: values[name], onChange: handleChange, error: visibleError(name) })

  return (
    <>
      <header>
        <h1 className="auth-card__title">{t('forgot.newTitle')}</h1>
        <p className="auth-card__subtitle" role="status">
          <Trans t={t} i18nKey="forgot.emailed" values={{ email }} components={{ strong: <strong /> }} />
        </p>
      </header>

      {generalError && (
        <p className="auth-alert auth-alert--error" role="alert">
          {generalError}
        </p>
      )}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <FormField label={t('forgot.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="auth-code" {...fieldProps('code')} />
        <FormField
          label={t('forgot.newPassword')}
          type="password"
          revealable
          autoComplete="new-password"
          hint={t('forgot.passwordHint')}
          {...fieldProps('password')}
        />
        <FormField label={t('forgot.confirm')} type="password" revealable autoComplete="new-password" {...fieldProps('confirmPassword')} />
        <Button type="submit" size="lg" fullWidth disabled={isSubmitting}>
          {t(isSubmitting ? 'forgot.saving' : 'forgot.save')}
        </Button>
      </form>

      <ResendCodeButton email={email} purpose="reset_password" initialWait={resendIn ?? 60} />
    </>
  )
}

export default ForgotPasswordPage
