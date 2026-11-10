import OrderHistory from './OrderHistory'
import OrderItems from './OrderItems'
import OrderStatus from './OrderStatus'
import OrderStatusBadge from './OrderStatusBadge'
import OrderTotals from './OrderTotals'
import { PAYMENT_METHODS } from '../../constants/store'
import { paymentNote } from '../../constants/orders'
import { formatDate, formatPrice } from '../../utils/formatters'
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

/**
 * Everything about one order; used by the confirmation, order details, and
 * order tracking pages. Works with real orders from BuyNest's API (`number`,
 * `history`, `paymentStatus`) and with demo orders saved in this browser
 * (`id`, `contact`, `isSimulated`).
 */
function OrderDetailsView({ order }) {
  const payment = PAYMENT_METHODS.find((method) => method.id === order.paymentMethod)
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
        {order.status !== 'cancelled' && <OrderStatus status={order.status} />}
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
          <AddressBlock address={order.shippingAddress} />
          <p>
            <strong>{order.shippingMethod.label}</strong> — {order.shippingMethod.eta}
          </p>
          <p className="order-view__muted">
            {contact.email} · {contact.phone}
          </p>
        </section>
        <section className="order-view__card" aria-labelledby="order-payment-title">
          <h2 id="order-payment-title">Payment</h2>
          {isReal ? (
            <>
              <p className="order-view__row">
                <strong>{payment?.label ?? order.paymentMethod}</strong>
                <OrderStatusBadge status={order.paymentStatus} payment />
              </p>
              <p className="order-view__muted">{paymentNote(order)}</p>
            </>
          ) : (
            <p>
              <strong>{payment?.label ?? order.paymentMethod}</strong> (not charged)
            </p>
          )}
          <h3 className="order-view__subheading">Billing address</h3>
          <AddressBlock address={order.billingAddress} />
        </section>
      </div>

      <section className="order-view__card cart-summary" aria-labelledby="order-items-title">
        <h2 id="order-items-title" className="cart-summary__title">
          Items
        </h2>
        <OrderItems items={order.items} />
        <OrderTotals totals={order.totals} couponCode={order.couponCode ?? order.totals.couponCode} shippingLabel={order.shippingMethod.label} />
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
