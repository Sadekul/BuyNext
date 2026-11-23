import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuBell, LuMailCheck } from 'react-icons/lu'
import FormField from '../forms/FormField'
import Button from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { createStockAlert } from '../../services/accountService'
import { validateEmail } from '../../utils/validation'
import './StockAlertForm.css'
import { useTranslation } from 'react-i18next'

// One answer for everyone: it never tells whether an address was already on the list.
export const STOCK_ALERT_DONE = "We'll email you when it's back in stock."

/**
 * "Email me when it's back" (phase 9) on a sold-out product, or a sold-out
 * variant (`variantId`; give the form a `key` per variant so it starts over
 * when the shopper picks another). Signed-in customers get one button (the
 * account's email is used); guests type an email. Whatever the server knew
 * before, the shopper sees the same message.
 */
function StockAlertForm({ productId, variantId = null, variantLabel = null }) {
  const { t } = useTranslation('catalog')
  const { isAuthenticated, authorizedRequest } = useAuth()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState(null)
  const headingId = useId()

  const subscribe = useMutation({
    mutationFn: (input) => (isAuthenticated ? authorizedRequest(() => createStockAlert(productId, input)) : createStockAlert(productId, input)),
    onError: (error) => {
      const messages = error.fieldErrors?.email
      if (messages) setEmailError(Array.isArray(messages) ? messages[0] : String(messages))
    },
  })

  function handleSubmit(event) {
    event.preventDefault()
    if (!isAuthenticated) {
      const error = validateEmail(email)
      setEmailError(error)
      if (error) {
        event.currentTarget.elements.email.focus()
        return
      }
    }
    subscribe.mutate({ email: isAuthenticated ? undefined : email.trim(), variantId: variantId ?? undefined })
  }

  const generalError = subscribe.error && !subscribe.error.fieldErrors?.email ? subscribe.error.message : null

  return (
    <section className="stock-alert" aria-labelledby={headingId}>
      <h2 id={headingId} className="stock-alert__title">
        <LuBell aria-hidden="true" /> {variantLabel ? t('stockAlert.variantSoldOut', { variant: variantLabel }) : t('stockAlert.soldOut')}
      </h2>
      {/* The live region exists before the answer arrives, so it is announced. */}
      <p className="stock-alert__done" role="status">
        {subscribe.isSuccess && (
          <>
            <LuMailCheck aria-hidden="true" /> {t('stockAlert.done')}
          </>
        )}
      </p>
      {!subscribe.isSuccess && (
        <form className="stock-alert__form" onSubmit={handleSubmit} noValidate aria-labelledby={headingId}>
          {!isAuthenticated && (
            <FormField
              label={t('stockAlert.email')}
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                if (emailError) setEmailError(null)
              }}
              error={emailError}
              hint={t('stockAlert.emailHint')}
            />
          )}
          {generalError && (
            <p className="stock-alert__error" role="alert">
              {generalError}
            </p>
          )}
          <Button type="submit" variant="outline" disabled={subscribe.isPending}>
            {t(subscribe.isPending ? 'stockAlert.saving' : 'stockAlert.submit')}
          </Button>
        </form>
      )}
    </section>
  )
}

export default StockAlertForm
