import DiscountRows from '../cart/DiscountRows'
import { moneyFormatter } from '../../utils/formatters'
import { formatPoints } from '../../utils/rewards'
import { useTranslation } from 'react-i18next'

/** Totals rows shared by checkout, confirmation, and order details. Reuses CartSummary's styles. */
/** `appliedRules` (phase 7): the cart price rules the server applied, one row each. */
/** Phase 10: `totals.giftCard` (what a gift card pays) and `totals.amountDue` (what is left to pay); `requiresShipping: false` for gift cards only. */
/** Phase 11: `totals.rewardPoints` (what points pay, paid before a gift card) and `rewardPointsSpent` (how many points). */
/** Phase 12: `currency`: the order's own currency code (its money is written in it); the store currency otherwise. */
function OrderTotals({ totals, couponCode, appliedRules, shippingLabel, showTax = true, requiresShipping = true, rewardPointsSpent = null, currency = null }) {
  const { t } = useTranslation('orders')
  const formatBasePrice = moneyFormatter(currency)
  const giftCard = totals.giftCard ?? 0
  const points = totals.rewardPoints ?? 0
  const amountDue = totals.amountDue ?? Math.max(0, Math.round((totals.total - points - giftCard) * 100) / 100)
  return (
    <dl className="cart-summary__rows">
      <div>
        <dt>{t('totals.subtotal', { count: totals.itemCount })}</dt>
        <dd>{formatBasePrice(totals.subtotal)}</dd>
      </div>
      <DiscountRows rules={appliedRules} discount={totals.discount} couponCode={couponCode} format={formatBasePrice} />
      {requiresShipping ? (
        <div>
          <dt>{shippingLabel ? t('totals.shippingWith', { method: shippingLabel }) : t('totals.shipping')}</dt>
          <dd>{totals.shipping === 0 ? t('totals.free') : formatBasePrice(totals.shipping)}</dd>
        </div>
      ) : (
        <div>
          <dt>{t('totals.shipping')}</dt>
          <dd>{t('totals.noShipping')}</dd>
        </div>
      )}
      {/* Server-priced totals include the tax; the demo can't know it. Checkout hides the line when the store charges no tax. */}
      {showTax && (
        <div>
          <dt>{t('totals.taxes')}</dt>
          <dd>{typeof totals.tax === 'number' ? formatBasePrice(totals.tax) : t('totals.taxesServer')}</dd>
        </div>
      )}
      <div className="cart-summary__total">
        <dt>{t('totals.total')}</dt>
        <dd>{formatBasePrice(totals.total)}</dd>
      </div>
      {points > 0 && (
        <div className="cart-summary__saving">
          <dt>{rewardPointsSpent > 0 ? t('totals.rewardPointsWith', { points: formatPoints(rewardPointsSpent) }) : t('totals.rewardPoints')}</dt>
          <dd>−{formatBasePrice(points)}</dd>
        </div>
      )}
      {points > 0 && giftCard === 0 && (
        <div className="cart-summary__total">
          <dt>{t('totals.otherPayment')}</dt>
          <dd>{formatBasePrice(amountDue)}</dd>
        </div>
      )}
      {giftCard > 0 && (
        <>
          <div className="cart-summary__saving">
            <dt>{t('totals.giftCard')}</dt>
            <dd>−{formatBasePrice(giftCard)}</dd>
          </div>
          <div className="cart-summary__total">
            <dt>{t('totals.otherPayment')}</dt>
            <dd>{formatBasePrice(amountDue)}</dd>
          </div>
        </>
      )}
      {/* Orders with refunds (credit memos) show what came back. */}
      {totals.refunded > 0 && (
        <div className="cart-summary__saving">
          <dt>{t('totals.refunded')}</dt>
          <dd>−{formatBasePrice(totals.refunded)}</dd>
        </div>
      )}
    </dl>
  )
}

export default OrderTotals
