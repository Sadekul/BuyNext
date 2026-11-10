import { LuShieldX } from 'react-icons/lu'
import { useAdminAuth } from '../auth/useAdminAuth'
import { fullName } from '../utils/format'

/** Signed in, but with a customer account: no admin access (the API says 403 too). */
function AccessDenied({ user }) {
  const { signOut } = useAdminAuth()
  return (
    <main className="gate">
      <title>No admin access | BuyNest Admin</title>
      <div className="gate__card">
        <LuShieldX className="gate__icon" aria-hidden="true" />
        <h1>No admin access</h1>
        <p>
          You're signed in as <strong>{fullName(user) || user?.username || 'a customer'}</strong>, which is a customer
          account. The shop dashboard is only for admin accounts.
        </p>
        <div className="gate__actions">
          <a href="/" className="btn btn--outline">
            Back to the store
          </a>
          <button type="button" className="btn btn--primary" onClick={signOut}>
            Sign in with an admin account
          </button>
        </div>
      </div>
    </main>
  )
}

export default AccessDenied
