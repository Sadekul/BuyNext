import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuCopy } from 'react-icons/lu'
import { confirmTwoFactor, startTwoFactor } from '../api/security'
import { actionErrorMessage } from '../utils/permissions'
import { groupKey, qrImageSource, sixDigits } from '../utils/twoFactor'
import RecoveryCodes from './RecoveryCodes'

/**
 * Turning two-step sign-in on: start (the server makes a new key), scan the
 * QR code or type the key, confirm with a code from the app, then save the
 * recovery codes (shown once). `onFinished` runs after "I saved them".
 */
function TwoFactorSetup({ email, onFinished, autoStart = false }) {
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState(null)
  const [copied, setCopied] = useState(null)
  const codeInput = useRef(null)
  const scanHeading = useRef(null)

  const start = useMutation({ mutationFn: startTwoFactor })
  const confirm = useMutation({
    mutationFn: confirmTwoFactor,
    onError: (error) => {
      setCodeError(error.fieldErrors ? Object.values(error.fieldErrors)[0][0] : actionErrorMessage(error))
      setCode('')
      codeInput.current?.focus()
    },
  })

  const { mutate: begin } = start
  useEffect(() => {
    if (autoStart) begin()
  }, [autoStart, begin])

  // The key arrived: move focus to the instructions.
  useEffect(() => {
    if (start.data) scanHeading.current?.focus()
  }, [start.data])

  if (confirm.data) return <RecoveryCodes codes={confirm.data.recoveryCodes ?? []} email={email} onDone={onFinished} doneLabel="Continue" />

  if (!start.data) {
    return (
      <div className="two-step__start">
        <div role={start.error ? 'alert' : 'status'}>
          {start.isPending && <p className="muted">Making your key…</p>}
          {start.error && <p className="form-error">{actionErrorMessage(start.error)}</p>}
        </div>
        {!start.isPending && (
          <button type="button" className="btn btn--primary" onClick={() => start.mutate()}>
            {start.error ? 'Try again' : 'Set up two-step sign-in'}
          </button>
        )}
      </div>
    )
  }

  function submit(event) {
    event.preventDefault()
    const value = sixDigits(code)
    if (!value) {
      setCodeError('Enter the 6-digit code your app shows now.')
      codeInput.current?.focus()
      return
    }
    setCodeError(null)
    confirm.mutate(value)
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(start.data.secret)
      setCopied('Key copied.')
    } catch {
      setCopied('Copying is blocked here. Select the key and copy it.')
    }
  }

  return (
    <div className="two-step">
      <h2 ref={scanHeading} tabIndex={-1} className="panel__title">
        1. Add BuyNest to your authenticator app
      </h2>
      <p className="muted">Use an app such as Google Authenticator, Microsoft Authenticator, 1Password, or Authy. Scan the code, or enter the key by hand.</p>
      <div className="two-step__pair">
        {start.data.qrSvg && (
          <img
            className="two-step__qr"
            src={qrImageSource(start.data.qrSvg)}
            alt="QR code to add BuyNest Admin to your authenticator app. Can't scan it? Enter the key shown next to it."
            width="200"
            height="200"
          />
        )}
        <div className="two-step__key">
          <p>Key for manual entry (time-based, 6 digits):</p>
          <p>
            <code className="two-step__secret">{groupKey(start.data.secret)}</code>
          </p>
          <button type="button" className="btn btn--outline btn--sm" onClick={copyKey}>
            <LuCopy aria-hidden="true" /> Copy key
          </button>
          <p role="status" className="muted">
            {copied}
          </p>
        </div>
      </div>

      <form className="two-step__confirm" noValidate onSubmit={submit}>
        <h2 className="panel__title">2. Enter the code from the app</h2>
        <div className="field">
          <label htmlFor="two-step-confirm-code">6-digit code</label>
          <input
            ref={codeInput}
            id="two-step-confirm-code"
            className="code-input"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9 ]*"
            maxLength={7}
            value={code}
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? 'two-step-confirm-error' : undefined}
            onChange={(event) => setCode(event.target.value)}
          />
          {codeError && (
            <span id="two-step-confirm-error" className="field__error" role="alert">
              {codeError}
            </span>
          )}
        </div>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={confirm.isPending}>
            {confirm.isPending ? 'Checking…' : 'Turn on two-step sign-in'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default TwoFactorSetup
