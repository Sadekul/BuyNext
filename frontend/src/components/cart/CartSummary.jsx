import CouponForm from './CouponForm'
import FreeShippingProgress from './FreeShippingProgress'
import { formatPrice } from '../../utils/formatters'
import './CartSummary.css'

/**
 * Order summary. Every number comes from calculateCartTotals();
 * this component only displays them. `children` holds the action buttons.
 */
function CartSummary({ totals, couponCode, onApplyCoupon, onRemoveCoupon, children }) {
  return (
    <section className="cart-summary" aria-labelledby="cart-summary-title">
      <h2 id="cart-summary-title" className="cart-summary__title">
        Order summary
      </h2>

      <FreeShippingProgress amountRemaining={totals.amountToFreeShipping} />

      <dl className="cart-summary__rows">
        <div>
          <dt>Subtotal ({totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'})</dt>
          <dd>{formatPrice(totals.subtotal)}</dd>
        </div>
        {totals.productSavings > 0 && (
          <div className="cart-summary__saving">
            <dt>Product savings (included)</dt>
            <dd>{formatPrice(totals.productSavings)}</dd>
          </div>
        )}
        {totals.discount > 0 && (
          <div className="cart-summary__saving">
            <dt>Discount ({couponCode})</dt>
            <dd>−{formatPrice(totals.discount)}</dd>
          </div>
        )}
        <div>
          <dt>Estimated shipping</dt>
          <dd>{totals.shipping === 0 ? 'Free' : formatPrice(totals.shipping)}</dd>
        </div>
        <div>
          <dt>Taxes</dt>
          <dd>Calculated at checkout</dd>
        </div>
        <div className="cart-summary__total">
          <dt>Estimated total</dt>
          <dd>{formatPrice(totals.total)}</dd>
        </div>
      </dl>

      <CouponForm
        appliedCode={couponCode}
        coupon={totals.coupon}
        couponError={totals.couponError}
        onApply={onApplyCoupon}
        onRemove={onRemoveCoupon}
      />

      {children && <div className="cart-summary__actions">{children}</div>}

      <p className="cart-summary__note">
        Prices, stock, discounts, and shipping are confirmed by our servers at checkout.
      </p>
    </section>
  )
}

export default CartSummary
