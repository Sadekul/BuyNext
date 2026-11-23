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
import { useTranslation } from 'react-i18next'

const CONFIRM_WORD = 'DELETE'
const firstError = (error, field) => {
  const messages = error?.fieldErrors?.[field]
  return Array.isArray(messages) ? messages[0] : (messages ?? null)
}

/** "Download my data": the JSON file the API makes (profile, addresses, orders, reviews, …). */
function DownloadData() {
  const { t } = useTranslation('account')
  const { authorizedRequest } = useAuth()
  const download = useMutation({ mutationFn: () => authorizedRequest(downloadMyData) })

  return (
    <section className="privacy__card" aria-labelledby="privacy-download-title">
      <h3 id="privacy-download-title">{t('privacy.downloadTitle')}</h3>
      <p>{t('privacy.downloadText', { store: SITE.name })}</p>
      <div>
        <Button variant="outline" onClick={() => download.mutate()} disabled={download.isPending}>
          <LuDownload aria-hidden="true" /> {t(download.isPending ? 'privacy.preparing' : 'privacy.downloadTitle')}
        </Button>
      </div>
      <p className="privacy__status" role="status">
        {download.isSuccess && t('privacy.downloaded', { file: download.data })}
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
  const { t } = useTranslation('account')
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
      password: values.password ? null : t('privacy.passwordRequired'),
      confirm: typed ? null : t('privacy.typeToConfirm', { word: CONFIRM_WORD }),
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
      <h3 id="privacy-delete-title">{t('privacy.deleteTitle')}</h3>
      <div id={warningId}>
        <p>{t('privacy.cantUndo')}</p>
        <ul className="privacy__list">
          <li>{t('privacy.point1')}</li>
          <li>{t('privacy.point2')}</li>
          <li>{t('privacy.point3')}</li>
        </ul>
        <p>{t('privacy.openOrders')}</p>
      </div>

      <form className="privacy__form" onSubmit={handleSubmit} noValidate aria-label={t('privacy.deleteTitle')} aria-describedby={warningId}>
        <FormField
          label={t('privacy.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          revealable
          value={values.password}
          onChange={handleChange}
          error={errors.password}
        />
        <FormField
          label={t('privacy.typeLabel', { word: CONFIRM_WORD })}
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
            <LuTrash2 aria-hidden="true" /> {t(remove.isPending ? 'privacy.deleting' : 'privacy.deleteTitle')}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** /account/privacy (REAL_SHOP): download my data, delete my account. */
function PrivacyPage() {
  const { t } = useTranslation('account')
  return (
    <section className="privacy" aria-labelledby="privacy-title">
      <title>{`${t('privacy.tabTitle')} | ${SITE.name}`}</title>
      <h2 id="privacy-title" className="privacy__title">
        {t('privacy.title')}
      </h2>
      <DownloadData />
      <DeleteAccount />
    </section>
  )
}

export default PrivacyPage
