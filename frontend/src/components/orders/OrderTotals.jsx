import DiscountRows from '../cart/DiscountRows'
import { formatBasePrice } from '../../utils/formatters'
import { formatPoints } from '../../utils/rewards'

/** Totals rows shared by checkout, confirmation, and order details. Reuses CartSummary's styles. */
/** `appliedRules` (phase 7): the cart price rules the server applied, one row each. */
/** Phase 10: `totals.giftCard` (what a gift card pays) and `totals.amountDue` (what is left to pay); `requiresShipping: false` for gift cards only. */
/** Phase 11: `totals.rewardPoints` (what points pay, paid before a gift card) and `rewardPointsSpent` (how many points). */
function OrderTotals({ totals, couponCode, appliedRules, shippingLabel, showTax = true, requiresShipping = true, rewardPointsSpent = null }) {
  const giftCard = totals.giftCard ?? 0
  const points = totals.rewardPoints ?? 0
  const amountDue = totals.amountDue ?? Math.max(0, Math.round((totals.total - points - giftCard) * 100) / 100)
  return (
    <dl className="cart-summary__rows">
      <div>
        <dt>Subtotal ({totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'})</dt>
        <dd>{formatBasePrice(totals.subtotal)}</dd>
      </div>
      <DiscountRows rules={appliedRules} discount={totals.discount} couponCode={couponCode} format={formatBasePrice} />
      {requiresShipping ? (
        <div>
          <dt>Shipping{shippingLabel && ` (${shippingLabel})`}</dt>
          <dd>{totals.shipping === 0 ? 'Free' : formatBasePrice(totals.shipping)}</dd>
        </div>
      ) : (
        <div>
          <dt>Shipping</dt>
          <dd>None (sent by email)</dd>
        </div>
      )}
      {/* Server-priced totals include the tax; the demo can't know it. Checkout hides the line when the store charges no tax. */}
      {showTax && (
        <div>
          <dt>Taxes</dt>
          <dd>{typeof totals.tax === 'number' ? formatBasePrice(totals.tax) : 'Calculated by our servers'}</dd>
        </div>
      )}
      <div className="cart-summary__total">
        <dt>Total</dt>
        <dd>{formatBasePrice(totals.total)}</dd>
      </div>
      {points > 0 && (
        <div className="cart-summary__saving">
          <dt>Reward points{rewardPointsSpent > 0 && ` (${formatPoints(rewardPointsSpent)})`}</dt>
          <dd>−{formatBasePrice(points)}</dd>
        </div>
      )}
      {points > 0 && giftCard === 0 && (
        <div className="cart-summary__total">
          <dt>By other payment</dt>
          <dd>{formatBasePrice(amountDue)}</dd>
        </div>
      )}
      {giftCard > 0 && (
        <>
          <div className="cart-summary__saving">
            <dt>Paid by gift card</dt>
            <dd>−{formatBasePrice(giftCard)}</dd>
          </div>
          <div className="cart-summary__total">
            <dt>By other payment</dt>
            <dd>{formatBasePrice(amountDue)}</dd>
          </div>
        </>
      )}
      {/* Orders with refunds (credit memos) show what came back. */}
      {totals.refunded > 0 && (
        <div className="cart-summary__saving">
          <dt>Refunded</dt>
          <dd>−{formatBasePrice(totals.refunded)}</dd>
        </div>
      )}
    </dl>
  )
}

export default OrderTotals
