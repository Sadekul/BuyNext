import { useEffect, useId, useRef, useState } from 'react'
import { LuCopy, LuDownload, LuTriangleAlert } from 'react-icons/lu'
import { RECOVERY_FILE, recoveryCodesText } from '../utils/twoFactor'

/**
 * Recovery codes, shown once: a clear warning, the codes, copy and download
 * (.txt), and "I saved them" before `onDone`. Focus moves to the heading when
 * they appear, so screen-reader users hear the warning first.
 */
function RecoveryCodes({ codes, email, onDone, doneLabel = 'Done' }) {
  const headingId = useId()
  const heading = useRef(null)
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setMessage('Recovery codes copied.')
    } catch {
      setMessage('Copying is blocked here. Download the file or write the codes down.')
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([recoveryCodesText(codes, { email })], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = RECOVERY_FILE
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(`Saved as ${RECOVERY_FILE}.`)
  }

  return (
    <section className="recovery-codes" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1} className="panel__title">
        Save your recovery codes
      </h2>
      <p className="recovery-codes__warning">
        <LuTriangleAlert aria-hidden="true" />
        <span>
          <strong>These codes are shown only once.</strong> If you lose your phone, each code lets you sign in one time instead of a code from the app.
          Keep them somewhere safe, away from your password.
        </span>
      </p>
      <ol className="recovery-codes__list" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className="recovery-codes__actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={copy}>
          <LuCopy aria-hidden="true" /> Copy codes
        </button>
        <button type="button" className="btn btn--outline btn--sm" onClick={download}>
          <LuDownload aria-hidden="true" /> Download as .txt
        </button>
      </div>
      <p role="status" className="muted">
        {message}
      </p>
      {onDone && (
        <>
          <label className="checkbox">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            I saved my recovery codes
          </label>
          <div className="form__actions">
            <button type="button" className="btn btn--primary" disabled={!saved} onClick={onDone}>
              {doneLabel}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default RecoveryCodes
