import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LuCopy, LuExternalLink, LuLink, LuSearchCheck } from 'react-icons/lu'
import { adminKeys, createPaymentLink } from '../api/admin'
import { checkOrderPayment } from '../api/phase12'
import StatusBadge from './StatusBadge'
import { formatDateTime } from '../utils/format'
import { SSLCOMMERZ_RISK, providerName, sslCommerzMethod } from '../utils/orders'

// Phase 10 §3: PayPal's sandbox is its test mode.
const MODE_BADGES = { test: 'Test mode', sandbox: 'Sandbox' }
// What each provider calls the payment's reference.
const REFERENCE_LABELS = { stripe: 'Reference', paypal: 'Capture ID', sslcommerz: 'Bank transaction ID' }

/**
 * Phase 8: how a real order is paid by card through Stripe, as rows of the
 * order page's details list: the provider, Stripe's reference (linked to
 * the Stripe dashboard, test or live as the API says), when it was paid, and
 * for an unpaid card order the payment link to copy and send to the
 * customer (or "Create payment link" when none is open). Nothing for orders
 * Stripe never saw.
 * Phase 10 §3: the same for PayPal: the capture id links to PayPal's
 * dashboard (sandbox or live), and the payment link is PayPal's approval page.
 * Phase 12 §3: SSLCommerz (bKash, Nagad, cards): what the customer paid with,
 * the bank transaction and validation ids, the risk level (risky payments
 * wait on hold), the attempts, and "Check payment" (orders.edit), which asks
 * SSLCommerz and records a payment the store didn't hear about.
 */
function OrderPayment({ order, canEdit }) {
  const payment = order.payment
  // Phase 12: kept here, so the answer stays on screen after the order reloads as paid (and the button goes away).
  const check = useCheckPayment(order.number)
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
      {paidWith(payment) && (
        <>
          <dt>Paid with</dt>
          <dd>
            {paidWith(payment)} ({providerName(payment.provider)})
          </dd>
        </>
      )}
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
      {payment.provider === 'sslcommerz' && payment.sslcommerz && <SslCommerzRows details={payment.sslcommerz} />}
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
      {payment.provider === 'sslcommerz' && ((payment.sslcommerz?.canCheck && canEdit) || check.data || check.error) && (
        <>
          <dt>Check payment</dt>
          <dd>
            <CheckPayment check={check} canCheck={Boolean(payment.sslcommerz?.canCheck && canEdit)} />
          </dd>
        </>
      )}
    </>
  )
}

/** Phase 12: "bKash", "Visa card (Dutch Bangla)": the API's label, else worked out from SSLCommerz's card type. */
function paidWith(payment) {
  if (payment.methodLabel) return payment.methodLabel
  if (payment.provider !== 'sslcommerz' || !payment.sslcommerz?.cardType) return null
  return sslCommerzMethod(payment.sslcommerz.cardType, payment.sslcommerz.cardBrand)
}

/** Phase 12 §3: SSLCommerz's ids for this payment, its risk check, and how many payment pages were opened. */
function SslCommerzRows({ details }) {
  const risk = SSLCOMMERZ_RISK[details.riskLevel]
  return (
    <>
      {details.valId && (
        <>
          <dt>Validation ID</dt>
          <dd>
            <code>{details.valId}</code>
          </dd>
        </>
      )}
      {details.tranId && (
        <>
          <dt>Transaction ID</dt>
          <dd>
            <code>{details.tranId}</code>
          </dd>
        </>
      )}
      {risk && (
        <>
          <dt>Risk check</dt>
          <dd>
            <StatusBadge tone={risk.tone} label={risk.label} />
            {details.riskTitle && <span className="muted"> {details.riskTitle}</span>}
            {details.riskLevel === 1 && (
              <p className="field__hint">SSLCommerz flagged this payment. Check it in SSLCommerz's panel, then invoice the order to accept it, or cancel it and refund there.</p>
            )}
          </dd>
        </>
      )}
      {details.attempts > 0 && (
        <>
          <dt>Payment attempts</dt>
          <dd>{details.attempts}</dd>
        </>
      )}
    </>
  )
}

/**
 * Phase 12 §3, orders.edit: asks SSLCommerz about every payment page of the
 * order and records a payment it confirms (the return trip and the IPN may
 * both have been missed). The answer is announced; the order reloads.
 */
function useCheckPayment(number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => checkOrderPayment(number),
    onSuccess: (data) => {
      if (data?.order) queryClient.setQueryData(adminKeys.order(number), data.order)
      if (data?.result?.found) {
        for (const key of [['orders'], adminKeys.overview, ['invoices']]) queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
}

function CheckPayment({ check, canCheck }) {
  const result = check.data?.result
  const error = check.error ? (check.error.fieldErrors?.order?.[0] ?? check.error.message) : null
  return (
    <div className="payment-link">
      {canCheck && (
        <>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => check.mutate()} disabled={check.isPending}>
            <LuSearchCheck aria-hidden="true" /> {check.isPending ? 'Asking SSLCommerz…' : 'Check payment'}
          </button>
          <p className="field__hint">Asks SSLCommerz whether the customer paid, and records the payment if they did.</p>
        </>
      )}
      {/* Always rendered, so the answer is announced. */}
      <p role="status" className={result?.found ? 'notice notice--success' : 'field__hint'}>
        {result?.message ?? (result ? (result.found ? 'Payment found and recorded.' : 'SSLCommerz has no completed payment for this order.') : '')}
      </p>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** The open Stripe (PayPal, SSLCommerz) payment page to copy, or a button to open one (orders.edit). */
function PaymentLink({ order, canEdit }) {
  const provider = providerName(order.payment.provider ?? (['paypal', 'sslcommerz'].includes(order.paymentMethod) ? order.paymentMethod : 'stripe'))
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
