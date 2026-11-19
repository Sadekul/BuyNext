import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LuCircleCheck, LuClock, LuPackageX, LuTriangleAlert } from 'react-icons/lu'
import OrderDetailsView from '../components/orders/OrderDetailsView'
import PayNowButton from '../components/orders/PayNowButton'
import CancelOrderButton from '../components/orders/CancelOrderButton'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Loader from '../components/ui/Loader'
import { useAuth } from '../hooks/useAuth'
import { useOrders } from '../hooks/useOrders'
import { guestOrderQuery, orderKeys, orderQuery } from '../queries/orderQueries'
import { capturePaypal } from '../services/shopService'
import { trackPurchase } from '../utils/analytics'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { canPayOrder, guestPaymentEmail, isPaymentUrl, paymentPage } from '../utils/payment'
import { paymentNote } from '../constants/orders'
import { REAL_SHOP } from '../constants/shop'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './OrderPages.css'

/** Demo: the order saved in this browser by the simulated checkout. */
function DemoOrderConfirmation() {
  const { orderId } = useParams()
  const { getOrder } = useOrders()
  const { user } = useAuth()
  const order = getOrder(orderId)

  if (!order) {
    return (
      <div className="section container">
        <EmptyState icon={LuPackageX} title="Order not found" message="We couldn't find that order on this device.">
          <Button to={ROUTES.orders}>View your orders</Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="order-page section container">
      <title>{`Order ${order.id} | ${SITE.name}`}</title>
      <div className="order-page__hero" role="status">
        <LuCircleCheck className="order-page__check" aria-hidden="true" />
        <div>
          <h1>Thank you, {user.firstName}!</h1>
          <p>
            Your order <strong>{order.id}</strong> was recorded (demo). A real store would email a confirmation to{' '}
            <strong>{order.contact.email}</strong>; no email was sent.
          </p>
        </div>
      </div>

      <OrderDetailsView order={order} />

      <div className="order-page__actions">
        <Button to={ROUTES.orderDetails(order.id)} variant="outline">
          View order details
        </Button>
        <Button to={ROUTES.products}>Continue shopping</Button>
      </div>
    </div>
  )
}

/** Polling after Stripe sends the shopper back: until the webhook marks the order paid, or this long. */
const CONFIRM_FOR_MS = 20_000
// Guests poll a little slower: their order lookup shares the sign-in rate limit (10 a minute per email).
const POLL_CUSTOMER_MS = 2_000
const POLL_GUEST_MS = 3_000

const PROVIDER_NAMES = { stripe: 'Stripe', paypal: 'PayPal', sslcommerz: 'SSLCommerz' }
// Phase 12: SSLCommerz's return trip (server/paymentsApi.js) says success, failed, or cancelled.
const PAYMENT_RETURNS = ['success', 'failed', 'cancelled']

/**
 * Phase 8: what the page says about a card payment through Stripe (phase 10: or PayPal), as
 * { tone, title, lines[], pay } (pay: show "Pay now"), or null for the usual
 * "Thank you" message.
 *   leaving     the order was just placed: on the way to Stripe's page
 *   success     back from Stripe (?payment=success): confirming, paid, or still confirming after 20 s
 *   cancelled   back from Stripe without paying (?payment=cancelled)
 *   failed      (phase 12) back from SSLCommerz with a failed payment (?payment=failed&provider=sslcommerz)
 *   failed      the order was placed but Stripe's page couldn't be opened
 *   cancelled   (any visit) the order was cancelled since, e.g. its payment page expired unpaid:
 *               never "is confirmed"
 */
function paymentMessage({ order, paymentReturn, leaving, gaveUp, canPay, startError, provider = 'stripe', captureError = null }) {
  const paid = order.paymentStatus === 'paid'
  const name = PROVIDER_NAMES[provider] ?? 'Our payment partner'
  if (leaving) {
    if (provider === 'paypal') return { tone: 'waiting', title: 'Taking you to PayPal…', lines: [`Your order ${order.number} is saved. You'll approve the payment on PayPal's site, then come back here.`] }
    if (provider === 'sslcommerz') {
      return { tone: 'waiting', title: 'Taking you to SSLCommerz…', lines: [`Your order ${order.number} is saved. You'll pay with bKash, Nagad, or a card on SSLCommerz's secure page, then come back here.`] }
    }
    return { tone: 'waiting', title: 'Taking you to secure payment…', lines: [`Your order ${order.number} is saved. You'll pay on Stripe's secure page; BuyNest never sees your card number.`] }
  }
  if (order.status === 'cancelled') {
    return {
      tone: 'cancelled',
      title: 'Order cancelled',
      lines: [`Your order ${order.number} was cancelled and its items were released.${order.paymentStatus === 'unpaid' ? ' Nothing was charged.' : ''} You're welcome to place a new order.`],
    }
  }
  if (paymentReturn === 'success') {
    if (paid) return { tone: 'done', title: 'Payment received — thank you', lines: [`Your order ${order.number} is paid and confirmed. We've emailed a receipt to ${order.email}.`] }
    // Phase 12: SSLCommerz flagged the payment for a check (risk level 1): received, confirmed by staff.
    if (order.paymentStatus === 'review') {
      return { tone: 'waiting', title: "We're checking your payment", lines: [`We've received the payment for order ${order.number} and are checking it. We'll email ${order.email} as soon as your order is confirmed; there's no need to pay again.`] }
    }
    // Phase 10: PayPal refused the capture (e.g. the funding source was declined): nothing was taken.
    if (captureError) {
      return {
        tone: 'waiting',
        title: "PayPal didn't complete the payment",
        lines: [`${captureError} Nothing was charged. Your order ${order.number} is saved, and you can try again.`],
        pay: canPay,
        alert: true,
      }
    }
    if (!gaveUp) return { tone: 'waiting', title: 'Confirming your payment…', lines: [`${name} is letting us know about your payment. This usually takes a few seconds.`] }
    return {
      tone: 'waiting',
      title: "We're confirming your payment",
      lines: [`${name} hasn't confirmed your payment to us yet. There's no need to pay again: we'll email ${order.email} as soon as it's confirmed, and your order page will show it.`],
    }
  }
  // Phase 12: SSLCommerz said the payment failed (declined, wrong PIN, timed out): nothing was taken.
  if (paymentReturn === 'failed' && !paid && order.status !== 'cancelled') {
    return {
      tone: 'waiting',
      title: 'Payment failed',
      lines: [`${name} couldn't complete the payment, so nothing was charged. Your order ${order.number} is saved: try again with Pay now.`, "If it isn't paid before the payment page expires, the order is cancelled and its items are released."],
      pay: canPay,
      alert: true,
    }
  }
  if (paymentReturn === 'cancelled' && !paid && order.status !== 'cancelled') {
    return {
      tone: 'waiting',
      title: 'Payment not completed',
      lines: [`Nothing was charged. Your order ${order.number} is saved, and you can pay for it now.`, "If it isn't paid before the payment page expires, the order is cancelled and its items are released."],
      pay: canPay,
    }
  }
  if (startError && !paid && order.status !== 'cancelled') {
    return {
      tone: 'waiting',
      title: "We couldn't open the payment page",
      lines: [`Your order ${order.number} is saved and nothing was charged. ${startError}`, 'Please try again with Pay now.'],
      pay: canPay,
      alert: true,
    }
  }
  return null
}

/**
 * BuyNest's API: the order the server returned when it was placed (passed in
 * the navigation state, which survives a reload), so this works for guests
 * too. A signed-in customer without it (e.g. a shared link) loads it by number.
 *
 * Phase 8 (Stripe): a card order placed with Stripe on arrives with
 * `payNow`, and this page leaves for Stripe's payment page (the cart was
 * already emptied, as for every order). Stripe sends the shopper back here
 * with ?payment=success (the order is fetched again every few seconds until
 * the webhook has marked it paid) or ?payment=cancelled ("Pay now"). Phase 12:
 * SSLCommerz the same way, plus ?payment=failed ("Payment failed", Pay now). Guests
 * are found again with the number and email kept in this tab (utils/payment.js).
 */
function ServerOrderConfirmation() {
  const { orderId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, status, isAuthenticated, authorizedRequest } = useAuth()
  const { settings } = useStoreSettings({ enabled: false }) // cached only: orders say themselves whether they can be paid
  const placed = location.state?.order?.number === orderId ? location.state.order : null
  const paymentReturn = PAYMENT_RETURNS.includes(searchParams.get('payment')) ? searchParams.get('payment') : null
  // Phase 10: PayPal sends the shopper back with ?provider=paypal&token=<its order id>; the API captures with it.
  // Phase 12: SSLCommerz posts back to the sign-in service, which forwards it to the API and sends the
  // browser here (303) with ?payment=success|failed|cancelled&provider=sslcommerz; success polls like Stripe.
  const providerParam = searchParams.get('provider')
  const returnProvider = ['paypal', 'sslcommerz'].includes(providerParam) ? providerParam : paymentReturn ? 'stripe' : null
  const paypalToken = returnProvider === 'paypal' && paymentReturn === 'success' ? (searchParams.get('token') ?? '') : null
  const [gaveUp, setGaveUp] = useState(false)
  const queryClient = useQueryClient()

  // Back from Stripe the placed order is gone (a new page load) or out of date: ask the server.
  const mustFetch = !placed || paymentReturn !== null
  const guestEmail = status === 'anonymous' ? (placed?.email ?? guestPaymentEmail(orderId)) : null

  // Phase 10, back from PayPal: capture the approved payment (once), then poll like Stripe until the order is paid.
  const capture = useMutation({
    mutationFn: () => (user ? authorizedRequest(() => capturePaypal(orderId, { token: paypalToken })) : capturePaypal(orderId, { token: paypalToken, email: guestEmail })),
    onSuccess: (captured) => queryClient.setQueryData(user ? orderKeys.detail(user.id, orderId) : orderKeys.guest(orderId), captured),
  })
  const captureStarted = useRef(false)
  const canCapture = paypalToken !== null && status !== 'checking' && (Boolean(user) || Boolean(guestEmail))
  const runCapture = capture.mutate
  useEffect(() => {
    if (!canCapture || captureStarted.current) return
    captureStarted.current = true
    runCapture()
  }, [canCapture, runCapture])
  // Polling waits for the capture's answer (it may already say "paid"); a refused capture stops it.
  const confirming = paymentReturn === 'success' && (paypalToken === null || capture.isSuccess)
  const pollEvery = user ? POLL_CUSTOMER_MS : POLL_GUEST_MS
  // Polling stops once the order is paid (or, phase 12, held for a check: staff decide from there).
  const refetchInterval = (query) => (confirming && !gaveUp && !query.state.error && !['paid', 'review'].includes(query.state.data?.paymentStatus) ? pollEvery : false)
  const customerRequest = useQuery({ ...orderQuery(user?.id, orderId, authorizedRequest), enabled: mustFetch && Boolean(user), refetchInterval })
  const guestRequest = useQuery({ ...guestOrderQuery(orderId, guestEmail), enabled: mustFetch && !user && Boolean(guestEmail), refetchInterval })
  const request = user ? customerRequest : guestRequest
  // Phase 9: the order once the shopper cancelled it on this page.
  const [cancelled, setCancelled] = useState(null)
  const order = cancelled ?? (mustFetch ? request.data : null) ?? placed

  // ?payment=success: give up waiting after CONFIRM_FOR_MS (then "We're confirming your payment").
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setGaveUp(true), CONFIRM_FOR_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  // Just placed with Stripe: leave for the payment page. The flag is dropped first,
  // so the browser's Back button from Stripe shows this page instead of leaving again.
  const payNowUrl = location.state?.payNow && placed && isPaymentUrl(placed.payment?.url) ? placed.payment.url : null
  const [leaving, setLeaving] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (!payNowUrl || started.current) return
    started.current = true
    navigate(`${location.pathname}${location.search}`, { replace: true, state: { order: placed } })
    setLeaving(true)
    // After this render's effects (the emptied cart is saved first).
    setTimeout(() => paymentPage.open(payNowUrl), 0)
  }, [payNowUrl, placed, navigate, location.pathname, location.search])
  // Restored from the browser's cache on Back: show the page, not "Taking you to…".
  useEffect(() => {
    const reset = (event) => event.persisted && setLeaving(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  // Phase 10 statistics: the purchase, once the order is confirmed (paid, or cash on delivery), once per order.
  const confirmedOrder = order && order.status !== 'cancelled' && (order.paymentStatus === 'paid' || order.status !== 'pending_payment') ? order : null
  useEffect(() => {
    if (confirmedOrder) trackPurchase(confirmedOrder)
  }, [confirmedOrder])

  const waitingForSession = status === 'checking' && !order
  if (!order && (request.isLoading || waitingForSession)) {
    return (
      <div className="section container">
        <Loader label="Loading your order…" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="section container">
        <EmptyState
          icon={LuPackageX}
          title={paymentReturn ? 'Find your order' : 'Order not found'}
          message={
            paymentReturn
              ? `Look up order ${orderId} with the email you used at checkout to see its payment status${paymentReturn !== 'success' ? ' and pay for it' : ''}.`
              : 'Look it up with the order number and the email you used at checkout.'
          }
        >
          <Button to={ROUTES.trackOrder}>Track your order</Button>
        </EmptyState>
      </div>
    )
  }

  // Stripe is on when the store says so, or when this order was sent to Stripe (the settings may still be loading).
  // Phase 10: the same for PayPal.
  const sentTo = ['stripe', 'paypal', 'sslcommerz'].includes(placed?.payment?.provider) ? placed.payment.provider : null
  const stripeOn = settings.cardPayments === 'stripe' || sentTo === 'stripe' || order.paymentProvider === 'stripe'
  const paypalOn = settings.paypalPayments === 'paypal' || sentTo === 'paypal' || order.paymentProvider === 'paypal'
  // Phase 12: the same for SSLCommerz.
  const sslcommerzOn = settings.sslcommerzPayments === 'sslcommerz' || sentTo === 'sslcommerz' || order.paymentProvider === 'sslcommerz'
  const canPay = canPayOrder(order, stripeOn ? 'stripe' : settings.cardPayments, paypalOn ? 'paypal' : settings.paypalPayments, sslcommerzOn ? 'sslcommerz' : settings.sslcommerzPayments)
  // The order was placed but the payment page couldn't be opened (no url in the answer).
  const startError = !paymentReturn && sentTo && !isPaymentUrl(placed.payment.url) ? (placed.payment.error ?? "Our payment partner couldn't be reached.") : null
  const provider = returnProvider ?? sentTo ?? order.paymentProvider ?? (['paypal', 'sslcommerz'].includes(order.paymentMethod) ? order.paymentMethod : 'stripe')
  const captureError = paypalToken !== null && capture.isError && order.paymentStatus !== 'paid' ? capture.error.message : null
  const payment = paymentMessage({ order, paymentReturn, leaving: leaving || Boolean(payNowUrl), gaveUp, canPay, startError, provider, captureError })
  const awaitingPayment = order.status === 'pending_payment'
  const firstName = user?.firstName || order.shippingAddress?.firstName || order.billingAddress?.firstName
  const HeroIcon = payment ? (payment.tone === 'done' ? LuCircleCheck : payment.tone === 'cancelled' ? LuPackageX : payment.alert ? LuTriangleAlert : LuClock) : awaitingPayment ? LuClock : LuCircleCheck
  const waiting = payment ? payment.tone === 'waiting' : false

  return (
    <div className="order-page section container">
      <title>{`Order ${order.number} | ${SITE.name}`}</title>
      {/* role=status: the result of the payment is announced as it changes (confirming → paid); a failure is an alert. */}
      <div className={waiting ? 'order-page__hero order-page__hero--waiting' : 'order-page__hero'} role={payment?.alert ? 'alert' : 'status'}>
        <HeroIcon className="order-page__check" aria-hidden="true" />
        <div>
          {payment ? (
            <>
              <h1>{payment.title}</h1>
              {payment.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </>
          ) : (
            <>
              <h1>{firstName ? `Thank you, ${firstName}!` : 'Thank you!'}</h1>
              <p>
                Your order <strong>{order.number}</strong> {awaitingPayment ? 'is saved and awaiting payment.' : 'is confirmed.'} We've emailed a
                confirmation to <strong>{order.email}</strong>.
              </p>
              {awaitingPayment && <p>{paymentNote(order, { stripe: stripeOn, paypal: paypalOn, sslcommerz: sslcommerzOn })}</p>}
            </>
          )}
          {!isAuthenticated && <p>Keep your order number: with your email, it lets you track this order.</p>}
          {leaving && payNowUrl === null && placed?.payment?.url && (
            <p>
              Nothing happening? <a href={placed.payment.url}>Continue to secure payment</a>
            </p>
          )}
        </div>
      </div>
      {/* Outside the live region, so the button isn't re-announced with every message. */}
      {!leaving && canPay && (payment ? payment.pay : awaitingPayment) && <PayNowButton order={order} email={isAuthenticated ? undefined : (guestEmail ?? order.email)} size="lg" />}
      {/* Phase 9: changed their mind? An unpaid order with nothing shipped can be cancelled. */}
      {!leaving && <CancelOrderButton order={order} email={isAuthenticated ? undefined : (guestEmail ?? order.email)} onCancelled={setCancelled} />}

      <OrderDetailsView order={order} invoicePdf={{ orderNumber: order.number, email: isAuthenticated ? undefined : (guestEmail ?? order.email) }} />

      <div className="order-page__actions">
        {isAuthenticated ? (
          <Button to={ROUTES.orderDetails(order.number)} variant="outline">
            View order details
          </Button>
        ) : (
          <Button to={ROUTES.trackOrder} variant="outline">
            Track your order
          </Button>
        )}
        <Button to={ROUTES.products}>Continue shopping</Button>
      </div>
    </div>
  )
}

const OrderConfirmationPage = REAL_SHOP ? ServerOrderConfirmation : DemoOrderConfirmation

export default OrderConfirmationPage
