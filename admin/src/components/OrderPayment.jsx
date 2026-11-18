import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LuCopy, LuExternalLink, LuLink } from 'react-icons/lu'
import { adminKeys, createPaymentLink } from '../api/admin'
import StatusBadge from './StatusBadge'
import { formatDateTime } from '../utils/format'
import { providerName } from '../utils/orders'

// Phase 10 §3: PayPal's sandbox is its test mode.
const MODE_BADGES = { test: 'Test mode', sandbox: 'Sandbox' }
// What each provider calls the payment's reference.
const REFERENCE_LABELS = { stripe: 'Reference', paypal: 'Capture ID' }

/**
 * Phase 8: how a real order is paid by card through Stripe, as rows of the
 * order page's details list: the provider, Stripe's reference (linked to
 * the Stripe dashboard, test or live as the API says), when it was paid, and
 * for an unpaid card order the payment link to copy and send to the
 * customer (or "Create payment link" when none is open). Nothing for orders
 * Stripe never saw.
 * Phase 10 §3: the same for PayPal: the capture id links to PayPal's
 * dashboard (sandbox or live), and the payment link is PayPal's approval page.
 */
function OrderPayment({ order, canEdit }) {
  const payment = order.payment
  if (!payment || (!payment.provider && !payment.canPay && !payment.url)) return null
  return (
    <>
      <dt>Paid through</dt>
      <dd>
        {payment.provider ? providerName(payment.provider) : 'Stripe'}
        {MODE_BADGES[payment.mode] && (
          <>
            {' '}
            <StatusBadge tone="info" label={MODE_BADGES[payment.mode]} />
          </>
        )}
      </dd>
      {payment.reference && (
        <>
          <dt>{REFERENCE_LABELS[payment.provider] ?? 'Reference'}</dt>
          <dd>
            {payment.dashboardUrl ? (
              <a href={payment.dashboardUrl} target="_blank" rel="noopener noreferrer" className="external-link">
                <code>{payment.reference}</code> <LuExternalLink aria-hidden="true" />
                <span className="visually-hidden">
                  {' '}
                  (opens the payment in {providerName(payment.provider ?? 'stripe')}'s {payment.mode === 'live' ? 'live' : payment.mode === 'sandbox' ? 'sandbox' : 'test'} dashboard, in a new tab)
                </span>
              </a>
            ) : (
              <code>{payment.reference}</code>
            )}
          </dd>
        </>
      )}
      {payment.paidAt && (
        <>
          <dt>Paid at</dt>
          <dd>
            <time dateTime={payment.paidAt}>{formatDateTime(payment.paidAt)}</time>
          </dd>
        </>
      )}
      {payment.canPay && (
        <>
          <dt>Payment link</dt>
          <dd>
            <PaymentLink order={order} canEdit={canEdit} />
          </dd>
        </>
      )}
    </>
  )
}

/** The open Stripe (or PayPal) payment page to copy, or a button to open one (orders.edit). */
function PaymentLink({ order, canEdit }) {
  const provider = providerName(order.payment.provider ?? (order.paymentMethod === 'paypal' ? 'paypal' : 'stripe'))
  const queryClient = useQueryClient()
  const inputId = useId()
  const [copied, setCopied] = useState(null) // null | 'copied' | 'select'
  const create = useMutation({
    mutationFn: () => createPaymentLink(order.number),
    onSuccess: (result) => {
      if (result.order) queryClient.setQueryData(adminKeys.order(order.number), result.order)
      setCopied(null)
    },
  })
  const fresh = create.data?.payment
  const url = fresh?.url ?? order.payment.url
  const expiresAt = fresh?.url ? fresh.expiresAt : order.payment.expiresAt
  const error = create.error?.fieldErrors?.order?.[0] ?? create.error?.message ?? (fresh && !fresh.url ? (fresh.error ?? `${provider} couldn't be reached. Try again in a moment.`) : null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied('copied')
    } catch {
      // No clipboard access (an insecure page, or refused): select the text for Ctrl+C.
      document.getElementById(inputId)?.select()
      setCopied('select')
    }
  }

  return (
    <div className="payment-link">
      {url ? (
        <>
          <label htmlFor={inputId} className="visually-hidden">
            Payment link for order {order.number}
          </label>
          <div className="payment-link__row">
            <input id={inputId} type="text" readOnly value={url} onFocus={(event) => event.target.select()} />
            <button type="button" className="btn btn--outline btn--sm" onClick={copy}>
              <LuCopy aria-hidden="true" /> Copy link
            </button>
          </div>
          {expiresAt && <p className="field__hint">Open until {formatDateTime(expiresAt)}. Send it to the customer; the order is marked paid when {provider} confirms the payment.</p>}
        </>
      ) : (
        <p className="muted">No payment page is open for this order.</p>
      )}
      {canEdit && (
        <button type="button" className="btn btn--outline btn--sm" onClick={() => create.mutate()} disabled={create.isPending}>
          <LuLink aria-hidden="true" /> {create.isPending ? 'Creating the link…' : url ? 'Get a new link' : 'Create payment link'}
        </button>
      )}
      {/* Always rendered, so "copied" is announced. */}
      <p role="status" className="field__hint">
        {copied === 'copied' ? 'Payment link copied.' : copied === 'select' ? 'The link is selected: press Ctrl+C (or ⌘+C) to copy it.' : ''}
      </p>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default OrderPayment
