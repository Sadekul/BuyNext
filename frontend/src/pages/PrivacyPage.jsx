import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { LuDownload, LuTrash2 } from 'react-icons/lu'
import FormField from '../components/forms/FormField'
import Button from '../components/ui/Button'
import { useAuth } from '../hooks/useAuth'
import { deleteAccount, downloadMyData } from '../services/accountService'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './PrivacyPage.css'

const CONFIRM_WORD = 'DELETE'
const firstError = (error, field) => {
  const messages = error?.fieldErrors?.[field]
  return Array.isArray(messages) ? messages[0] : (messages ?? null)
}

/** "Download my data": the JSON file the API makes (profile, addresses, orders, reviews, …). */
function DownloadData() {
  const { authorizedRequest } = useAuth()
  const download = useMutation({ mutationFn: () => authorizedRequest(downloadMyData) })

  return (
    <section className="privacy__card" aria-labelledby="privacy-download-title">
      <h3 id="privacy-download-title">Download my data</h3>
      <p>
        Get a copy of what {SITE.name} keeps about you: your profile, addresses, orders with their invoices, refunds and returns, reviews,
        newsletter status, saved cart, and stock alerts. It downloads as a JSON file, a plain-text format other services can read.
      </p>
      <div>
        <Button variant="outline" onClick={() => download.mutate()} disabled={download.isPending}>
          <LuDownload aria-hidden="true" /> {download.isPending ? 'Preparing your file…' : 'Download my data'}
        </Button>
      </div>
      <p className="privacy__status" role="status">
        {download.isSuccess && `Your file ${download.data} was downloaded.`}
      </p>
      {download.isError && (
        <p className="privacy__error" role="alert">
          {download.error.message}
        </p>
      )}
    </section>
  )
}

/**
 * "Delete my account": the password plus typing DELETE, so it can't happen
 * by accident. The API refuses while an order is still open. Afterwards the
 * session is over: this device forgets the account and shows a goodbye page.
 */
function DeleteAccount() {
  const { authorizedRequest, logout } = useAuth()
  const navigate = useNavigate()
  const warningId = useId()
  const [values, setValues] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState({})

  const remove = useMutation({
    mutationFn: (input) => authorizedRequest(() => deleteAccount(input)),
    onSuccess: (result) => {
      // Leave the account pages first, then end the session here too.
      navigate(ROUTES.accountDeleted, { replace: true, state: { deleted: true, message: result?.message ?? null } })
      logout({ forgetDevice: true })
    },
    onError: (error) => setErrors({ password: firstError(error, 'password'), confirm: firstError(error, 'confirm') }),
  })

  const typed = values.confirm.trim() === CONFIRM_WORD
  const blocker = firstError(remove.error, 'account') // an open order
  const otherError = remove.error && !blocker && !firstError(remove.error, 'password') && !firstError(remove.error, 'confirm') ? remove.error.message : null

  function handleChange(event) {
    const { name, value } = event.target
    setValues((current) => ({ ...current, [name]: value }))
    if (errors[name]) setErrors((current) => ({ ...current, [name]: null }))
  }

  function handleSubmit(event) {
    event.preventDefault()
    const next = {
      password: values.password ? null : 'Enter your password.',
      confirm: typed ? null : `Type ${CONFIRM_WORD} to confirm.`,
    }
    setErrors(next)
    if (next.password || next.confirm) {
      event.currentTarget.elements[next.password ? 'password' : 'confirm'].focus()
      return
    }
    remove.mutate({ password: values.password, confirm: CONFIRM_WORD })
  }

  return (
    <section className="privacy__card privacy__card--danger" aria-labelledby="privacy-delete-title">
      <h3 id="privacy-delete-title">Delete my account</h3>
      <div id={warningId}>
        <p>This can't be undone. When you delete your account:</p>
        <ul className="privacy__list">
          <li>you're signed out on every device, and your addresses, saved cart, and stock alerts are deleted;</li>
          <li>you're unsubscribed from the newsletter;</li>
          <li>
            your past orders stay with us for our records (and the law), no longer linked to an account; your reviews stay with the name you
            used.
          </li>
        </ul>
        <p>Accounts with an order that's still on its way can't be deleted until it's delivered or cancelled.</p>
      </div>

      <form className="privacy__form" onSubmit={handleSubmit} noValidate aria-label="Delete my account" aria-describedby={warningId}>
        <FormField
          label="Your password"
          name="password"
          type="password"
          autoComplete="current-password"
          revealable
          value={values.password}
          onChange={handleChange}
          error={errors.password}
        />
        <FormField
          label={`Type ${CONFIRM_WORD} to confirm`}
          name="confirm"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={values.confirm}
          onChange={handleChange}
          error={errors.confirm}
        />
        {(blocker || otherError) && (
          <p className="privacy__error" role="alert">
            {blocker ?? otherError}
          </p>
        )}
        <div>
          <Button type="submit" variant="secondary" className="privacy__delete" disabled={remove.isPending}>
            <LuTrash2 aria-hidden="true" /> {remove.isPending ? 'Deleting your account…' : 'Delete my account'}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** /account/privacy (REAL_SHOP): download my data, delete my account. */
function PrivacyPage() {
  return (
    <section className="privacy" aria-labelledby="privacy-title">
      <title>{`Privacy | ${SITE.name}`}</title>
      <h2 id="privacy-title" className="privacy__title">
        Privacy
      </h2>
      <DownloadData />
      <DeleteAccount />
    </section>
  )
}

export default PrivacyPage
