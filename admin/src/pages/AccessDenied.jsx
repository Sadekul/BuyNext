import { LuShieldX } from 'react-icons/lu'
import { useAdminAuth } from '../auth/useAdminAuth'

/**
 * The server refused this admin session (403): the account was disabled, or
 * it lost its admin role. The API refuses every admin request too.
 */
function AccessDenied() {
  const { signOut } = useAdminAuth()
  return (
    <main className="gate">
      <title>No admin access | BuyNest Admin</title>
      <div className="gate__card">
        <LuShieldX className="gate__icon" aria-hidden="true" />
        <h1>No admin access</h1>
        <p>This account can't open the shop dashboard. It may have been disabled; ask another admin to check it.</p>
        <div className="gate__actions">
          <a href="/" className="btn btn--outline">
            Back to the store
          </a>
          <button type="button" className="btn btn--primary" onClick={signOut}>
            Sign in with another account
          </button>
        </div>
      </div>
    </main>
  )
}

export default AccessDenied
