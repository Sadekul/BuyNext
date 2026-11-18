import CouponForm from './CouponForm'
import DiscountRows from './DiscountRows'
import FreeShippingProgress from './FreeShippingProgress'
import ChargedInBaseNote from './ChargedInBaseNote'
import { formatPrice } from '../../utils/formatters'
import './CartSummary.css'

/**
 * Order summary. Every number comes from calculateCartTotals();
 * this component only displays them. `children` holds the action buttons.
 */
function CartSummary({ totals, couponCode, onApplyCoupon, onRemoveCoupon, isCheckingCoupon = false, showTax = true, children }) {
  return (
    <section className="cart-summary" aria-labelledby="cart-summary-title">
      <h2 id="cart-summary-title" className="cart-summary__title">
        Order summary
      </h2>

      <FreeShippingProgress amountRemaining={totals.amountToFreeShipping} threshold={totals.freeShippingThreshold} />

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
        <DiscountRows rules={totals.appliedRules} discount={totals.discount} couponCode={couponCode} />
        <div>
          <dt>Estimated shipping</dt>
          {/* Phase 10: gift cards only: they're emailed. */}
          <dd>{totals.requiresShipping === false ? 'None (sent by email)' : totals.shipping === 0 ? 'Free' : formatPrice(totals.shipping)}</dd>
        </div>
        {/* A store that charges no tax (REAL_SHOP settings) shows no tax line. */}
        {showTax && (
          <div>
            <dt>Taxes</dt>
            <dd>Calculated at checkout</dd>
          </div>
        )}
        <div className="cart-summary__total">
          <dt>Estimated total</dt>
          <dd>{formatPrice(totals.total)}</dd>
        </div>
      </dl>
      {/* Phase 11: prices shown in another currency are approximate; the order is charged in USD. */}
      <ChargedInBaseNote amount={totals.total} />

      <CouponForm
        appliedCode={couponCode}
        coupon={totals.coupon}
        couponError={totals.couponError}
        onApply={onApplyCoupon}
        onRemove={onRemoveCoupon}
        checking={isCheckingCoupon}
      />

      {children && <div className="cart-summary__actions">{children}</div>}

      <p className="cart-summary__note">
        Prices, stock, discounts, and shipping are confirmed by our servers at checkout.
      </p>
    </section>
  )
}

export default CartSummary
