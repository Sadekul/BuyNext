import { Fragment } from 'react'
import { Link } from 'react-router'
import { LuExternalLink, LuFileText, LuPhoneCall, LuUndo2 } from 'react-icons/lu'
import OrderHistory from './OrderHistory'
import OrderItems from './OrderItems'
import OrderStatus from './OrderStatus'
import OrderStatusBadge from './OrderStatusBadge'
import OrderTotals from './OrderTotals'
import InvoicePdfButton from './InvoicePdfButton'
import { ALL_PAYMENT_METHODS } from '../../constants/store'
import { paymentNote } from '../../constants/orders'
import { formatDate, moneyFormatter } from '../../utils/formatters'
import { formatPoints } from '../../utils/rewards'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import './OrderDetailsView.css'
import { useTranslation } from 'react-i18next'
import { translate } from '../../i18n'
import { paymentMethodLabel, shippingMethodText } from '../../utils/payment'
import { addressPlaceLines, etaText, zoneName } from '../../utils/bangladesh'
import { useAddressPlaces } from '../../hooks/useAddressPlaces'

function AddressBlock({ address }) {
  // Phase 14: a Bangladesh address's places in the reader's language.
  const withPlaces = useAddressPlaces([address])
  return (
    <address className="order-view__address">
      {address.firstName} {address.lastName}
      <br />
      {address.line1}
      {address.line2 && (
        <>
          <br />
          {address.line2}
        </>
      )}
      {/* Phase 14: a Bangladesh address shows its area, district and division in the reader's language. */}
      {addressPlaceLines(withPlaces(address)).map((line) => (
        <Fragment key={line}>
          <br />
          {line}
        </Fragment>
      ))}
      <br />
      {translate(`common:countries.${address.country}`, { defaultValue: address.country })}
    </address>
  )
}

/** Shipments with carrier, tracking number, and a link to the carrier's tracking page (new tab). */
function Shipments({ shipments }) {
  const { t } = useTranslation('orders')
  if (!shipments?.length) return null
  return (
    <>
      <h3 className="order-view__subheading">{t('view.shipment', { count: shipments.length })}</h3>
      <ul className="order-view__documents">
        {shipments.map((shipment) => (
          <li key={shipment.number}>
            <p>
              <strong>{shipment.carrierLabel}</strong>
              {shipment.trackingNumber ? t('view.tracking', { number: shipment.trackingNumber }) : t('view.noTracking')}
            </p>
            <p className="order-view__muted">{t('view.shippedOn', { date: formatDate(shipment.createdAt) })}</p>
            {shipment.trackingUrl && (
              // noopener: the carrier's page can't reach back into this tab.
              <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="order-view__link">
                {t('view.trackWith', { carrier: shipment.carrierLabel })} <LuExternalLink aria-hidden="true" />
                <span className="visually-hidden">{t('view.newTab')}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Invoices (payments recorded); linked to the printable page when the viewer
 * may open it (customers, not guests). `invoicePdf` (phase 10): the order's
 * proof for the PDF download ({ email } for a guest, {} for the customer).
 */
function Invoices({ invoices, invoiceLink, invoicePdf, formatBasePrice }) {
  const { t } = useTranslation('orders')
  if (!invoices?.length) return null
  return (
    <>
      <h3 className="order-view__subheading">{t('view.invoice', { count: invoices.length })}</h3>
      <ul className="order-view__documents">
        {invoices.map((invoice) => (
          <li key={invoice.number}>
            <p className="order-view__row">
              {invoiceLink ? (
                <Link to={invoiceLink(invoice.number)} className="order-view__link">
                  <LuFileText aria-hidden="true" /> {t('view.invoiceNumber', { number: invoice.number })}
                </Link>
              ) : (
                <span>{t('view.invoiceNumber', { number: invoice.number })}</span>
              )}
              <strong>{formatBasePrice(invoice.amount)}</strong>
            </p>
            <p className="order-view__muted">{t('view.issued', { date: formatDate(invoice.createdAt) })}</p>
            {invoicePdf && <InvoicePdfButton orderNumber={invoicePdf.orderNumber} invoiceNumber={invoice.number} email={invoicePdf.email} size="sm" variant="ghost" />}
          </li>
        ))}
      </ul>
    </>
  )
}

function Refunds({ creditMemos, formatBasePrice }) {
  const { t } = useTranslation('orders')
  if (!creditMemos?.length) return null
  return (
    <>
      <h3 className="order-view__subheading">{t('view.refund', { count: creditMemos.length })}</h3>
      <ul className="order-view__documents">
        {creditMemos.map((memo) => (
          <li key={memo.number}>
            <p className="order-view__row">
              <span>
                <LuUndo2 aria-hidden="true" /> {t('view.refundNumber', { number: memo.number })}
              </span>
              <strong>{formatBasePrice(memo.total)}</strong>
            </p>
            <p className="order-view__muted">{formatDate(memo.createdAt)}</p>
          </li>
        ))}
      </ul>
      <p className="order-view__muted">{t('view.refundsNote')}</p>
    </>
  )
}

/**
 * Everything about one order; used by the confirmation, order details, and
 * order tracking pages. Works with real orders from BuyNest's API (`number`,
 * `history`, `paymentStatus`) and with demo orders saved in this browser
 * (`id`, `contact`, `isSimulated`). Real orders also list their shipments,
 * invoices, and refunds; `invoiceLink(number)` (customers only) links each
 * invoice to its printable page. `payAction` (phase 8): the "Pay now" button
 * of an unpaid card order, shown with the payment.
 */
// Phase 10: an order paid in full by a gift card (no other method); phase 11: by reward points.
const OTHER_PAYMENT_LABELS = { gift_card: 'Gift card', reward_points: 'Reward points' }
// Phase 13: a payment method's name in the shopper's language (utils/payment.js).
const paymentName = (method) => (ALL_PAYMENT_METHODS.some((known) => known.id === method) || OTHER_PAYMENT_LABELS[method] ? paymentMethodLabel(method) : method)

/**
 * Phase 14: "We'll call you to confirm" / "Confirmed": the store's phone call
 * before a cash on delivery order is sent (when the store asks for one).
 */
export function PhoneConfirmation({ order }) {
  const { t } = useTranslation('orders')
  const status = order?.confirmationStatus
  if (!status || status === 'cancelled' || order.status === 'cancelled') return null
  const key = status === 'confirmed' ? 'confirmed' : status === 'unreachable' ? 'unreachable' : 'pending'
  return (
    <div className={`order-view__confirmation order-view__confirmation--${key}`}>
      <p className="order-view__row">
        <strong>
          <LuPhoneCall aria-hidden="true" /> {t(`phoneConfirmation.${key}`)}
        </strong>
      </p>
      <p className="order-view__muted">{t(`phoneConfirmation.${key}Line`, { phone: order.phone || order.contact?.phone || '' })}</p>
    </div>
  )
}

/** Phase 14: the method's name and delivery time ("Delivery in 1–2 days" from a zone rate, else the method's own). */
function deliveryText(method) {
  const text = shippingMethodText(method)
  return { label: text.label, eta: etaText(method) ?? text.eta }
}

function OrderDetailsView({ order, invoiceLink, invoicePdf = null, payAction = null }) {
  const { t } = useTranslation('orders')
  const payment = ALL_PAYMENT_METHODS.find((method) => method.id === order.paymentMethod) ?? (OTHER_PAYMENT_LABELS[order.paymentMethod] && { label: OTHER_PAYMENT_LABELS[order.paymentMethod] })
  // Phase 12: the order's money in the currency it was charged in (older orders: USD), not today's store currency.
  const formatBasePrice = moneyFormatter(order.currency)
  // Phase 8: whether card orders are paid through Stripe (cached store settings only: no extra request).
  const { settings } = useStoreSettings({ enabled: false })
  const contact = order.contact ?? { email: order.email, phone: order.phone }
  const isReal = !order.isSimulated

  return (
    <div className="order-view">
      <section className="order-view__card" aria-labelledby="order-status-title">
        <div className="order-view__row">
          <h2 id="order-status-title">{t('view.status')}</h2>
          <p className="order-view__muted">{t('view.placed', { date: formatDate(new Date(order.placedAt).toISOString()) })}</p>
        </div>
        {isReal && <OrderStatusBadge status={order.status} />}
        {/* A cancelled order has no steps left: the status above says it all. */}
        {!['cancelled', 'closed'].includes(order.status) && <OrderStatus status={order.status} />}
        {isReal && <OrderHistory history={order.history} />}
        {order.isSimulated && (
          <p className="order-view__demo">
            {t('view.demo')}
          </p>
        )}
      </section>

      <div className="order-view__columns">
        <section className="order-view__card" aria-labelledby="order-delivery-title">
          <h2 id="order-delivery-title">{t('view.delivery')}</h2>
          {/* Phase 10: gift cards only: nothing ships (no address, no method). */}
          {order.shippingAddress && order.requiresShipping !== false ? <AddressBlock address={order.shippingAddress} /> : <p>{t('view.byEmail')}</p>}
          {order.shippingMethod && (
            <p>
              <strong>{deliveryText(order.shippingMethod).label}</strong> — {deliveryText(order.shippingMethod).eta}
            </p>
          )}
          {/* Phase 14: the delivery zone the address fell in (Inside Dhaka, Outside Dhaka…). */}
          {order.deliveryZone && zoneName(order.deliveryZone) && <p className="order-view__muted">{t('view.zone', { zone: zoneName(order.deliveryZone) })}</p>}
          <p className="order-view__muted">
            {contact.email} · {contact.phone}
          </p>
          <Shipments shipments={order.shipments} />
        </section>
        <section className="order-view__card" aria-labelledby="order-payment-title">
          <h2 id="order-payment-title">{t('view.payment')}</h2>
          {isReal ? (
            <>
              <p className="order-view__row">
                <strong>{payment ? paymentName(order.paymentMethod) : order.paymentMethod}</strong>
                <OrderStatusBadge status={order.paymentStatus} payment />
              </p>
              <p className="order-view__muted">{paymentNote(order, { stripe: settings.cardPayments === 'stripe', paypal: settings.paypalPayments === 'paypal', sslcommerz: settings.sslcommerzPayments === 'sslcommerz' })}</p>
              {/* Phase 10: the gift card that paid part (or all) of it: its last 4 characters only. */}
              {order.giftCard?.applied > 0 && (
                <p className="order-view__muted">
                  {t('view.giftCardPaid', { card: order.giftCard.last4 ? `•••• ${order.giftCard.last4} ` : '', amount: formatBasePrice(order.giftCard.applied) })}
                </p>
              )}
              {/* Phase 11: reward points used on the order, and earned once it was paid. */}
              {order.rewardPointsSpent > 0 && (
                <p className="order-view__muted">
                  {t('view.pointsPaid', { points: formatPoints(order.rewardPointsSpent), amount: formatBasePrice(order.rewardPointsAmount ?? order.totals.rewardPoints ?? 0) })}
                </p>
              )}
              {order.rewardPointsEarned > 0 && <p className="order-view__muted">{t('view.pointsEarned', { points: formatPoints(order.rewardPointsEarned) })}</p>}
              {payAction && <div className="order-view__pay">{payAction}</div>}
              <PhoneConfirmation order={order} />
            </>
          ) : (
            <p>
              <strong>{payment ? paymentName(order.paymentMethod) : order.paymentMethod}</strong>
              {t('view.notCharged')}
            </p>
          )}
          <h3 className="order-view__subheading">{t('view.billing')}</h3>
          <AddressBlock address={order.billingAddress} />
          <Invoices invoices={order.invoices} invoiceLink={invoiceLink} invoicePdf={invoicePdf} formatBasePrice={formatBasePrice} />
          <Refunds creditMemos={order.creditMemos} formatBasePrice={formatBasePrice} />
        </section>
      </div>

      <section className="order-view__card cart-summary" aria-labelledby="order-items-title">
        <h2 id="order-items-title" className="cart-summary__title">
          {t('view.items')}
        </h2>
        <OrderItems items={order.items} currency={order.currency} />
        <OrderTotals
          totals={withCodTotals(order)}
          couponCode={order.couponCode ?? order.totals.couponCode}
          appliedRules={order.appliedRules}
          shippingLabel={order.shippingMethod ? shippingMethodText(order.shippingMethod).label : undefined}
          requiresShipping={order.requiresShipping !== false}
          rewardPointsSpent={order.rewardPointsSpent ?? null}
          currency={order.currency}
        />
        {order.verification && (
          <p className="cart-summary__note">
            {t('view.verified', { cart: order.verification.cartId, total: formatBasePrice(order.verification.serverDiscountedTotal) })}
          </p>
        )}
      </section>
    </div>
  )
}

/** Phase 14: an order's COD fee, advance paid and cash due, wherever the API put them (totals or the order). */
function withCodTotals(order) {
  const extra = {}
  for (const key of ['codFee', 'advancePaid', 'codDue']) {
    if (order.totals?.[key] === undefined && order[key] !== undefined) extra[key] = order[key]
  }
  return Object.keys(extra).length > 0 ? { ...order.totals, ...extra } : order.totals
}

export default OrderDetailsView
