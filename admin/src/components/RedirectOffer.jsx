import { useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createRedirect } from '../api/admin'
import { LIVE_DATA } from '../api/mode'
import { useAdminAuth } from '../auth/useAdminAuth'
import { actionErrorMessage } from '../utils/permissions'
import { REDIRECT_CODES, redirectErrors } from '../utils/redirects'

/**
 * After deleting a product or category, or changing a page's address: offer
 * to send its old address somewhere else (seo.manage), so links and search
 * results don't end on "not found" (PHASE7_CONTRACT.md §5). Nothing happens
 * unless the admin adds it. `onClose` hides the offer.
 */
function RedirectOffer({ fromPath, suggestedTo = '/', what, onClose }) {
  const { can } = useAdminAuth()
  const queryClient = useQueryClient()
  const [toPath, setToPath] = useState(suggestedTo)
  const [statusCode, setStatusCode] = useState(301)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const headingId = useId()
  const inputId = useId()
  const errorId = useId()
  const doneRef = useRef(null)

  const add = useMutation({
    mutationFn: () => createRedirect({ fromPath, toPath: toPath.trim(), statusCode }),
    onSuccess: ({ redirect }) => {
      queryClient.invalidateQueries({ queryKey: ['redirects'] })
      setDone(`Redirect added: ${redirect.fromPath} now goes to ${redirect.toPath}.`)
      requestAnimationFrame(() => doneRef.current?.focus())
    },
    onError: (failure) => setError(failure.fieldErrors ? Object.values(failure.fieldErrors).flat()[0] : actionErrorMessage(failure)),
  })

  if (!LIVE_DATA || !can('seo.manage')) return null
  if (done) {
    return (
      <p ref={doneRef} tabIndex={-1} className="notice notice--success" role="status">
        {done}{' '}
        <button type="button" className="link-button" onClick={onClose}>
          Dismiss
        </button>
      </p>
    )
  }

  return (
    <section className="panel redirect-offer" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel__title">
        Keep old links working?
      </h2>
      <p>
        Links to <code>{fromPath}</code> ({what}) now lead to "not found". Add a redirect to send visitors somewhere else.
      </p>
      <form
        className="redirect-offer__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          const problems = redirectErrors({ fromPath, toPath: toPath.trim() })
          const first = problems.fromPath?.[0] ?? problems.toPath?.[0]
          setError(first ?? null)
          if (!first) add.mutate()
        }}
      >
        <div className="field">
          <label htmlFor={inputId}>Send visitors to</label>
          <input id={inputId} value={toPath} maxLength={2048} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} onChange={(event) => setToPath(event.target.value)} />
          {error && (
            <span id={errorId} className="field__error">
              {error}
            </span>
          )}
        </div>
        <label className="toolbar__select">
          <span>Type</span>
          <select value={statusCode} onChange={(event) => setStatusCode(Number(event.target.value))}>
            {REDIRECT_CODES.map((code) => (
              <option key={code.value} value={code.value}>
                {code.label}
              </option>
            ))}
          </select>
        </label>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary btn--sm" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add redirect'}
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={onClose}>
            No thanks
          </button>
        </div>
      </form>
    </section>
  )
}

export default RedirectOffer
