import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { LuSearch } from 'react-icons/lu'
import FormField from '../components/forms/FormField'
import OrderDetailsView from '../components/orders/OrderDetailsView'
import PayNowButton from '../components/orders/PayNowButton'
import CancelOrderButton from '../components/orders/CancelOrderButton'
import Button from '../components/ui/Button'
import { lookupOrder } from '../services/shopService'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { canPayOrder } from '../utils/payment'
import { SITE } from '../constants/site'
import { validateEmail } from '../utils/validation'
import './OrderPages.css'

const NUMBER_PATTERN = /^BN-?\d{6,12}$/i
const validateNumber = (value) => (NUMBER_PATTERN.test(value.trim()) ? null : 'Enter the order number from your confirmation email, like BN-100001.')

/**
 * /track-order (REAL_SHOP): guests find an order with its number AND the
 * email used at checkout. The server answers "not found" the same way when
 * either is wrong, so nobody can probe order numbers.
 */
function TrackOrderPage() {
  const [values, setValues] = useState({ number: '', email: '' })
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const resultRef = useRef(null)
  // Phase 9: the order after the guest cancelled it here (until the next lookup).
  const [cancelled, setCancelled] = useState(null)
  const lookup = useMutation({ mutationFn: lookupOrder, onSuccess: () => setCancelled(null) })
  const { settings } = useStoreSettings({ enabled: false }) // cached only: the order says itself whether it can be paid (canPay)
  const errors = hasSubmitted ? { number: validateNumber(values.number), email: validateEmail(values.email) } : {}
  const order = cancelled ?? lookup.data

  // Move focus to the result, so keyboard and screen reader users land on it.
  useEffect(() => {
    if (order) resultRef.current?.focus()
  }, [order])

  function handleChange(event) {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  function handleSubmit(event) {
    event.preventDefault()
    setHasSubmitted(true)
    const numberError = validateNumber(values.number)
    if (numberError || validateEmail(values.email)) {
      event.currentTarget.elements[numberError ? 'number' : 'email'].focus()
      return
    }
    // "BN100001" works too: the number is stored with its dash.
    const number = values.number.trim().toUpperCase().replace(/^BN-?/, 'BN-')
    lookup.mutate({ number, email: values.email })
  }

  return (
    <div className="track-order section container">
      <title>{`Track your order | ${SITE.name}`}</title>
      <header>
        <h1>Track your order</h1>
        <p>Enter the order number from your confirmation email and the email address you used at checkout.</p>
      </header>

      <form className="track-order__form" onSubmit={handleSubmit} noValidate>
        <FormField label="Order number" name="number" placeholder="BN-100001" autoComplete="off" value={values.number} onChange={handleChange} error={errors.number} />
        <FormField label="Email" name="email" type="email" autoComplete="email" value={values.email} onChange={handleChange} error={errors.email} />
        {lookup.error && (
          <p className="track-order__error" role="alert">
            {lookup.error.message}
          </p>
        )}
        <Button type="submit" disabled={lookup.isPending}>
          <LuSearch aria-hidden="true" /> {lookup.isPending ? 'Looking…' : 'Find my order'}
        </Button>
      </form>

      {order && (
        <section className="track-order__result" aria-labelledby="track-result-title">
          <h2 id="track-result-title" ref={resultRef} tabIndex={-1}>
            Order {order.number}
          </h2>
          {/* Phase 9: an unpaid order can be cancelled; the email that found it proves it is theirs. */}
          <CancelOrderButton order={order} email={lookup.variables?.email} onCancelled={setCancelled} />
          {/* Phase 8: an unpaid card order can be paid here; the email that found it proves it is theirs. */}
          <OrderDetailsView
            order={order}
            // Phase 10: the invoices as PDFs, with the email the order was found with as the proof.
            invoicePdf={lookup.variables?.email ? { orderNumber: order.number, email: lookup.variables.email } : null}
            payAction={canPayOrder(order, settings.cardPayments, settings.paypalPayments, settings.sslcommerzPayments) ? <PayNowButton order={order} email={lookup.variables?.email} /> : null}
          />
        </section>
      )}
    </div>
  )
}

export default TrackOrderPage
