import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import FormField from '../forms/FormField'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { confirmEmailChange, requestEmailChange } from '../../services/accountService'
import { validateCode, validateEmail } from '../../utils/validation'
import './ChangeEmailForm.css'

const firstError = (error, field) => {
  const messages = error?.fieldErrors?.[field]
  return Array.isArray(messages) ? messages[0] : (messages ?? null)
}

/**
 * Account → Profile → "Change email" (BuyNest accounts, phase 9), in two steps:
 *   1. the new address and the current password → a 6-digit code goes to
 *      the NEW address (proving the customer can read it);
 *   2. the code → the account switches to the new address, the old address is
 *      told, and other devices are signed out.
 * Until step 2 the account keeps its old email. `pendingEmail` (from the
 * profile) opens step 2 straight away when a code is already on its way.
 * `onChanged(profile)` receives the updated profile.
 */
function ChangeEmailForm({ currentEmail, pendingEmail = null, onChanged }) {
  const { authorizedRequest } = useAuth()
  const [step, setStep] = useState(pendingEmail ? 'confirm' : 'closed') // closed | request | confirm
  const [values, setValues] = useState({ email: pendingEmail ?? '', password: '', code: '' })
  const [errors, setErrors] = useState({})
  const [sentTo, setSentTo] = useState(pendingEmail)
  const [notice, setNotice] = useState('')
  const headingRef = useRef(null)
  const codeRef = useRef(null)
  const openedRef = useRef(false)

  const request = useMutation({
    mutationFn: (input) => authorizedRequest(() => requestEmailChange(input)),
    onSuccess: (result, input) => {
      setSentTo(result.email ?? input.email.trim())
      setNotice(result.message)
      setValues((current) => ({ ...current, password: '', code: '' }))
      setStep('confirm')
    },
    onError: (error) => setErrors({ email: firstError(error, 'email'), password: firstError(error, 'password') }),
  })

  const confirm = useMutation({
    mutationFn: (input) => authorizedRequest(() => confirmEmailChange(input)),
    onSuccess: (profile) => {
      setStep('closed')
      setValues({ email: '', password: '', code: '' })
      setSentTo(null)
      setNotice(`Your email is now ${profile.email}. We've let your old address know.`)
      onChanged?.(profile)
    },
    onError: (error) => setErrors({ code: firstError(error, 'code') ?? firstError(error, 'email') }),
  })

  // Keyboard and screen reader users land on the new step.
  useEffect(() => {
    if (!openedRef.current) return
    if (step === 'request') headingRef.current?.focus()
    if (step === 'confirm') codeRef.current?.focus()
  }, [step])

  function go(next) {
    openedRef.current = true
    setErrors({})
    request.reset()
    confirm.reset()
    if (next !== 'closed') setNotice('')
    setStep(next)
  }

  function handleChange(event) {
    const { name, value } = event.target
    setValues((current) => ({ ...current, [name]: value }))
    if (errors[name]) setErrors((current) => ({ ...current, [name]: null }))
  }

  function handleRequest(event) {
    event.preventDefault()
    const email = values.email.trim()
    const next = {
      email: validateEmail(email) ?? (email.toLowerCase() === currentEmail?.toLowerCase() ? 'This is already your email address.' : null),
      password: values.password ? null : 'Enter your current password.',
    }
    setErrors(next)
    if (next.email || next.password) {
      event.currentTarget.elements[next.email ? 'email' : 'password'].focus()
      return
    }
    request.mutate({ email, password: values.password })
  }

  function handleConfirm(event) {
    event.preventDefault()
    const codeError = validateCode(values.code)
    setErrors({ code: codeError })
    if (codeError) {
      codeRef.current?.focus()
      return
    }
    confirm.mutate({ code: values.code.trim() })
  }

  // An error the fields don't explain (rate limit, server down).
  const generalError = (mutation, fields) => (mutation.error && !fields.some((field) => firstError(mutation.error, field)) ? mutation.error.message : null)

  return (
    <section className="change-email" aria-labelledby="change-email-title">
      <h2 id="change-email-title" className="profile__section-title" ref={headingRef} tabIndex={-1}>
        Email address
      </h2>
      <p className="change-email__hint">The email you sign in with, and where we send order updates. It's shown with your details above.</p>

      {step === 'closed' && (
        <Button variant="outline" size="sm" onClick={() => go('request')} className="change-email__open">
          Change email
        </Button>
      )}

      {step === 'request' && (
        <form className="change-email__form" onSubmit={handleRequest} noValidate aria-label="Change your email">
          <p className="change-email__hint">We'll send a 6-digit code to the new address. Your email stays the same until you enter it.</p>
          <FormField label="New email" name="email" type="email" autoComplete="email" value={values.email} onChange={handleChange} error={errors.email} />
          <FormField
            label="Current password"
            name="password"
            type="password"
            autoComplete="current-password"
            revealable
            value={values.password}
            onChange={handleChange}
            error={errors.password}
          />
          {generalError(request, ['email', 'password']) && (
            <p className="change-email__error" role="alert">
              {generalError(request, ['email', 'password'])}
            </p>
          )}
          <div className="change-email__actions">
            <Button type="submit" size="sm" disabled={request.isPending}>
              {request.isPending ? 'Sending…' : 'Send code'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => go('closed')} disabled={request.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {step === 'confirm' && (
        <form className="change-email__form" onSubmit={handleConfirm} noValidate aria-label="Confirm your new email">
          <p className="change-email__hint">
            {sentTo ? (
              <>
                Enter the 6-digit code we sent to <strong>{sentTo}</strong>. It expires in 10 minutes.
              </>
            ) : (
              'Enter the 6-digit code we sent to your new address.'
            )}
          </p>
          <FormField
            ref={codeRef}
            label="Code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={values.code}
            onChange={handleChange}
            error={errors.code}
          />
          {generalError(confirm, ['code', 'email']) && (
            <p className="change-email__error" role="alert">
              {generalError(confirm, ['code', 'email'])}
            </p>
          )}
          <div className="change-email__actions">
            <Button type="submit" size="sm" disabled={confirm.isPending}>
              {confirm.isPending ? 'Confirming…' : 'Confirm new email'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => go('request')} disabled={confirm.isPending}>
              Send a new code
            </Button>
            <Button variant="ghost" size="sm" onClick={() => go('closed')} disabled={confirm.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <p className="profile__status" role="status">
        {notice}
      </p>
    </section>
  )
}

export default ChangeEmailForm
