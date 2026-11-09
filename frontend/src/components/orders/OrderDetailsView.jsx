import OrderItems from './OrderItems'
import OrderStatus from './OrderStatus'
import OrderTotals from './OrderTotals'
import { PAYMENT_METHODS } from '../../constants/store'
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

/** Everything about one order; used by the confirmation and order details pages. */
function OrderDetailsView({ order }) {
  const payment = PAYMENT_METHODS.find((method) => method.id === order.paymentMethod)

  return (
    <div className="order-view">
      <section className="order-view__card" aria-labelledby="order-status-title">
        <div className="order-view__row">
          <h2 id="order-status-title">Status</h2>
          <p className="order-view__muted">Placed {formatDate(new Date(order.placedAt).toISOString())}</p>
        </div>
        <OrderStatus status={order.status} />
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
            {order.contact.email} · {order.contact.phone}
          </p>
        </section>
        <section className="order-view__card" aria-labelledby="order-payment-title">
          <h2 id="order-payment-title">Payment</h2>
          <p>
            <strong>{payment?.label ?? order.paymentMethod}</strong> (not charged)
          </p>
          <h3 className="order-view__subheading">Billing address</h3>
          <AddressBlock address={order.billingAddress} />
        </section>
      </div>

      <section className="order-view__card cart-summary" aria-labelledby="order-items-title">
        <h2 id="order-items-title" className="cart-summary__title">
          Items
        </h2>
        <OrderItems items={order.items} />
        <OrderTotals totals={order.totals} couponCode={order.totals.couponCode} shippingLabel={order.shippingMethod.label} />
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
