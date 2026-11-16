import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { LuMailCheck, LuMailX } from 'react-icons/lu'
import PageMeta from '../components/common/PageMeta'
import Button from '../components/ui/Button'
import Loader from '../components/ui/Loader'
import { ROUTES } from '../constants/routes'
import { confirmNewsletter, unsubscribeFromNewsletter } from '../services/newsletterService'
import './AuthPages.css'

const ACTIONS = {
  confirm: {
    title: 'Confirm your subscription',
    run: confirmNewsletter,
    missing: 'This confirmation link is incomplete. Open the link from the email again, or subscribe again to get a new one.',
  },
  unsubscribe: {
    title: 'Unsubscribe from the newsletter',
    run: unsubscribeFromNewsletter,
    missing: 'This unsubscribe link is incomplete. Open the link from the newsletter email again.',
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
    body = <p className="auth-alert auth-alert--error" role="alert">{config.missing}</p>
  } else if (request.isSuccess) {
    body = (
      <p className="auth-alert auth-alert--success" role="status">
        {request.data?.message || (action === 'confirm' ? "You're subscribed." : "You're unsubscribed.")}
      </p>
    )
  } else if (errorMessage) {
    body = <p className="auth-alert auth-alert--error" role="alert">{errorMessage}</p>
  } else if (action === 'confirm' || request.isPending) {
    body = <Loader label={action === 'confirm' ? 'Confirming your subscription…' : 'Unsubscribing…'} />
  } else {
    body = (
      <>
        <p className="auth-card__subtitle">You'll stop getting BuyNest newsletters at this address. Order emails still arrive as usual.</p>
        <Button onClick={() => mutate(token)} fullWidth>
          Unsubscribe
        </Button>
      </>
    )
  }

  const Icon = action === 'confirm' ? LuMailCheck : LuMailX
  return (
    <div className="auth-page section container">
      <PageMeta title={config.title} noindex />
      <div className="auth-card">
        <Icon aria-hidden="true" size={32} />
        <h1 className="auth-card__title">{config.title}</h1>
        {body}
        {(request.isSuccess || errorMessage || !token) && (
          <Button to={ROUTES.home} variant="outline">
            Continue shopping
          </Button>
        )}
      </div>
    </div>
  )
}

export default NewsletterPage
