import { Link } from 'react-router'
import { LuExternalLink, LuFileText, LuUndo2 } from 'react-icons/lu'
import OrderHistory from './OrderHistory'
import OrderItems from './OrderItems'
import OrderStatus from './OrderStatus'
import OrderStatusBadge from './OrderStatusBadge'
import OrderTotals from './OrderTotals'
import InvoicePdfButton from './InvoicePdfButton'
import { PAYMENT_METHODS } from '../../constants/store'
import { paymentNote } from '../../constants/orders'
import { formatDate, formatPrice } from '../../utils/formatters'
import { useStoreSettings } from '../../hooks/useStoreSettings'
import './OrderDetailsView.css'

function AddressBlock({ address }) {
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
      <br />
      {address.city}, {address.state} {address.postalCode}
      <br />
      {address.country}
    </address>
  )
}

/** Shipments with carrier, tracking number, and a link to the carrier's tracking page (new tab). */
function Shipments({ shipments }) {
  if (!shipments?.length) return null
  return (
    <>
      <h3 className="order-view__subheading">{shipments.length === 1 ? 'Shipment' : 'Shipments'}</h3>
      <ul className="order-view__documents">
        {shipments.map((shipment) => (
          <li key={shipment.number}>
            <p>
              <strong>{shipment.carrierLabel}</strong>
              {shipment.trackingNumber ? ` · tracking number ${shipment.trackingNumber}` : ' · no tracking number'}
            </p>
            <p className="order-view__muted">Shipped {formatDate(shipment.createdAt)}</p>
            {shipment.trackingUrl && (
              // noopener: the carrier's page can't reach back into this tab.
              <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="order-view__link">
                Track with {shipment.carrierLabel} <LuExternalLink aria-hidden="true" />
                <span className="visually-hidden"> (opens in a new tab)</span>
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
function Invoices({ invoices, invoiceLink, invoicePdf }) {
  if (!invoices?.length) return null
  return (
    <>
      <h3 className="order-view__subheading">{invoices.length === 1 ? 'Invoice' : 'Invoices'}</h3>
      <ul className="order-view__documents">
        {invoices.map((invoice) => (
          <li key={invoice.number}>
            <p className="order-view__row">
              {invoiceLink ? (
                <Link to={invoiceLink(invoice.number)} className="order-view__link">
                  <LuFileText aria-hidden="true" /> Invoice {invoice.number}
                </Link>
              ) : (
                <span>Invoice {invoice.number}</span>
              )}
              <strong>{formatPrice(invoice.amount)}</strong>
            </p>
            <p className="order-view__muted">Issued {formatDate(invoice.createdAt)}</p>
            {invoicePdf && <InvoicePdfButton orderNumber={invoicePdf.orderNumber} invoiceNumber={invoice.number} email={invoicePdf.email} size="sm" variant="ghost" />}
          </li>
        ))}
      </ul>
    </>
  )
}

function Refunds({ creditMemos }) {
  if (!creditMemos?.length) return null
  return (
    <>
      <h3 className="order-view__subheading">{creditMemos.length === 1 ? 'Refund' : 'Refunds'}</h3>
      <ul className="order-view__documents">
        {creditMemos.map((memo) => (
          <li key={memo.number}>
            <p className="order-view__row">
              <span>
                <LuUndo2 aria-hidden="true" /> Refund {memo.number}
              </span>
              <strong>{formatPrice(memo.total)}</strong>
            </p>
            <p className="order-view__muted">{formatDate(memo.createdAt)}</p>
          </li>
        ))}
      </ul>
      <p className="order-view__muted">Refunds are returned by the method you paid with; your bank may take a few days to show them.</p>
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
// Phase 10: an order paid in full by a gift card (no other method).
const OTHER_PAYMENT_LABELS = { gift_card: 'Gift card' }

function OrderDetailsView({ order, invoiceLink, invoicePdf = null, payAction = null }) {
  const payment = PAYMENT_METHODS.find((method) => method.id === order.paymentMethod) ?? (OTHER_PAYMENT_LABELS[order.paymentMethod] && { label: OTHER_PAYMENT_LABELS[order.paymentMethod] })
  // Phase 8: whether card orders are paid through Stripe (cached store settings only: no extra request).
  const { settings } = useStoreSettings({ enabled: false })
  const contact = order.contact ?? { email: order.email, phone: order.phone }
  const isReal = !order.isSimulated

  return (
    <div className="order-view">
      <section className="order-view__card" aria-labelledby="order-status-title">
        <div className="order-view__row">
          <h2 id="order-status-title">Status</h2>
          <p className="order-view__muted">Placed {formatDate(new Date(order.placedAt).toISOString())}</p>
        </div>
        {isReal && <OrderStatusBadge status={order.status} />}
        {/* A cancelled order has no steps left: the status above says it all. */}
        {!['cancelled', 'closed'].includes(order.status) && <OrderStatus status={order.status} />}
        {isReal && <OrderHistory history={order.history} />}
        {order.isSimulated && (
          <p className="order-view__demo">
            Demo order: no payment was taken and nothing will ship. Real orders move through these steps as the backend
            updates them.
          </p>
        )}
      </section>

      <div className="order-view__columns">
        <section className="order-view__card" aria-labelledby="order-delivery-title">
          <h2 id="order-delivery-title">Delivery</h2>
          {/* Phase 10: gift cards only: nothing ships (no address, no method). */}
          {order.shippingAddress && order.requiresShipping !== false ? <AddressBlock address={order.shippingAddress} /> : <p>Sent by email: nothing to ship.</p>}
          {order.shippingMethod && (
            <p>
              <strong>{order.shippingMethod.label}</strong> — {order.shippingMethod.eta}
            </p>
          )}
          <p className="order-view__muted">
            {contact.email} · {contact.phone}
          </p>
          <Shipments shipments={order.shipments} />
        </section>
        <section className="order-view__card" aria-labelledby="order-payment-title">
          <h2 id="order-payment-title">Payment</h2>
          {isReal ? (
            <>
              <p className="order-view__row">
                <strong>{payment?.label ?? order.paymentMethod}</strong>
                <OrderStatusBadge status={order.paymentStatus} payment />
              </p>
              <p className="order-view__muted">{paymentNote(order, { stripe: settings.cardPayments === 'stripe', paypal: settings.paypalPayments === 'paypal' })}</p>
              {/* Phase 10: the gift card that paid part (or all) of it: its last 4 characters only. */}
              {order.giftCard?.applied > 0 && (
                <p className="order-view__muted">
                  Gift card {order.giftCard.last4 ? `•••• ${order.giftCard.last4} ` : ''}paid {formatPrice(order.giftCard.applied)}.
                </p>
              )}
              {payAction && <div className="order-view__pay">{payAction}</div>}
            </>
          ) : (
            <p>
              <strong>{payment?.label ?? order.paymentMethod}</strong> (not charged)
            </p>
          )}
          <h3 className="order-view__subheading">Billing address</h3>
          <AddressBlock address={order.billingAddress} />
          <Invoices invoices={order.invoices} invoiceLink={invoiceLink} invoicePdf={invoicePdf} />
          <Refunds creditMemos={order.creditMemos} />
        </section>
      </div>

      <section className="order-view__card cart-summary" aria-labelledby="order-items-title">
        <h2 id="order-items-title" className="cart-summary__title">
          Items
        </h2>
        <OrderItems items={order.items} />
        <OrderTotals
          totals={order.totals}
          couponCode={order.couponCode ?? order.totals.couponCode}
          appliedRules={order.appliedRules}
          shippingLabel={order.shippingMethod?.label}
          requiresShipping={order.requiresShipping !== false}
        />
        {order.verification && (
          <p className="cart-summary__note">
            Prices verified with the server (DummyJSON cart #{order.verification.cartId}). Its own discounted total was{' '}
            {formatPrice(order.verification.serverDiscountedTotal)}, rounded to whole dollars, before coupons and shipping.
          </p>
        )}
      </section>
    </div>
  )
}

export default OrderDetailsView
