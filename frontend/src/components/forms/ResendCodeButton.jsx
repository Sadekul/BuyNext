import { useEffect, useState } from 'react'
import { resendCode } from '../../services/authService'

/**
 * "Send a new code" with a countdown: the server allows one code per minute,
 * so the button waits instead of failing. The announcement is polite (aria-live)
 * so screen reader users hear when a new code was sent.
 */
function ResendCodeButton({ email, purpose, initialWait = 60 }) {
  const [secondsLeft, setSecondsLeft] = useState(initialWait)
  const [status, setStatus] = useState({ sending: false, message: '' })

  const waiting = secondsLeft > 0
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => clearInterval(timer)
  }, [waiting])

  async function handleClick() {
    setStatus({ sending: true, message: '' })
    try {
      const result = await resendCode({ email, purpose })
      setSecondsLeft(result?.resendIn ?? 60)
      setStatus({ sending: false, message: `We sent a new code to ${email}. Earlier codes no longer work.` })
    } catch (error) {
      setStatus({ sending: false, message: error.message })
    }
  }

  return (
    <div className="auth-resend">
      <button type="button" className="auth-link" onClick={handleClick} disabled={waiting || status.sending}>
        {status.sending ? 'Sending…' : waiting ? `Send a new code in ${secondsLeft}s` : 'Send a new code'}
      </button>
      <p className="auth-resend__status" aria-live="polite">
        {status.message}
      </p>
    </div>
  )
}

export default ResendCodeButton
