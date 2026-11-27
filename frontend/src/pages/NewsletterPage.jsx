import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { LuMailCheck, LuMailX, LuTicket } from 'react-icons/lu'
import PageMeta from '../components/common/PageMeta'
import Button from '../components/ui/Button'
import Loader from '../components/ui/Loader'
import { ROUTES } from '../constants/routes'
import { confirmNewsletter, unsubscribeFromNewsletter } from '../services/newsletterService'
import './AuthPages.css'
import { useTranslation } from 'react-i18next'

const ACTIONS = {
  confirm: {
    title: 'newsletterPage.confirmTitle',
    run: confirmNewsletter,
    missing: 'newsletterPage.confirmMissing',
  },
  unsubscribe: {
    title: 'newsletterPage.unsubscribeTitle',
    run: unsubscribeFromNewsletter,
    missing: 'newsletterPage.unsubscribeMissing',
  },
}

/**
 * The two links in BuyNest's newsletter emails (REAL_SHOP, backend phase 7):
 *   /newsletter/confirm?token=…      the double opt-in link: confirms straight away
 *   /newsletter/unsubscribe?token=…  in every newsletter: asks for one click first,
 *                                    so a mail scanner opening the link can't unsubscribe anyone
 * No sign-in needed: the token is the proof. These pages stay out of search results.
 */
function NewsletterPage({ action }) {
  const { t } = useTranslation('marketing')
  const config = ACTIONS[action]
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim() ?? ''
  const request = useMutation({ mutationFn: (value) => config.run(value) })
  const { mutate } = request

  // The confirmation link confirms on arrival (once, even in Strict Mode's double effects).
  const startedRef = useRef(false)
  useEffect(() => {
    if (action !== 'confirm' || !token || startedRef.current) return
    startedRef.current = true
    mutate(token)
  }, [action, token, mutate])

  const errorMessage = request.error ? (request.error.fieldErrors?.token?.[0] ?? request.error.message) : null

  let body
  if (!token) {
    body = <p className="auth-alert auth-alert--error" role="alert">{t(config.missing)}</p>
  } else if (request.isSuccess) {
    body = (
      <>
        <p className="auth-alert auth-alert--success" role="status">
          {request.data?.message || t(action === 'confirm' ? 'newsletterPage.subscribed' : 'newsletterPage.unsubscribed')}
        </p>
        {/* Phase 19: this confirmation issued a welcome code (the API says so; never guessed). */}
        {action === 'confirm' && request.data?.welcomeCouponSent === true && (
          <p className="auth-welcome" role="status">
            <LuTicket className="auth-welcome__icon" aria-hidden="true" />
            <span>{t('welcome.codeSent')}</span>
          </p>
        )}
      </>
    )
  } else if (errorMessage) {
    body = <p className="auth-alert auth-alert--error" role="alert">{errorMessage}</p>
  } else if (action === 'confirm' || request.isPending) {
    body = <Loader label={t(action === 'confirm' ? 'newsletterPage.confirming' : 'newsletterPage.unsubscribing')} />
  } else {
    body = (
      <>
        <p className="auth-card__subtitle">{t('newsletterPage.explain')}</p>
        <Button onClick={() => mutate(token)} fullWidth>
          {t('newsletterPage.unsubscribe')}
        </Button>
      </>
    )
  }

  const Icon = action === 'confirm' ? LuMailCheck : LuMailX
  return (
    <div className="auth-page section container">
      <PageMeta title={t(config.title)} noindex />
      <div className="auth-card">
        <Icon aria-hidden="true" size={32} />
        <h1 className="auth-card__title">{t(config.title)}</h1>
        {body}
        {(request.isSuccess || errorMessage || !token) && (
          <Button to={ROUTES.home} variant="outline">
            {t('newsletterPage.continue')}
          </Button>
        )}
      </div>
    </div>
  )
}

export default NewsletterPage
