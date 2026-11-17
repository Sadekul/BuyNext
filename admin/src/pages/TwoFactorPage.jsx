import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { disableTwoFactor, regenerateRecoveryCodes } from '../api/security'
import { useAdminAuth } from '../auth/useAdminAuth'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import RecoveryCodes from '../components/RecoveryCodes'
import StatusBadge from '../components/StatusBadge'
import TwoFactorSetup from '../components/TwoFactorSetup'
import { actionErrorMessage } from '../utils/permissions'
import { sixDigits } from '../utils/twoFactor'

const firstFieldError = (error) => (error?.fieldErrors ? Object.values(error.fieldErrors)[0]?.[0] : null)

/**
 * Account → Two-step sign-in (phase 9 §1): every admin, no permission needed.
 * Off: set it up (QR code or key, confirm, recovery codes). On: new recovery
 * codes (password), or turn it off (password and a code), which the store
 * refuses while it requires two-step for every admin.
 */
function TwoFactorPage() {
  const { user, reloadUser } = useAdminAuth()
  const [notice, setNotice] = useState(null)
  const noticeRef = useRef(null)
  const enabled = user?.twoFactorEnabled === true

  function announce(text, tone = 'success') {
    setNotice({ text, tone })
    requestAnimationFrame(() => noticeRef.current?.focus())
  }

  return (
    <>
      <title>Two-step sign-in | BuyNest Admin</title>
      <PageHeader title="Two-step sign-in" description="A code from an authenticator app on your phone, asked after your password. Someone who learns your password still can't sign in." />
      <div role={notice?.tone === 'error' ? 'alert' : 'status'}>
        {notice && (
          <p ref={noticeRef} tabIndex={-1} className={notice.tone === 'success' ? 'notice notice--success' : 'form-error'}>
            {notice.text}
          </p>
        )}
      </div>

      <section className="panel panel--padded" aria-labelledby="two-step-status">
        <h2 id="two-step-status" className="panel__title">
          Status
        </h2>
        <p>
          <StatusBadge tone={enabled ? 'success' : 'neutral'} label={enabled ? 'On' : 'Off'} />{' '}
          {enabled ? 'You enter a code from your app each time you sign in.' : 'You sign in with your password only.'}
        </p>
        {enabled && Number.isInteger(user?.recoveryCodesLeft) && (
          <p className={user.recoveryCodesLeft <= 3 ? 'form-error' : 'muted'}>
            {user.recoveryCodesLeft === 1 ? '1 recovery code left.' : `${user.recoveryCodesLeft} recovery codes left.`}
            {user.recoveryCodesLeft <= 3 && ' Get a new set below.'}
          </p>
        )}
        {user?.twoFactorRequiredByStore && <p className="muted">This store requires two-step sign-in for every admin.</p>}
      </section>

      {enabled ? (
        <>
          <NewRecoveryCodes
            email={user?.email}
            onDone={async () => {
              await reloadUser().catch(() => {})
              announce('Your new recovery codes are saved. The old ones no longer work.')
            }}
          />
          <TurnOff
            blocked={user?.twoFactorRequiredByStore === true}
            onDone={async () => {
              await reloadUser().catch(() => {})
              announce('Two-step sign-in is off. You sign in with your password only.')
            }}
          />
        </>
      ) : (
        <section className="panel panel--padded" aria-labelledby="two-step-setup">
          <h2 id="two-step-setup" className="panel__title">
            Set up
          </h2>
          <TwoFactorSetup
            email={user?.email}
            onFinished={async () => {
              await reloadUser().catch(() => {})
              announce('Two-step sign-in is on. You will be asked for a code each time you sign in.')
            }}
          />
        </section>
      )}
    </>
  )
}

/** A new set of recovery codes; the old ones stop working. */
function NewRecoveryCodes({ email, onDone }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const regenerate = useMutation({
    mutationFn: () => regenerateRecoveryCodes(password),
    onSuccess: () => setPassword(''),
    onError: (failure) => setError(firstFieldError(failure) ?? actionErrorMessage(failure)),
  })

  if (regenerate.data) {
    return (
      <section className="panel panel--padded">
        <RecoveryCodes
          codes={regenerate.data.recoveryCodes ?? []}
          email={email}
          onDone={() => {
            regenerate.reset()
            onDone()
          }}
        />
      </section>
    )
  }
  return (
    <form
      className="panel panel--padded form"
      aria-labelledby="two-step-recovery"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (!password) return setError('Enter your password.')
        setError(null)
        regenerate.mutate()
      }}
    >
      <h2 id="two-step-recovery" className="panel__title">
        Recovery codes
      </h2>
      <p className="muted">Lost your codes, or used most of them? Get a new set. The old codes stop working right away.</p>
      <Field label="Your password" error={error}>
        {(a11y) => <input {...a11y} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
      </Field>
      <div className="form__actions">
        <button type="submit" className="btn btn--outline" disabled={regenerate.isPending}>
          {regenerate.isPending ? 'Working…' : 'Get new recovery codes'}
        </button>
      </div>
    </form>
  )
}

/** Turns two-step off: the password and a current code (or the store says no while it's required). */
function TurnOff({ blocked, onDone }) {
  const [values, setValues] = useState({ password: '', code: '' })
  const [errors, setErrors] = useState({})
  const turnOff = useMutation({
    mutationFn: () => disableTwoFactor(values.password, sixDigits(values.code)),
    onSuccess: onDone,
    // Password and code on their fields; anything else ("the store requires two-step…") above them.
    onError: (failure) => {
      const { password, code, ...other } = failure.fieldErrors ?? {}
      const formError = Object.values(other)[0]?.[0] ?? (failure.fieldErrors ? null : actionErrorMessage(failure))
      setErrors({ ...(password && { password }), ...(code && { code }), ...(formError && { form: [formError] }) })
    },
  })
  const set = (field) => (event) => setValues({ ...values, [field]: event.target.value })

  if (blocked) {
    return (
      <section className="panel panel--padded" aria-labelledby="two-step-off">
        <h2 id="two-step-off" className="panel__title">
          Turn off
        </h2>
        <p className="muted">Two-step sign-in can't be turned off while the store requires it. The Owner can change this under Settings → Security.</p>
      </section>
    )
  }
  return (
    <form
      className="panel panel--padded form"
      aria-labelledby="two-step-off"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const found = {}
        if (!values.password) found.password = ['Enter your password.']
        if (!sixDigits(values.code)) found.code = ['Enter the 6-digit code your app shows now.']
        setErrors(found)
        if (Object.keys(found).length === 0) turnOff.mutate()
      }}
    >
      <h2 id="two-step-off" className="panel__title">
        Turn off
      </h2>
      <p className="muted">Your account is then protected by your password only. Your recovery codes stop working.</p>
      {errors.form && (
        <p className="form-error" role="alert">
          {errors.form[0]}
        </p>
      )}
      <div className="form__grid">
        <Field label="Your password" error={errors.password?.[0]}>
          {(a11y) => <input {...a11y} type="password" autoComplete="current-password" value={values.password} onChange={set('password')} />}
        </Field>
        <Field label="6-digit code from your app" error={errors.code?.[0]}>
          {(a11y) => <input {...a11y} className="code-input" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]*" maxLength={7} value={values.code} onChange={set('code')} />}
        </Field>
      </div>
      <div className="form__actions">
        <button type="submit" className="btn btn--danger" disabled={turnOff.isPending}>
          {turnOff.isPending ? 'Working…' : 'Turn off two-step sign-in'}
        </button>
      </div>
    </form>
  )
}

export default TwoFactorPage
