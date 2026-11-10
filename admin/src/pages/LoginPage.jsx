import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { LuLock } from 'react-icons/lu'
import { DEMO_ADMIN, ID_FIELD } from '../auth/accounts'
import { useAdminAuth } from '../auth/useAdminAuth'
import { Loading } from '../components/States'

/** Same-app paths only: never "//other-site" (open redirect). */
const safePath = (path) => (typeof path === 'string' && /^\/(?![/\\])/.test(path) ? path : '/')

function LoginPage() {
  const { status, signIn } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [values, setValues] = useState({ [ID_FIELD.name]: '', password: '', remember: false })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

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
      await signIn(values)
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

export default LoginPage
