import { formatPrice } from '../../utils/formatters'

/** Totals rows shared by checkout, confirmation, and order details. Reuses CartSummary's styles. */
function OrderTotals({ totals, couponCode, shippingLabel }) {
  return (
    <dl className="cart-summary__rows">
      <div>
        <dt>Subtotal ({totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'})</dt>
        <dd>{formatPrice(totals.subtotal)}</dd>
      </div>
      {totals.discount > 0 && (
        <div className="cart-summary__saving">
          <dt>Discount{couponCode && ` (${couponCode})`}</dt>
          <dd>−{formatPrice(totals.discount)}</dd>
        </div>
      )}
      <div>
        <dt>Shipping{shippingLabel && ` (${shippingLabel})`}</dt>
        <dd>{totals.shipping === 0 ? 'Free' : formatPrice(totals.shipping)}</dd>
      </div>
      <div>
        <dt>Taxes</dt>
        <dd>Calculated by our servers</dd>
      </div>
      <div className="cart-summary__total">
        <dt>Total</dt>
        <dd>{formatPrice(totals.total)}</dd>
      </div>
    </dl>
  )
}

export default OrderTotals
