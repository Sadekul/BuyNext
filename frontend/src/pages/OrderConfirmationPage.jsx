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
import { moneyFormatter } from '../utils/formatters'
import { REAL_SHOP } from '../constants/shop'
import { ROUTES } from '../constants/routes'
import { SITE } from '../constants/site'
import './OrderPages.css'
import { Trans, useTranslation } from 'react-i18next'
import { translate } from '../i18n'

/** Demo: the order saved in this browser by the simulated checkout. */
function DemoOrderConfirmation() {
  const { t } = useTranslation('checkout')
  const { orderId } = useParams()
  const { getOrder } = useOrders()
  const { user } = useAuth()
  const order = getOrder(orderId)

  if (!order) {
    return (
      <div className="section container">
        <EmptyState icon={LuPackageX} title={t('confirmation.notFound')} message={t('confirmation.notOnDevice')}>
          <Button to={ROUTES.orders}>{t('confirmation.viewOrders')}</Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="order-page section container">
      <title>{`${t('confirmation.tabTitle', { number: order.id })} | ${SITE.name}`}</title>
      <div className="order-page__hero" role="status">
        <LuCircleCheck className="order-page__check" aria-hidden="true" />
        <div>
          <h1>{t('confirmation.thanksName', { name: user.firstName })}</h1>
          <p>
            <Trans t={t} i18nKey="confirmation.demoRecorded" values={{ number: order.id, email: order.contact.email }} components={{ strong: <strong /> }} />
          </p>
        </div>
      </div>

      <OrderDetailsView order={order} />

      <div className="order-page__actions">
        <Button to={ROUTES.orderDetails(order.id)} variant="outline">
          {t('confirmation.viewDetails')}
        </Button>
        <Button to={ROUTES.products}>{t('confirmation.continue')}</Button>
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
// Phase 13: the messages below are in the shopper's language (checkout:confirmation.*).
const tx = (key, values) => translate(`checkout:confirmation.${key}`, values)
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
  const name = PROVIDER_NAMES[provider] ?? tx('partner')
  const number = order.number
  const email = order.email
  // Phase 14: cash on delivery with the delivery charge paid online first (SSLCommerz).
  const advance = order.paymentMethod === 'cod'
  if (leaving) {
    if (advance) return { tone: 'waiting', title: tx('toAdvance.title'), lines: [tx('toAdvance.line', { number })] }
    if (provider === 'paypal') return { tone: 'waiting', title: tx('toPaypal.title'), lines: [tx('toPaypal.line', { number })] }
    if (provider === 'sslcommerz') {
      return { tone: 'waiting', title: tx('toSslcommerz.title'), lines: [tx('toSslcommerz.line', { number })] }
    }
    return { tone: 'waiting', title: tx('toStripe.title'), lines: [tx('toStripe.line', { number })] }
  }
  if (order.status === 'cancelled') {
    return {
      tone: 'cancelled',
      title: tx('cancelled.title'),
      lines: [tx(order.paymentStatus === 'unpaid' ? 'cancelled.lineUnpaid' : 'cancelled.line', { number })],
    }
  }
  if (paymentReturn === 'success') {
    if (advance && order.paymentStatus === 'partially_paid') {
      const money = moneyFormatter(order.currency)
      const due = order.codDue ?? order.totals?.codDue ?? 0
      return { tone: 'done', title: tx('advancePaid.title'), lines: [tx('advancePaid.line', { number, advance: money(order.advancePaid ?? order.totals?.advancePaid ?? 0), due: money(due) })] }
    }
    if (paid) return { tone: 'done', title: tx('paid.title'), lines: [tx('paid.line', { number, email })] }
    // Phase 12: SSLCommerz flagged the payment for a check (risk level 1): received, confirmed by staff.
    if (order.paymentStatus === 'review') {
      return { tone: 'waiting', title: tx('checking.title'), lines: [tx('checking.line', { number, email })] }
    }
    // Phase 10: PayPal refused the capture (e.g. the funding source was declined): nothing was taken.
    if (captureError) {
      return {
        tone: 'waiting',
        title: tx('paypalFailed.title'),
        lines: [tx('paypalFailed.line', { error: captureError, number })],
        pay: canPay,
        alert: true,
      }
    }
    if (!gaveUp) return { tone: 'waiting', title: tx('confirming.title'), lines: [tx('confirming.line', { name })] }
    return {
      tone: 'waiting',
      title: tx('slow.title'),
      lines: [tx('slow.line', { name, email })],
    }
  }
  // Phase 12: SSLCommerz said the payment failed (declined, wrong PIN, timed out): nothing was taken.
  if (paymentReturn === 'failed' && !paid && order.status !== 'cancelled') {
    return {
      tone: 'waiting',
      title: tx('failed.title'),
      lines: [tx('failed.line', { name, number }), tx('expires')],
      pay: canPay,
      alert: true,
    }
  }
  if (paymentReturn === 'cancelled' && !paid && order.status !== 'cancelled') {
    return {
      tone: 'waiting',
      title: tx('notCompleted.title'),
      lines: [tx('notCompleted.line', { number }), tx('expires')],
      pay: canPay,
    }
  }
  if (startError && !paid && order.status !== 'cancelled') {
    return {
      tone: 'waiting',
      title: tx('cantOpen.title'),
      lines: [tx('cantOpen.line', { number, error: startError }), tx('cantOpen.retry')],
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
  const { t } = useTranslation('checkout')
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
  const refetchInterval = (query) => (confirming && !gaveUp && !query.state.error && !['paid', 'review', 'partially_paid'].includes(query.state.data?.paymentStatus) ? pollEvery : false)
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
        <Loader label={t('confirmation.loading')} />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="section container">
        <EmptyState
          icon={LuPackageX}
          title={t(paymentReturn ? 'confirmation.findTitle' : 'confirmation.notFound')}
          message={
            paymentReturn
              ? t(paymentReturn !== 'success' ? 'confirmation.lookUpPay' : 'confirmation.lookUp', { number: orderId })
              : t('confirmation.lookUpGeneric')
          }
        >
          <Button to={ROUTES.trackOrder}>{t('confirmation.track')}</Button>
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
  const startError = !paymentReturn && sentTo && !isPaymentUrl(placed.payment.url) ? (placed.payment.error ?? t('confirmation.partnerUnreachable')) : null
  const provider = returnProvider ?? sentTo ?? order.paymentProvider ?? (['paypal', 'sslcommerz'].includes(order.paymentMethod) ? order.paymentMethod : 'stripe')
  const captureError = paypalToken !== null && capture.isError && order.paymentStatus !== 'paid' ? capture.error.message : null
  const payment = paymentMessage({ order, paymentReturn, leaving: leaving || Boolean(payNowUrl), gaveUp, canPay, startError, provider, captureError })
  const awaitingPayment = order.status === 'pending_payment'
  const firstName = user?.firstName || order.shippingAddress?.firstName || order.billingAddress?.firstName
  const HeroIcon = payment ? (payment.tone === 'done' ? LuCircleCheck : payment.tone === 'cancelled' ? LuPackageX : payment.alert ? LuTriangleAlert : LuClock) : awaitingPayment ? LuClock : LuCircleCheck
  const waiting = payment ? payment.tone === 'waiting' : false

  return (
    <div className="order-page section container">
      <title>{`${t('confirmation.tabTitle', { number: order.number })} | ${SITE.name}`}</title>
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
              <h1>{firstName ? t('confirmation.thanksName', { name: firstName }) : t('confirmation.thanks')}</h1>
              <p>
                <Trans
                  t={t}
                  i18nKey={awaitingPayment ? 'confirmation.awaiting' : 'confirmation.confirmed'}
                  values={{ number: order.number, email: order.email }}
                  components={{ strong: <strong /> }}
                />
              </p>
              {awaitingPayment && <p>{paymentNote(order, { stripe: stripeOn, paypal: paypalOn, sslcommerz: sslcommerzOn })}</p>}
              {/* Phase 14: cash on delivery: what to keep ready, and the store's phone call before sending it. */}
              {!awaitingPayment && order.paymentMethod === 'cod' && order.status !== 'cancelled' && (order.codDue > 0 || order.paymentStatus === 'partially_paid') && (
                <p>{paymentNote(order)}</p>
              )}
              {!awaitingPayment && ['pending', 'unreachable'].includes(order.confirmationStatus) && order.status !== 'cancelled' && (
                <p>{t('orders:phoneConfirmation.pendingLine', { phone: order.phone ?? '' })}</p>
              )}
            </>
          )}
          {!isAuthenticated && <p>{t('confirmation.keepNumber')}</p>}
          {leaving && payNowUrl === null && placed?.payment?.url && (
            <p>
              <Trans t={t} i18nKey="confirmation.nothingHappening" components={{ pay: <a href={placed.payment.url} /> }} />
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
            {t('confirmation.viewDetails')}
          </Button>
        ) : (
          <Button to={ROUTES.trackOrder} variant="outline">
            {t('confirmation.track')}
          </Button>
        )}
        <Button to={ROUTES.products}>{t('confirmation.continue')}</Button>
      </div>
    </div>
  )
}

const OrderConfirmationPage = REAL_SHOP ? ServerOrderConfirmation : DemoOrderConfirmation

export default OrderConfirmationPage
