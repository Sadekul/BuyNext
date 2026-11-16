import DiscountRows from '../cart/DiscountRows'
import { formatPrice } from '../../utils/formatters'

/** Totals rows shared by checkout, confirmation, and order details. Reuses CartSummary's styles. */
/** `appliedRules` (phase 7): the cart price rules the server applied, one row each. */
function OrderTotals({ totals, couponCode, appliedRules, shippingLabel, showTax = true }) {
  return (
    <dl className="cart-summary__rows">
      <div>
        <dt>Subtotal ({totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'})</dt>
        <dd>{formatPrice(totals.subtotal)}</dd>
      </div>
      <DiscountRows rules={appliedRules} discount={totals.discount} couponCode={couponCode} />
      <div>
        <dt>Shipping{shippingLabel && ` (${shippingLabel})`}</dt>
        <dd>{totals.shipping === 0 ? 'Free' : formatPrice(totals.shipping)}</dd>
      </div>
      {/* Server-priced totals include the tax; the demo can't know it. Checkout hides the line when the store charges no tax. */}
      {showTax && (
        <div>
          <dt>Taxes</dt>
          <dd>{typeof totals.tax === 'number' ? formatPrice(totals.tax) : 'Calculated by our servers'}</dd>
        </div>
      )}
      <div className="cart-summary__total">
        <dt>Total</dt>
        <dd>{formatPrice(totals.total)}</dd>
      </div>
      {/* Orders with refunds (credit memos) show what came back. */}
      {totals.refunded > 0 && (
        <div className="cart-summary__saving">
          <dt>Refunded</dt>
          <dd>−{formatPrice(totals.refunded)}</dd>
        </div>
      )}
    </dl>
  )
}

export default OrderTotals
