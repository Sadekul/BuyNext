import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { LuLock, LuShieldCheck } from 'react-icons/lu'
import { DEMO_ADMIN, ID_FIELD } from '../auth/accounts'
import { useAdminAuth } from '../auth/useAdminAuth'
import { Loading } from '../components/States'
import { sixDigits } from '../utils/twoFactor'

/** Same-app paths only: never "//other-site" (open redirect). */
const safePath = (path) => (typeof path === 'string' && /^\/(?![/\\])/.test(path) ? path : '/')

function LoginPage() {
  const { status, signIn } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [values, setValues] = useState({ [ID_FIELD.name]: '', password: '', remember: false })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Phase 9: the second step, after a correct password with two-step on ({ challenge, expiresAt, remember }).
  const [challenge, setChallenge] = useState(null)
  const firstField = useRef(null)
  const [backToPassword, setBackToPassword] = useState(false)

  // Coming back from the second step: the password field again, with focus.
  useEffect(() => {
    if (backToPassword) firstField.current?.focus()
  }, [backToPassword])

  if (status === 'checking') {
    return (
      <main>
        <Loading label="Checking your access…" />
      </main>
    )
  }
  if (status === 'admin') return <Navigate to={safePath(location.state?.from)} replace />

  async function handleSubmit(event) {
    event.preventDefault()
    if (!values[ID_FIELD.name].trim() || !values.password) {
      setError(`Enter your ${ID_FIELD.label.toLowerCase()} and password.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await signIn(values)
      if (next?.twoFactorRequired) {
        setChallenge({ challenge: next.challenge, expiresAt: next.expiresAt, remember: values.remember })
        setValues((current) => ({ ...current, password: '' }))
        setBusy(false)
        return
      }
      navigate(safePath(location.state?.from), { replace: true })
    } catch (signInError) {
      setError(signInError.message)
      setBusy(false)
    }
  }

  const update = (event) => {
    const { name, value, type, checked } = event.target
    setValues((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  if (challenge) {
    return (
      <TwoStepForm
        challenge={challenge}
        onDone={() => navigate(safePath(location.state?.from), { replace: true })}
        onRestart={(message) => {
          setChallenge(null)
          setError(message)
          setBackToPassword(true)
        }}
      />
    )
  }

  return (
    <main className="gate">
      <title>Sign in | BuyNest Admin</title>
      <form className="gate__card" onSubmit={handleSubmit} noValidate>
        <LuLock className="gate__icon" aria-hidden="true" />
        <h1>BuyNest Admin</h1>
        <p>Sign in with your shop admin account. Customer accounts can't sign in here.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span>{ID_FIELD.label}</span>
          <input
            ref={firstField}
            name={ID_FIELD.name}
            type={ID_FIELD.type}
            autoComplete={ID_FIELD.autoComplete}
            autoCapitalize="none"
            spellCheck={false}
            value={values[ID_FIELD.name]}
            onChange={update}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" value={values.password} onChange={update} />
        </label>
        <label className="checkbox">
          <input type="checkbox" name="remember" checked={values.remember} onChange={update} />
          <span>Keep me signed in (trusted devices only)</span>
        </label>
        <button type="submit" className="btn btn--primary btn--full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {DEMO_ADMIN && (
          <p className="gate__hint">
            Demo admin: <code>{DEMO_ADMIN[ID_FIELD.name]}</code> / <code>{DEMO_ADMIN.password}</code>
            <button type="button" className="link-button" onClick={() => setValues((current) => ({ ...current, ...DEMO_ADMIN }))}>
              Use it
            </button>
          </p>
        )}
        <a href="/" className="gate__back">
          Back to the store
        </a>
      </form>
    </main>
  )
}

// The challenge can no longer be used (expired, used, or burned after too many wrong codes).
// (The API answers 422 with errors.challenge: "This sign-in has expired…" / "Too many wrong codes…".)
const isChallengeOver = (error) => Boolean(error.fieldErrors?.challenge) || error.status === 401 || error.status === 410

/**
 * Phase 9: the sign-in's second step. A 6-digit code from the authenticator
 * app, or one of the recovery codes. The session cookies are set only when
 * this succeeds; the challenge is valid for 5 minutes and burned after 5
 * wrong codes, which sends the admin back to the password.
 */
function TwoStepForm({ challenge, onDone, onRestart }) {
  const { verifyTwoFactor } = useAdminAuth()
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  // Focus the code field when the step opens and when switching code type.
  useEffect(() => {
    input.current?.focus()
  }, [useRecovery])

  async function handleSubmit(event) {
    event.preventDefault()
    const value = useRecovery ? code.trim() : sixDigits(code)
    if (useRecovery ? value.length < 6 : !value) {
      setError(useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.')
      input.current?.focus()
      return
    }
    if (challenge.expiresAt && Date.parse(challenge.expiresAt) < Date.now()) {
      onRestart('That took too long. Enter your password again.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await verifyTwoFactor({ challenge: challenge.challenge, remember: challenge.remember, ...(useRecovery ? { recoveryCode: value } : { code: value }) })
      onDone()
    } catch (verifyError) {
      setBusy(false)
      if (isChallengeOver(verifyError)) {
        onRestart(verifyError.fieldErrors?.challenge?.[0] ?? 'Please sign in again.')
        return
      }
      setError(verifyError.fieldErrors ? Object.values(verifyError.fieldErrors)[0][0] : verifyError.message)
      setCode('')
      input.current?.focus()
    }
  }

  const fieldId = useRecovery ? 'two-step-recovery' : 'two-step-code'
  return (
    <main className="gate">
      <title>Two-step sign-in | BuyNest Admin</title>
      <form className="gate__card" onSubmit={handleSubmit} noValidate aria-labelledby="two-step-title">
        <LuShieldCheck className="gate__icon" aria-hidden="true" />
        <h1 id="two-step-title">Two-step sign-in</h1>
        <p>{useRecovery ? 'Enter one of the recovery codes you saved when you set up two-step sign-in. Each code works once.' : 'Enter the 6-digit code from your authenticator app.'}</p>
        <div role="alert">{error && <p className="form-error">{error}</p>}</div>
        <div className="field">
          <label htmlFor={fieldId}>{useRecovery ? 'Recovery code' : 'Authentication code'}</label>
          {useRecovery ? (
            <input
              ref={input}
              id={fieldId}
              name="recoveryCode"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={40}
              value={code}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setCode(event.target.value)}
            />
          ) : (
            <input
              ref={input}
              id={fieldId}
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9 ]*"
              maxLength={7}
              className="code-input"
              value={code}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setCode(event.target.value)}
            />
          )}
        </div>
        <button type="submit" className="btn btn--primary btn--full" disabled={busy}>
          {busy ? 'Checking…' : 'Verify and sign in'}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setUseRecovery(!useRecovery)
            setCode('')
            setError(null)
          }}
        >
          {useRecovery ? 'Use a code from the app instead' : 'Use a recovery code'}
        </button>
        <button type="button" className="link-button gate__back" onClick={() => onRestart(null)}>
          Back to sign in
        </button>
      </form>
    </main>
  )
}

export default LoginPage
