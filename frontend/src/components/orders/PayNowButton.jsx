import { useEffect, useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuLock } from 'react-icons/lu'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { payOrder } from '../../services/shopService'
import { isPaymentUrl, paymentPage, rememberGuestPayment } from '../../utils/payment'
import { useTranslation } from 'react-i18next'

// Phase 13: shopper-facing texts in orders:payNow.*.

/**
 * "Pay now" for an unpaid card order (phase 8): asks the server for a new
 * Stripe Checkout page, then leaves for it. Signed-in customers are
 * recognised by their session; a guest passes the order's `email` (the same
 * proof as order tracking). Errors are announced next to the button.
 */
function PayNowButton({ order, email, size = 'md', variant = 'primary' }) {
  const { t } = useTranslation('orders')
  const { isAuthenticated, authorizedRequest } = useAuth()
  const [leaving, setLeaving] = useState(false)
  const errorId = useId()
  const guestEmail = isAuthenticated ? undefined : (email ?? order.email)
  const pay = useMutation({
    mutationFn: async () => {
      const payment = await (isAuthenticated ? authorizedRequest(() => payOrder(order.number)) : payOrder(order.number, { email: guestEmail }))
      if (!isPaymentUrl(payment?.url)) throw new Error(payment?.error || t('payNow.noPage'))
      return payment
    },
    onSuccess: (payment) => {
      if (!isAuthenticated && guestEmail) rememberGuestPayment(order.number, guestEmail)
      setLeaving(true)
      paymentPage.open(payment.url)
    },
  })
  // Back from Stripe with the browser's Back button, the page may come back from the cache as it was left.
  useEffect(() => {
    const reset = (event) => event.persisted && setLeaving(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])
  const error = pay.error?.message ?? null
  const busy = pay.isPending || leaving

  return (
    <div className="pay-now">
      <Button variant={variant} size={size} onClick={() => pay.mutate()} disabled={busy} aria-describedby={error ? errorId : undefined}>
        <LuLock aria-hidden="true" /> {t(busy ? 'payNow.opening' : order.paymentMethod === 'cod' ? 'payNow.payAdvance' : 'payNow.pay')}
      </Button>
      {error && (
        <p id={errorId} className="pay-now__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default PayNowButton
