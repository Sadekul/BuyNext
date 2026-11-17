import { useSearchParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { LuBellOff } from 'react-icons/lu'
import PageMeta from '../components/common/PageMeta'
import Button from '../components/ui/Button'
import Loader from '../components/ui/Loader'
import { ROUTES } from '../constants/routes'
import { unsubscribeStockAlerts } from '../services/accountService'
import './AuthPages.css'

const TITLE = 'Stop back-in-stock emails'

/**
 * /stock-alerts/unsubscribe?token=… (REAL_SHOP, phase 9): the link in every
 * "it's back in stock" email. It asks for one click first, so a mail scanner
 * opening the link can't remove anyone's alerts. No sign-in: the token is
 * the proof. Kept out of search results.
 */
function StockAlertUnsubscribePage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim() ?? ''
  const request = useMutation({ mutationFn: unsubscribeStockAlerts })
  const errorMessage = request.error ? (request.error.fieldErrors?.token?.[0] ?? request.error.message) : null

  let body
  if (!token) {
    body = (
      <p className="auth-alert auth-alert--error" role="alert">
        This link is incomplete. Open the link from the email again.
      </p>
    )
  } else if (request.isSuccess) {
    body = (
      <p className="auth-alert auth-alert--success" role="status">
        {request.data.message}
      </p>
    )
  } else if (errorMessage) {
    body = (
      <p className="auth-alert auth-alert--error" role="alert">
        {errorMessage}
      </p>
    )
  } else if (request.isPending) {
    body = <Loader label="Stopping your alerts…" />
  } else {
    body = (
      <>
        <p className="auth-card__subtitle">We'll stop every back-in-stock email we were waiting to send to this address.</p>
        <Button onClick={() => request.mutate(token)} fullWidth>
          Stop these emails
        </Button>
      </>
    )
  }

  return (
    <div className="auth-page section container">
      <PageMeta title={TITLE} noindex />
      <div className="auth-card">
        <LuBellOff aria-hidden="true" size={32} />
        <h1 className="auth-card__title">{TITLE}</h1>
        {body}
        <Button to={ROUTES.products} variant="ghost" fullWidth>
          Continue shopping
        </Button>
      </div>
    </div>
  )
}

export default StockAlertUnsubscribePage
