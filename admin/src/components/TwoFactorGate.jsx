import { useEffect, useRef, useState } from 'react'
import { LuShieldCheck } from 'react-icons/lu'
import { useAdminAuth } from '../auth/useAdminAuth'
import TwoFactorSetup from './TwoFactorSetup'

/**
 * Phase 9 §1: the store requires two-step sign-in, and this admin hasn't set
 * it up. The password was right, but the session can only reach enrolment
 * and the profile until it's done, so this screen replaces the whole admin.
 */
function TwoFactorGate() {
  const { user, reloadUser, signOut } = useAdminAuth()
  const heading = useRef(null)
  const [problem, setProblem] = useState(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  async function finished() {
    setProblem(null)
    // Two-step is on by now; only loading the account again is left. A short
    // network blip shouldn't cost the admin a fresh sign-in, so try a few times.
    for (let attempt = 1; ; attempt++) {
      try {
        const next = await reloadUser()
        // Still limited (the API wants a fresh sign-in with the new code): sign in again.
        if (next?.twoFactorSetupRequired === true) signOut()
        return
      } catch (error) {
        if (error?.status === 401) {
          // The session itself is gone: signing in again (password + code) is the only way back.
          signOut()
          return
        }
        if (attempt >= 3) {
          setProblem("Two-step sign-in is on, but your account didn't load. Check your connection and try again.")
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
      }
    }
  }

  return (
    <main className="gate gate--wide">
      <title>Set up two-step sign-in | BuyNest Admin</title>
      <section className="gate__card" aria-labelledby="two-step-gate-title">
        <LuShieldCheck className="gate__icon" aria-hidden="true" />
        <h1 id="two-step-gate-title" ref={heading} tabIndex={-1}>
          Set up two-step sign-in
        </h1>
        <p>
          This store requires two-step sign-in for every admin. Set it up now to continue: you'll need an authenticator app on your phone. You can't use the
          rest of the admin until it's on.
        </p>
        {problem && (
          <div className="form-error" role="alert">
            <p>{problem}</p>
            <button type="button" className="btn btn--outline" onClick={finished}>
              Try again
            </button>
          </div>
        )}
        <TwoFactorSetup email={user?.email} onFinished={finished} />
        <button type="button" className="link-button gate__back" onClick={signOut}>
          Sign out
        </button>
      </section>
    </main>
  )
}

export default TwoFactorGate
